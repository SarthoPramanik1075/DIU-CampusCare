import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, ConflictError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import type { EnqueueNotificationInput } from '../../../kernel/notifications/enqueue-notification.js';
import type { PolicyStore } from '../../../kernel/policy/policy-store.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { classifyCancellation } from '../domain/booking-validation.js';

import type { AppointmentDetail, AppointmentRepository, CancelledAppointment } from './appointment-repository.js';

export interface CancelAppointmentCommandInput {
  readonly appointmentId: string;
  readonly requesterId: string;
  readonly requesterRole: 'STU' | 'MCS';
  readonly reason: string | null;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
}

export function appointmentNotFoundError(): AuthorizationError {
  return new AuthorizationError({ code: 'NOT_FOUND', message: 'That appointment could not be found.', httpStatus: 404 });
}

/**
 * `POST /api/v1/appointments/{id}/cancel` (API §4.1, S-08, M3-T04).
 * VR-26 permits cancelling `booked` or `checked_in` — EC-17's stricter
 * `CANNOT_CANCEL_CHECKED_IN` only applies when the *student* is the one
 * cancelling; staff cancelling a checked-in patient on their behalf is
 * not the case EC-17 is guarding against, so that extra check is scoped
 * to `requesterRole === 'STU'` and nothing else changes for MCS.
 */
export class CancelAppointmentHandler {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly policyStore: PolicyStore,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
    private readonly enqueueNotification: (input: EnqueueNotificationInput) => Promise<void>,
  ) {}

  async execute(input: CancelAppointmentCommandInput): Promise<Result<CancelledAppointment, ValidationError | AuthorizationError | DomainRuleViolation | ConflictError>> {
    const detail = await this.repository.findAppointmentDetail(input.appointmentId);
    if (detail === null) return err(appointmentNotFoundError());
    if (input.requesterRole === 'STU' && detail.studentId !== input.requesterId) return err(appointmentNotFoundError());

    if (input.requesterRole === 'STU' && detail.status === 'checked_in') {
      return err(
        new DomainRuleViolation({
          code: 'CANNOT_CANCEL_CHECKED_IN',
          message: "You're already checked in — speak to the front desk if you need to leave.",
        }),
      );
    }

    if (detail.status !== 'booked' && detail.status !== 'checked_in') {
      return err(
        new DomainRuleViolation({
          code: 'INVALID_STATUS_TRANSITION',
          message: 'This appointment can no longer be cancelled.',
        }),
      );
    }

    if (input.requesterRole === 'MCS' && (input.reason === null || input.reason.trim().length < 10)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a reason of at least 10 characters.',
          fields: [{ field: 'reason', rule: 'VR-93', message: 'Required for a staff-initiated cancellation' }],
        }),
      );
    }

    const now = this.clock.now();
    const cutoffMinutes = await this.policyStore.getRequiredInteger('queueing.booking.cancellationCutoffMinutes');
    const estimate = detail.currentEstimate ?? detail.estimateAtBooking;
    const classification = estimate === null ? 'late_cancellation' : classifyCancellation(estimate, cutoffMinutes, now);

    const outcome = await this.repository.cancelAppointment(input.appointmentId, input.expectedVersion, classification, input.reason, now);

    if (outcome.outcome === 'not_found') return err(appointmentNotFoundError());
    if (outcome.outcome === 'invalid_transition') {
      return err(new DomainRuleViolation({ code: 'INVALID_STATUS_TRANSITION', message: 'This appointment can no longer be cancelled.' }));
    }
    if (outcome.outcome === 'stale') {
      return err(
        new ConflictError({
          code: 'CONFLICT_STALE_VERSION',
          message: 'Someone else already changed this appointment. Here is its current state.',
          details: { current: staleDetailToDto(outcome.current) },
        }),
      );
    }

    if (detail.studentId !== null) {
      await this.enqueueNotification({
        recipientId: detail.studentId,
        templateKey: 'booking_cancelled_by_student',
        payload: { appointmentRef: detail.appointmentRef, doctorName: detail.doctorName, sessionDate: detail.sessionDate },
        channel: 'in_app',
        correlationId: input.correlationId,
      });
    }

    await this.auditRecorder.recordChange({
      entityType: 'queueing.appointment',
      entityId: input.appointmentId,
      action: 'cancelled',
      afterState: { status: outcome.appointment.status },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(outcome.appointment);
  }
}

function staleDetailToDto(detail: AppointmentDetail): Record<string, unknown> {
  return { appointmentId: detail.appointmentId, status: detail.status, version: detail.version };
}
