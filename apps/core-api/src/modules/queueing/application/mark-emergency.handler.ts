import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, ConflictError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import type { EnqueueNotificationInput } from '../../../kernel/notifications/enqueue-notification.js';
import type { PolicyStore } from '../../../kernel/policy/policy-store.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isValidReason } from '../domain/booking-validation.js';
import { orderQueue } from '../domain/queue-ordering.js';

import type { AppointmentDetail, AppointmentRepository, WaitingQueueEntry } from './appointment-repository.js';
import { appointmentNotFoundError } from './cancel-appointment.handler.js';

type NotifiableWaitingEntry = WaitingQueueEntry & { readonly studentId: string };

function hasStudentId(entry: WaitingQueueEntry): entry is NotifiableWaitingEntry {
  return entry.studentId !== null;
}

export interface MarkEmergencyCommandInput {
  readonly appointmentId: string;
  readonly reason: string;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface MarkEmergencyResult {
  readonly appointment: AppointmentDetail;
  readonly position: number;
  readonly patientsNotified: number;
  readonly notificationSuppressed: boolean;
}

function staleError(current: AppointmentDetail): ConflictError {
  return new ConflictError({
    code: 'CONFLICT_STALE_VERSION',
    message: "Someone else just updated this patient. Here's the current state.",
    details: { current: { appointmentId: current.appointmentId, status: current.status, version: current.version } },
  });
}

/**
 * `POST /api/v1/appointments/{id}/emergency` (API §4.3, VR-30, FR-APT-39/40,
 * BR-17, EC-11/12, M3-T11). `repository.markEmergency` hands back every
 * other still-active entry in the session so this handler can apply EC-12's
 * throttle per student — a cross-cutting notification decision, not
 * something the repository's own state-transition method should own.
 */
export class MarkEmergencyHandler {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly policyStore: PolicyStore,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
    private readonly enqueueNotification: (input: EnqueueNotificationInput) => Promise<void>,
  ) {}

  async execute(input: MarkEmergencyCommandInput): Promise<Result<MarkEmergencyResult, ValidationError | AuthorizationError | DomainRuleViolation | ConflictError>> {
    if (!isValidReason(input.reason)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Give a reason of at least 10 characters for the emergency.',
          fields: [{ field: 'reason', rule: 'VR-30', message: 'At least 10 characters' }],
        }),
      );
    }

    const outcome = await this.repository.markEmergency(input.appointmentId, input.expectedVersion, input.reason);

    if (outcome.outcome === 'not_found') return err(appointmentNotFoundError());
    if (outcome.outcome === 'already_emergency') {
      return err(new DomainRuleViolation({ code: 'ALREADY_EMERGENCY', message: 'This patient is already marked as an emergency.' }));
    }
    if (outcome.outcome === 'invalid_transition') {
      return err(new DomainRuleViolation({ code: 'INVALID_STATUS_TRANSITION', message: 'This patient has already been seen or has left the queue.' }));
    }
    if (outcome.outcome === 'stale') return err(staleError(outcome.current));

    await this.auditRecorder.recordChange({
      entityType: 'queueing.appointment',
      entityId: input.appointmentId,
      action: 'marked_emergency',
      afterState: { isEmergency: true, reason: input.reason },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    const now = this.clock.now();
    const throttleMinutes = await this.policyStore.getRequiredInteger('queueing.emergency.notificationThrottleMinutes');
    const throttleMs = throttleMinutes * 60 * 1000;

    const candidates = outcome.waitingAppointments.filter(hasStudentId);
    const toNotify = candidates.filter((entry) => entry.lastSlipNotifiedAt === null || now.getTime() - entry.lastSlipNotifiedAt.getTime() >= throttleMs);

    for (const entry of toNotify) {
      await this.enqueueNotification({
        recipientId: entry.studentId,
        templateKey: 'emergency_inserted',
        payload: { appointmentRef: outcome.appointment.appointmentRef },
        channel: 'in_app',
        correlationId: input.correlationId,
      });
    }

    if (toNotify.length > 0) {
      await this.repository.updateLastSlipNotifiedAt(
        toNotify.map((entry) => entry.appointmentId),
        now,
      );
    }

    const entries = orderQueue(await this.repository.listActiveQueueEntries(outcome.appointment.clinicSessionId));
    const index = entries.findIndex((entry) => entry.appointmentId === outcome.appointment.appointmentId);

    return ok({
      appointment: outcome.appointment,
      position: index === -1 ? 0 : index + 1,
      patientsNotified: toNotify.length,
      notificationSuppressed: candidates.length > 0 && toNotify.length < candidates.length,
    });
  }
}
