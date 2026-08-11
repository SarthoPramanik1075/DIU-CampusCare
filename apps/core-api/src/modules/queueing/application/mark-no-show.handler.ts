import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, ConflictError, DomainRuleViolation } from '../../../kernel/errors/domain-error.js';
import type { EnqueueNotificationInput } from '../../../kernel/notifications/enqueue-notification.js';
import type { PolicyStore } from '../../../kernel/policy/policy-store.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { computeSuspensionUntil, computeSuspensionWindowStart, shouldSuspendForNoShows } from '../domain/no-show-suspension.js';

import type { AppointmentDetail, AppointmentRepository } from './appointment-repository.js';
import type { BookingSuspensionRepository } from './booking-suspension-repository.js';
import { appointmentNotFoundError } from './cancel-appointment.handler.js';

export interface MarkNoShowCommandInput {
  readonly appointmentId: string;
  readonly reason: string | null;
  readonly expectedVersion: number;
  readonly idempotencyKey: string | null;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface SuspensionApplied {
  readonly suspendedUntil: Date;
}

export interface MarkNoShowResult {
  readonly appointment: AppointmentDetail;
  readonly rollingNoShowCount: number;
  readonly suspensionApplied: SuspensionApplied | null;
  readonly replay: boolean;
}

function staleError(current: AppointmentDetail): ConflictError {
  return new ConflictError({
    code: 'CONFLICT_STALE_VERSION',
    message: "Someone else just updated this patient. Here's the current state.",
    details: { current: { appointmentId: current.appointmentId, status: current.status, version: current.version } },
  });
}

/**
 * `POST /api/v1/appointments/{id}/no-show` (API §4.3, VR-31, BR-14/15,
 * M3-T09). VR-31's grace-period clock lives in `repository.markNoShow`
 * (DDL-08's `called_at`) — this handler's own work starts once a no-show is
 * actually recorded: BR-15's rolling-30-day-count suspension check, kept
 * here rather than in the repository because it spans a second repository
 * (`BookingSuspensionRepository`) and a notification, both cross-cutting.
 */
export class MarkNoShowHandler {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly suspensionRepository: BookingSuspensionRepository,
    private readonly policyStore: PolicyStore,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
    private readonly enqueueNotification: (input: EnqueueNotificationInput) => Promise<void>,
  ) {}

  async execute(input: MarkNoShowCommandInput): Promise<Result<MarkNoShowResult, AuthorizationError | DomainRuleViolation | ConflictError>> {
    const now = this.clock.now();
    const gracePeriodMinutes = await this.policyStore.getRequiredInteger('queueing.noShow.gracePeriodMinutes');

    const outcome = await this.repository.markNoShow(input.appointmentId, input.expectedVersion, now, gracePeriodMinutes, input.actorId, input.idempotencyKey);

    if (outcome.outcome === 'not_found') return err(appointmentNotFoundError());
    if (outcome.outcome === 'invalid_transition') {
      return err(new DomainRuleViolation({ code: 'INVALID_STATUS_TRANSITION', message: 'Only a waiting patient can be marked as a no-show.' }));
    }
    if (outcome.outcome === 'stale') return err(staleError(outcome.current));
    if (outcome.outcome === 'grace_period_not_elapsed') {
      const minutes = Math.ceil(outcome.remainingSeconds / 60);
      return err(
        new DomainRuleViolation({
          code: 'GRACE_PERIOD_NOT_ELAPSED',
          message: `You can mark this patient as a no-show in ${String(minutes)} minute${minutes === 1 ? '' : 's'}.`,
          details: { remainingSeconds: outcome.remainingSeconds },
        }),
      );
    }

    if (outcome.replay === true) {
      return ok({ appointment: outcome.appointment, rollingNoShowCount: 0, suspensionApplied: null, replay: true });
    }

    await this.auditRecorder.recordChange({
      entityType: 'queueing.appointment',
      entityId: input.appointmentId,
      action: 'no_show',
      afterState: { status: outcome.appointment.status, reason: input.reason },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    let rollingNoShowCount = 0;
    let suspensionApplied: SuspensionApplied | null = null;

    if (outcome.appointment.studentId !== null) {
      const windowDays = await this.policyStore.getRequiredInteger('queueing.noShow.suspensionWindowDays');
      rollingNoShowCount = await this.suspensionRepository.countRecentNoShows(outcome.appointment.studentId, computeSuspensionWindowStart(now, windowDays));

      const thresholdCount = await this.policyStore.getRequiredInteger('queueing.noShow.suspensionThresholdCount');
      if (shouldSuspendForNoShows(rollingNoShowCount, thresholdCount)) {
        const durationDays = await this.policyStore.getRequiredInteger('queueing.noShow.suspensionDurationDays');
        const suspendedUntil = computeSuspensionUntil(now, durationDays);
        await this.suspensionRepository.createSuspension(outcome.appointment.studentId, suspendedUntil, rollingNoShowCount);
        suspensionApplied = { suspendedUntil };

        await this.enqueueNotification({
          recipientId: outcome.appointment.studentId,
          templateKey: 'booking_suspended',
          payload: { suspendedUntil: suspendedUntil.toISOString(), noShowCount: rollingNoShowCount },
          channel: 'in_app',
          correlationId: input.correlationId,
        });
      }
    }

    return ok({ appointment: outcome.appointment, rollingNoShowCount, suspensionApplied, replay: false });
  }
}
