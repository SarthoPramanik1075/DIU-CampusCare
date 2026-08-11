import type { PaymentState } from '../../../infrastructure/database/client.js';
import type { AppointmentStatus } from '../domain/appointment-status.js';

/** Everything `book-appointment.handler.ts` needs to know about the slot being committed to, gathered in one read so the handler never has to re-derive it. */
export interface SlotBookingContext {
  readonly slotId: string;
  readonly sessionId: string;
  readonly doctorId: string;
  readonly doctorName: string;
  readonly locationId: string;
  readonly sessionDate: string;
  readonly slotStartsAt: Date;
  readonly sessionStartsAt: Date;
  readonly isOnlineBookable: boolean;
}

export interface AvailableSlotItem {
  readonly slotId: string;
  readonly slotStartsAt: Date;
}

export interface BookedAppointment {
  readonly appointmentId: string;
  readonly appointmentRef: string;
  readonly clinicSessionId: string;
  readonly doctorId: string;
  readonly doctorName: string;
  readonly sessionDate: string;
  readonly serialNumber: number;
  readonly status: AppointmentStatus;
  readonly estimateAtBooking: Date;
  readonly paymentStatus: PaymentState;
  readonly version: number;
}

export interface CreateBookingInput {
  readonly slot: SlotBookingContext;
  readonly studentId: string;
  readonly visitReasonCategoryId: string | null;
  readonly visitReasonNote: string | null;
  readonly createdBy: string;
}

export type CreateBookingOutcome = { readonly outcome: 'created'; readonly appointment: BookedAppointment } | { readonly outcome: 'slot_taken' };

export interface ServiceCalendarClosure {
  readonly reason: string;
}

export interface ActiveSuspension {
  readonly suspendedUntil: Date;
}

/** BR-11's "active" set: still occupying a place in a queue, one way or another — matches `uq_appointment_student_session_active`'s own predicate. */
export const ACTIVE_BOOKING_STATUSES = ['booked', 'checked_in', 'waiting', 'in_consultation'] as const;

export interface AppointmentRepository {
  findSlotBookingContext(sessionSlotId: string): Promise<SlotBookingContext | null>;
  listAvailableSlots(sessionId: string): Promise<readonly AvailableSlotItem[]>;
  findServiceCalendarClosure(locationId: string, sessionDate: string): Promise<ServiceCalendarClosure | null>;
  countActiveBookings(studentId: string): Promise<number>;
  hasActiveBookingWithDoctorOnDate(studentId: string, doctorId: string, sessionDate: string): Promise<boolean>;
  /** Batch form of {@link hasActiveBookingWithDoctorOnDate} — one query for an entire availability list (S-02) instead of one per session. Keys are `${doctorId}:${sessionDate}`. */
  listActiveBookingKeysForStudent(studentId: string): Promise<ReadonlySet<string>>;
  findActiveSuspension(studentId: string, now: Date): Promise<ActiveSuspension | null>;
  createBooking(input: CreateBookingInput): Promise<CreateBookingOutcome>;
}
