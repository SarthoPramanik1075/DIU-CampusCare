import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { ConflictError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import type { PolicyStore } from '../../../kernel/policy/policy-store.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isBeforeBookingCutoff, isBelowMaxActiveBookings, isSlotInFuture, isValidVisitReasonNote, isWithinPublicationWindow } from '../domain/booking-validation.js';

import type { AppointmentRepository, AvailableSlotItem, BookedAppointment } from './appointment-repository.js';

export interface BookAppointmentCommandInput {
  readonly studentId: string;
  readonly sessionSlotId: string;
  readonly visitReasonCategoryId: string | null;
  readonly visitReasonNote: string | null;
  readonly actorId: string;
  readonly correlationId: string;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function slotTakenError(availableSlots: readonly AvailableSlotItem[]): ConflictError {
  return new ConflictError({
    code: 'SLOT_TAKEN',
    message: 'That slot was just taken. Here are the times still available.',
    details: { availableSlots: availableSlots.map((slot) => ({ slotId: slot.slotId, slotStartsAt: slot.slotStartsAt.toISOString() })) },
  });
}

/**
 * `POST /api/v1/appointments` (API §4.1, FR-APT-01…14, VR-20…25, EC-01,
 * M3-T01/T02/T03). The concurrency-critical handler: `uq_appointment_slot_active`
 * is the actual race-free guarantee (VR-20's "unbooked at the moment of
 * commit" is not something any pre-check here can make true by itself),
 * so every validation before the insert is a friendly pre-check that
 * exists to give a better error than "conflict" when the answer is
 * already knowable — the insert-time unique-violation catch in
 * `createBooking` is what `EC-01`'s test actually exercises.
 */
export class BookAppointmentHandler {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly policyStore: PolicyStore,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async execute(input: BookAppointmentCommandInput): Promise<Result<BookedAppointment, ValidationError | DomainRuleViolation | ConflictError>> {
    if (!isValidVisitReasonNote(input.visitReasonNote)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Keep the reason for your visit to 200 characters or fewer.',
          fields: [{ field: 'visitReasonNote', rule: 'VR-25', message: 'At most 200 characters' }],
        }),
      );
    }

    const now = this.clock.now();
    const slot = await this.repository.findSlotBookingContext(input.sessionSlotId);

    const publicationWindowDays = await this.policyStore.getRequiredInteger('scheduling.publicationWindowDays');
    const slotIsCommittable =
      slot !== null && slot.isOnlineBookable && isSlotInFuture(slot.slotStartsAt, now) && isWithinPublicationWindow(slot.sessionDate, toIsoDate(now), publicationWindowDays);

    if (!slotIsCommittable) {
      const availableSlots = slot === null ? [] : await this.repository.listAvailableSlots(slot.sessionId);
      return err(slotTakenError(availableSlots));
    }

    const closure = await this.repository.findServiceCalendarClosure(slot.locationId, slot.sessionDate);
    if (closure !== null) {
      return err(
        new DomainRuleViolation({
          code: 'NON_SERVICE_DAY',
          message: `That date is marked as a non-service day: ${closure.reason}. Choose another time.`,
        }),
      );
    }

    const cutoffMinutes = await this.policyStore.getRequiredInteger('scheduling.session.bookingCutoffMinutesBeforeStart');
    if (!isBeforeBookingCutoff(slot.sessionStartsAt, cutoffMinutes, now)) {
      return err(
        new DomainRuleViolation({
          code: 'BOOKING_CLOSED',
          message: 'Online booking has closed for this session.',
        }),
      );
    }

    const suspension = await this.repository.findActiveSuspension(input.studentId, now);
    if (suspension !== null) {
      return err(
        new DomainRuleViolation({
          code: 'BOOKING_SUSPENDED',
          message: `Online booking is paused until ${suspension.suspendedUntil.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Asia/Dhaka' })}. You can still walk in and be seen at any time.`,
          details: { suspendedUntil: suspension.suspendedUntil.toISOString(), walkInRemainsAvailable: true },
        }),
      );
    }

    const maxActiveBookings = await this.policyStore.getRequiredInteger('queueing.booking.maxActiveBookings');
    const activeCount = await this.repository.countActiveBookings(input.studentId);
    if (!isBelowMaxActiveBookings(activeCount, maxActiveBookings)) {
      return err(
        new DomainRuleViolation({
          code: 'BOOKING_LIMIT_REACHED',
          message: `You already have ${String(maxActiveBookings)} active bookings, the most allowed at once. Cancel one to book another.`,
        }),
      );
    }

    if (await this.repository.hasActiveBookingWithDoctorOnDate(input.studentId, slot.doctorId, slot.sessionDate)) {
      return err(
        new DomainRuleViolation({
          code: 'DUPLICATE_DOCTOR_DAY',
          message: `You already have a booking with ${slot.doctorName} that day.`,
        }),
      );
    }

    const outcome = await this.repository.createBooking({
      slot,
      studentId: input.studentId,
      visitReasonCategoryId: input.visitReasonCategoryId,
      visitReasonNote: input.visitReasonNote !== null && input.visitReasonNote.trim().length > 0 ? input.visitReasonNote.trim() : null,
      createdBy: input.actorId,
    });

    if (outcome.outcome === 'slot_taken') {
      const availableSlots = await this.repository.listAvailableSlots(slot.sessionId);
      return err(slotTakenError(availableSlots));
    }

    await this.auditRecorder.recordChange({
      entityType: 'queueing.appointment',
      entityId: outcome.appointment.appointmentId,
      action: 'created',
      afterState: { serialNumber: outcome.appointment.serialNumber, sessionId: outcome.appointment.clinicSessionId },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(outcome.appointment);
  }
}
