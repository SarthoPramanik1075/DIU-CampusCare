import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import type { EnqueueNotificationInput } from '../../../kernel/notifications/enqueue-notification.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isValidReason, isValidUnavailabilityRange } from '../domain/validation.js';

import { doctorNotFoundForUnavailabilityError } from './preview-unavailability.handler.js';
import type { UnavailabilityRepository } from './unavailability-repository.js';

export interface ConfirmUnavailabilityCommandInput {
  readonly doctorId: string;
  readonly previewToken: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly reason: string;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface ConfirmUnavailabilityResult {
  readonly unavailabilityId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly cancelledAppointments: number;
  readonly notificationsQueued: number;
  readonly notificationDeadline: Date;
  readonly paymentsFlaggedForRefund: number;
}

const NOTIFICATION_DEADLINE_MINUTES = 5;

/**
 * `POST /api/v1/doctors/{id}/unavailability` (API §3.4, step 2 of 2).
 * Re-derives the current affected set and diffs it against the preview's
 * stored snapshot — a booking added or removed since the preview is
 * `IMPACT_CHANGED`, never silently absorbed, because cancelling a booking
 * staff were never shown would defeat FR-SCH-07.
 */
export class ConfirmUnavailabilityHandler {
  constructor(
    private readonly repository: UnavailabilityRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
    private readonly enqueueNotification: (input: EnqueueNotificationInput) => Promise<void>,
  ) {}

  async execute(input: ConfirmUnavailabilityCommandInput): Promise<Result<ConfirmUnavailabilityResult, ValidationError | DomainRuleViolation | AuthorizationError>> {
    const today = this.clock.now().toISOString().slice(0, 10);
    if (!isValidUnavailabilityRange(input.startDate, input.endDate, today)) {
      return err(
        new ValidationError({
          code: 'INVALID_DATE_RANGE',
          message: "Choose a date range that ends on or after it starts, and isn't entirely in the past.",
          fields: [{ field: 'endDate', rule: 'VR-16', message: 'Must be on/after startDate and not entirely in the past' }],
        }),
      );
    }
    if (!isValidReason(input.reason)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a reason of at least 10 characters.',
          fields: [{ field: 'reason', rule: 'VR-93', message: 'Required' }],
        }),
      );
    }

    if (!(await this.repository.doctorExists(input.doctorId))) return err(doctorNotFoundForUnavailabilityError());

    const preview = await this.repository.findPreview(input.previewToken, input.doctorId);
    if (preview?.startDate !== input.startDate || preview.endDate !== input.endDate || preview.reason !== input.reason) {
      return err(
        new DomainRuleViolation({
          code: 'PREVIEW_REQUIRED',
          message: 'Review the affected bookings again before confirming — the details have changed.',
        }),
      );
    }

    const conflict = await this.repository.findOverlappingUnavailability(input.doctorId, input.startDate, input.endDate);
    if (conflict !== null) {
      return err(
        new DomainRuleViolation({
          code: 'UNAVAILABILITY_OVERLAP',
          message: 'This doctor already has leave recorded for those dates.',
          details: { conflicting: conflict },
        }),
      );
    }

    const current = await this.repository.computeImpact(input.doctorId, input.startDate, input.endDate);
    const currentIds = new Set(current.affectedAppointments.map((appointment) => appointment.appointmentId));
    const previewIds = new Set(preview.affectedAppointmentIds);
    const setsMatch = currentIds.size === previewIds.size && [...currentIds].every((id) => previewIds.has(id));
    if (!setsMatch) {
      return err(
        new DomainRuleViolation({
          code: 'IMPACT_CHANGED',
          message: `Someone booked or cancelled while you were reviewing. Check the updated list of ${String(current.affectedAppointments.length)} affected bookings and confirm again.`,
          details: { newAffectedCount: current.affectedAppointments.length },
        }),
      );
    }

    const outcome = await this.repository.createUnavailability(input.doctorId, input.startDate, input.endDate, input.reason, [...currentIds], input.actorId);
    if (outcome.outcome === 'overlap') {
      return err(
        new DomainRuleViolation({
          code: 'UNAVAILABILITY_OVERLAP',
          message: 'This doctor already has leave recorded for those dates.',
          details: { conflicting: outcome.conflicting },
        }),
      );
    }

    const cancelledIds = new Set(outcome.cancelledAppointmentIds);
    const cancelledAppointments = current.affectedAppointments.filter((appointment) => cancelledIds.has(appointment.appointmentId));
    const notifiable = cancelledAppointments.filter((appointment): appointment is typeof appointment & { studentId: string } => appointment.studentId !== null);

    for (const appointment of notifiable) {
      await this.enqueueNotification({
        recipientId: appointment.studentId,
        templateKey: 'doctor_unavailability_cancelled',
        payload: { sessionDate: appointment.sessionDate, serialNumber: appointment.serialNumber, refundNote: appointment.requiresRefundFlag ? 'Your payment has been flagged for a manual refund.' : '' },
        channel: 'in_app',
        correlationId: input.correlationId,
      });
    }

    await this.auditRecorder.recordChange({
      entityType: 'scheduling.doctor_unavailability',
      entityId: outcome.unavailabilityId,
      action: 'created',
      afterState: { startDate: input.startDate, endDate: input.endDate, reason: input.reason },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok({
      unavailabilityId: outcome.unavailabilityId,
      startDate: input.startDate,
      endDate: input.endDate,
      cancelledAppointments: cancelledAppointments.length,
      notificationsQueued: notifiable.length,
      notificationDeadline: new Date(this.clock.now().getTime() + NOTIFICATION_DEADLINE_MINUTES * 60 * 1000),
      paymentsFlaggedForRefund: cancelledAppointments.filter((appointment) => appointment.requiresRefundFlag).length,
    });
  }
}
