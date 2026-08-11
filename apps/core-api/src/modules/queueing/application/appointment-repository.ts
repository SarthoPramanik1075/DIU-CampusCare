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

/** Everything a caller could legitimately need about one appointment — `GET /appointments/{id}` (F-03/API §4.1) shapes its response *down* from this per role, rather than each role having its own query. */
export interface AppointmentDetail {
  readonly appointmentId: string;
  readonly appointmentRef: string;
  readonly clinicSessionId: string;
  readonly doctorId: string;
  readonly doctorName: string;
  /** The `DOC` ownership check (PRM-07) — `null` when the doctor has no linked login account (CON-02). */
  readonly doctorUserAccountId: string | null;
  readonly sessionDate: string;
  readonly sessionStatus: string;
  readonly studentId: string | null;
  readonly studentRef: string | null;
  readonly studentName: string | null;
  readonly unregisteredName: string | null;
  readonly serialNumber: number;
  readonly origin: 'booked' | 'walk_in';
  readonly status: AppointmentStatus;
  readonly isEmergency: boolean;
  readonly visitReasonNote: string | null;
  readonly estimateAtBooking: Date | null;
  readonly currentEstimate: Date | null;
  readonly paymentStatus: PaymentState;
  readonly checkedInAt: Date | null;
  readonly consultationStartedAt: Date | null;
  readonly consultationCompletedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly cancellationReason: string | null;
  readonly version: number;
}

export interface MyAppointmentListItem {
  readonly appointmentId: string;
  readonly appointmentRef: string;
  readonly doctorId: string;
  readonly doctorName: string;
  readonly sessionDate: string;
  readonly serialNumber: number;
  readonly status: AppointmentStatus;
  readonly currentEstimate: Date | null;
  readonly version: number;
}

export type AppointmentListScope = 'upcoming' | 'past' | 'all';

export interface CancelledAppointment {
  readonly appointmentId: string;
  readonly status: 'cancelled' | 'late_cancellation';
  readonly cancelledAt: Date;
  readonly version: number;
}

export type CancelAppointmentOutcome =
  | { readonly outcome: 'cancelled'; readonly appointment: CancelledAppointment }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'invalid_transition' }
  | { readonly outcome: 'stale'; readonly current: AppointmentDetail };

/** One row per still-active entry in a session's queue, ordered per `domain/queue-ordering.ts` — the shared basis for `patientsAhead` (S-07) and `nowServingSerial` (queue-position, console). */
export interface QueueEntrySummary {
  readonly appointmentId: string;
  readonly serialNumber: number;
  readonly isEmergency: boolean;
  readonly status: AppointmentStatus;
}

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
  findAppointmentDetail(appointmentId: string): Promise<AppointmentDetail | null>;
  /** DOC's own-session anti-enumeration check (PRM-07) — a cheap existence probe the route/query layer uses before deciding 404 vs. real data. */
  findDoctorIdForAppointment(appointmentId: string): Promise<string | null>;
  listMyAppointments(studentId: string, scope: AppointmentListScope, todayIsoDate: string, limit: number): Promise<readonly MyAppointmentListItem[]>;
  cancelAppointment(appointmentId: string, expectedVersion: number, classification: 'cancelled' | 'late_cancellation', reason: string | null, now: Date): Promise<CancelAppointmentOutcome>;
  listActiveQueueEntries(clinicSessionId: string): Promise<readonly QueueEntrySummary[]>;
}
