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

/** `GET /api/v1/sessions/{id}/queue`'s (API §4.2) own self-sufficient read — queried directly rather than through `modules/scheduling`'s `GetClinicSessionQuery`, since the DOC ownership check needs `doctorUserAccountId`, a field that query's own shape has no reason to carry. */
export interface SessionQueueContext {
  readonly sessionId: string;
  readonly doctorId: string;
  readonly doctorName: string;
  readonly doctorUserAccountId: string | null;
  readonly sessionStatus: string;
  readonly sessionDate: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** FR-APT-22's floor and EC-15's anomaly ceiling are both expressed relative to this — reused here rather than re-fetched by `RecalculateSessionEstimatesHandler`. */
  readonly slotLengthMinutes: number;
  readonly totalSlotCount: number;
  readonly bookableSlotCount: number;
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
  readonly noShowMarkedAt: Date | null;
  readonly noShowMarkedBy: string | null;
  /** The command-buffer replay column (§5.6, DDL comment on `queueing.appointment.idempotency_key`) — the key that last successfully mutated this row, if any. */
  readonly idempotencyKey: string | null;
  readonly calledAt: Date | null;
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

/** F-01's console row (API §4.2) — everything the staff table needs to render one patient without a second round trip. */
export interface QueueConsoleRow {
  readonly appointmentId: string;
  readonly appointmentRef: string;
  readonly serialNumber: number;
  readonly isEmergency: boolean;
  readonly status: AppointmentStatus;
  readonly origin: 'booked' | 'walk_in';
  /** Not part of the console DTO — carried through for FR-AUD-03's per-distinct-student audit write, same as `preview-unavailability.handler.ts`'s. */
  readonly studentId: string | null;
  readonly studentRef: string | null;
  readonly studentName: string | null;
  readonly unregisteredName: string | null;
  readonly currentEstimate: Date | null;
  readonly checkedInAt: Date | null;
  readonly paymentStatus: PaymentState;
  readonly exceededWalkinAllocation: boolean;
  readonly enteredRetrospectively: boolean;
  readonly version: number;
}

/** Shared shape for every queue-transition command (check-in, advance, no-show, reverse, emergency) — one row's before/after, or why it didn't happen. */
export type TransitionOutcome =
  | { readonly outcome: 'success'; readonly appointment: AppointmentDetail; readonly replay?: true }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'invalid_transition' }
  | { readonly outcome: 'stale'; readonly current: AppointmentDetail };

export type NoShowOutcome = TransitionOutcome | { readonly outcome: 'grace_period_not_elapsed'; readonly remainingSeconds: number };

/** One other still-active entry in the same session as a just-marked emergency — `markEmergency`'s own material for EC-12's per-student notification throttle, decided by the handler rather than the repository. */
export interface WaitingQueueEntry {
  readonly appointmentId: string;
  readonly studentId: string | null;
  readonly lastSlipNotifiedAt: Date | null;
}

export type EmergencyOutcome =
  | { readonly outcome: 'success'; readonly appointment: AppointmentDetail; readonly waitingAppointments: readonly WaitingQueueEntry[] }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'invalid_transition' }
  | { readonly outcome: 'already_emergency' }
  | { readonly outcome: 'stale'; readonly current: AppointmentDetail };

export type ReversalOutcome =
  | TransitionOutcome
  | { readonly outcome: 'session_already_ended' }
  | { readonly outcome: 'invalid_reversal_target' };

/** `RecalculateSessionEstimatesHandler`'s own read (M3-G, FR-APT-21) — every entry still occupying a place in the live queue, with just enough to order it (`orderQueue`) and decide whether it has slipped (`domain/estimation.ts`'s `shouldNotifySlip`). */
export interface RecalculationTargetRow {
  readonly appointmentId: string;
  readonly serialNumber: number;
  readonly isEmergency: boolean;
  readonly status: AppointmentStatus;
  readonly studentId: string | null;
  readonly estimateAtBooking: Date | null;
  readonly lastSlipNotifiedAt: Date | null;
}

export interface EstimateAccuracySampleInput {
  readonly appointmentId: string;
  readonly doctorId: string;
  readonly predictedAt: Date;
  readonly actualStartedAt: Date;
  readonly deviationMinutes: number;
}

/** `ExpireUnstartedSessionBookingsHandler`'s own read (M3-H, FR-APT-33/BR-22/EC-13) — enough about one just-expired booking to send its apology-and-rebooking notice. */
export interface ExpiredBookingNotice {
  readonly appointmentId: string;
  readonly appointmentRef: string;
  readonly clinicSessionId: string;
  readonly studentId: string | null;
  readonly doctorName: string;
  readonly sessionDate: string;
}

/** VR-29 resolution (M3-I) — `POST /walk-ins`'s `studentRef` half. */
export interface StudentByRef {
  readonly studentId: string;
  readonly fullName: string;
}

export interface CreateWalkInInput {
  readonly clinicSessionId: string;
  readonly studentId: string | null;
  readonly unregisteredName: string | null;
  readonly visitReasonCategoryId: string | null;
  readonly isEmergency: boolean;
  readonly emergencyReason: string | null;
  readonly createdBy: string;
  readonly idempotencyKey: string | null;
}

/** A walk-in enters the queue already `waiting` (FR-APT-35) — staff registering them at the counter is itself the arrival event a booked patient's separate check-in step exists for. */
export interface WalkInAppointment {
  readonly appointmentId: string;
  readonly appointmentRef: string;
  readonly clinicSessionId: string;
  readonly serialNumber: number;
  readonly status: AppointmentStatus;
  readonly isEmergency: boolean;
  readonly currentEstimate: Date | null;
  readonly exceededWalkinAllocation: boolean;
  readonly studentId: string | null;
  readonly version: number;
}

export type CreateWalkInOutcome =
  | { readonly outcome: 'created'; readonly appointment: WalkInAppointment; readonly replay?: true }
  /** `uq_appointment_student_session_active` fired for a reason other than idempotency replay — this student already has an active entry in this session. */
  | { readonly outcome: 'already_active_in_session' };

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
  listMyAppointments(studentId: string, scope: AppointmentListScope, todayIsoDate: string, limit: number): Promise<readonly MyAppointmentListItem[]>;
  cancelAppointment(appointmentId: string, expectedVersion: number, classification: 'cancelled' | 'late_cancellation', reason: string | null, now: Date): Promise<CancelAppointmentOutcome>;
  listActiveQueueEntries(clinicSessionId: string): Promise<readonly QueueEntrySummary[]>;
  /** F-01's console rows for one session — every non-terminal-or-recently-terminal entry, unordered (the caller applies `orderQueue`). */
  listConsoleRows(clinicSessionId: string): Promise<readonly QueueConsoleRow[]>;
  findSessionQueueContext(sessionId: string): Promise<SessionQueueContext | null>;
  checkIn(appointmentId: string, expectedVersion: number, now: Date, idempotencyKey: string | null): Promise<TransitionOutcome>;
  advance(appointmentId: string, toStatus: AppointmentStatus, expectedVersion: number, now: Date, idempotencyKey: string | null): Promise<TransitionOutcome>;
  /** First call against a row with no `called_at` starts VR-31's grace-period clock rather than immediately rejecting or succeeding — there is no separate "call" endpoint (API §4.3's own list), so this is where that moment is recorded. */
  markNoShow(appointmentId: string, expectedVersion: number, now: Date, gracePeriodMinutes: number, actorId: string, idempotencyKey: string | null): Promise<NoShowOutcome>;
  /** Neither `reason` (VR-32) nor a timestamp is persisted on the row itself — nothing in DATABASE.md's schema has a slot for either — the handler records the reason via `AuditRecorder` instead, same as every other reason-only field this module doesn't have a column for. */
  reverseStatus(appointmentId: string, toStatus: AppointmentStatus, expectedVersion: number): Promise<ReversalOutcome>;
  markEmergency(appointmentId: string, expectedVersion: number, reason: string): Promise<EmergencyOutcome>;
  updateLastSlipNotifiedAt(appointmentIds: readonly string[], now: Date): Promise<void>;
  listRecalculationTargets(clinicSessionId: string): Promise<readonly RecalculationTargetRow[]>;
  listCompletedConsultationDurationsForSession(clinicSessionId: string): Promise<readonly number[]>;
  listDoctorTrailingConsultationDurations(doctorId: string, since: Date): Promise<readonly number[]>;
  updateCurrentEstimate(appointmentId: string, currentEstimate: Date, markSlipNotified: boolean, now: Date): Promise<void>;
  recordEstimateAccuracySample(input: EstimateAccuracySampleInput): Promise<void>;
  /** FR-APT-33/BR-22/EC-13 — every `booked` appointment in a session that ended (`ends_at < now`) while still `scheduled` (never started by staff) transitions to `expired`, never `no_show`. Returns one notice per row actually swept. */
  expireUnstartedSessionBookings(now: Date): Promise<readonly ExpiredBookingNotice[]>;
  findStudentByRef(studentRef: string): Promise<StudentByRef | null>;
  createWalkIn(input: CreateWalkInInput, now: Date): Promise<CreateWalkInOutcome>;
}
