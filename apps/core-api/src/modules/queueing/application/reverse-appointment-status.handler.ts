import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, ConflictError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import type { PolicyStore } from '../../../kernel/policy/policy-store.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import type { AppointmentStatus } from '../domain/appointment-status.js';
import { isValidReason } from '../domain/booking-validation.js';
import { computeSuspensionWindowStart, shouldSuspendForNoShows } from '../domain/no-show-suspension.js';

import type { AppointmentDetail, AppointmentRepository } from './appointment-repository.js';
import type { BookingSuspensionRepository } from './booking-suspension-repository.js';
import { appointmentNotFoundError } from './cancel-appointment.handler.js';

export interface ReverseAppointmentStatusCommandInput {
  readonly appointmentId: string;
  readonly toStatus: AppointmentStatus;
  readonly reason: string;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface ReverseAppointmentStatusResult {
  readonly appointment: AppointmentDetail;
  readonly reversedFrom: AppointmentStatus;
  readonly suspensionRecalculated: boolean;
}

function staleError(current: AppointmentDetail): ConflictError {
  return new ConflictError({
    code: 'CONFLICT_STALE_VERSION',
    message: "Someone else just updated this patient. Here's the current state.",
    details: { current: { appointmentId: current.appointmentId, status: current.status, version: current.version } },
  });
}

/**
 * `POST /api/v1/appointments/{id}/reverse` (API §4.3, VR-32, FR-APT-34,
 * EC-16, M3-T10). Deliberately no `Idempotency-Key` support (API.md: "a
 * reversal is a deliberate corrective act and must not replay").
 * Reversing a No-show re-evaluates BR-15's rolling count and lifts a
 * suspension that count no longer supports — the recalculation is scoped
 * to "reversed from no_show", the only source state that can have caused
 * one.
 */
export class ReverseAppointmentStatusHandler {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly suspensionRepository: BookingSuspensionRepository,
    private readonly policyStore: PolicyStore,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: ReverseAppointmentStatusCommandInput,
  ): Promise<Result<ReverseAppointmentStatusResult, ValidationError | AuthorizationError | DomainRuleViolation | ConflictError>> {
    if (!isValidReason(input.reason)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Give a reason of at least 10 characters for the correction.',
          fields: [{ field: 'reason', rule: 'VR-93', message: 'At least 10 characters' }],
        }),
      );
    }

    const detail = await this.repository.findAppointmentDetail(input.appointmentId);
    if (detail === null) return err(appointmentNotFoundError());
    const reversedFrom = detail.status;

    const outcome = await this.repository.reverseStatus(input.appointmentId, input.toStatus, input.expectedVersion);

    if (outcome.outcome === 'not_found') return err(appointmentNotFoundError());
    if (outcome.outcome === 'invalid_reversal_target') {
      return err(new DomainRuleViolation({ code: 'INVALID_REVERSAL_TARGET', message: 'This patient was never in that state.' }));
    }
    if (outcome.outcome === 'session_already_ended') {
      return err(new DomainRuleViolation({ code: 'SESSION_ALREADY_ENDED', message: 'That session has ended. A correction now needs an administrator.' }));
    }
    if (outcome.outcome === 'invalid_transition') {
      return err(new DomainRuleViolation({ code: 'INVALID_REVERSAL_TARGET', message: 'This patient was never in that state.' }));
    }
    if (outcome.outcome === 'stale') return err(staleError(outcome.current));

    await this.auditRecorder.recordChange({
      entityType: 'queueing.appointment',
      entityId: input.appointmentId,
      action: 'status_reversed',
      beforeState: { status: reversedFrom },
      afterState: { status: outcome.appointment.status, reason: input.reason },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    let suspensionRecalculated = false;

    if (reversedFrom === 'no_show' && outcome.appointment.studentId !== null) {
      const now = this.clock.now();
      const active = await this.suspensionRepository.findActiveSuspensionDetail(outcome.appointment.studentId, now);
      if (active !== null) {
        suspensionRecalculated = true;
        const windowDays = await this.policyStore.getRequiredInteger('queueing.noShow.suspensionWindowDays');
        const thresholdCount = await this.policyStore.getRequiredInteger('queueing.noShow.suspensionThresholdCount');
        const rollingNoShowCount = await this.suspensionRepository.countRecentNoShows(outcome.appointment.studentId, computeSuspensionWindowStart(now, windowDays));

        if (!shouldSuspendForNoShows(rollingNoShowCount, thresholdCount)) {
          await this.suspensionRepository.liftActiveSuspension(outcome.appointment.studentId, input.actorId, input.reason, now);
        }
      }
    }

    return ok({ appointment: outcome.appointment, reversedFrom, suspensionRecalculated });
  }
}
