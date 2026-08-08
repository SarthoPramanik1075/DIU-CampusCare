import type { DerivedSlot } from '../domain/slot-derivation.js';

export type SessionStatus = 'scheduled' | 'started' | 'interrupted' | 'completed' | 'cancelled';

export interface ClinicSessionListFilter {
  readonly from: string;
  readonly to: string;
  readonly doctorId?: string;
  readonly status?: SessionStatus;
}

export interface ClinicSessionListItem {
  readonly sessionId: string;
  readonly doctorId: string;
  readonly doctorName: string;
  readonly locationId: string;
  readonly sessionDate: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly slotLengthMinutes: number;
  readonly walkInAllocationPct: number;
  readonly totalSlotCount: number;
  readonly bookableSlotCount: number;
  readonly bookedSlotCount: number;
  readonly status: SessionStatus;
  readonly nextSerial: number;
  readonly actuallyStartedAt: Date | null;
  readonly actuallyEndedAt: Date | null;
  readonly changeReason: string | null;
  readonly isOverride: boolean;
  readonly version: number;
}

export interface ServiceCalendarClosure {
  readonly id: string;
  readonly calendarDate: string;
  readonly reason: string;
}

export interface CreateClinicSessionInput {
  readonly doctorId: string;
  readonly locationId: string;
  readonly dutyRosterId: string | null;
  readonly sessionDate: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly slotLengthMinutes: number;
  readonly walkInAllocationPct: number;
  readonly changeReason: string | null;
  readonly totalSlotCount: number;
  readonly bookableSlotCount: number;
  readonly slots: readonly DerivedSlot[];
  readonly createdBy: string;
}

export type CreateClinicSessionResult =
  | { readonly outcome: 'created'; readonly session: ClinicSessionListItem }
  | { readonly outcome: 'overlap'; readonly conflictingSession: ClinicSessionListItem };

export interface UpdateClinicSessionInput {
  readonly sessionId: string;
  readonly startsAt: Date | undefined;
  readonly endsAt: Date | undefined;
  readonly slotLengthMinutes: number | undefined;
  readonly walkInAllocationPct: number | undefined;
  readonly changeReason: string | null | undefined;
  readonly totalSlotCount: number | undefined;
  readonly bookableSlotCount: number | undefined;
  readonly slots: readonly DerivedSlot[] | undefined;
  readonly expectedVersion: number;
}

export type UpdateClinicSessionOutcome =
  | { readonly outcome: 'updated'; readonly session: ClinicSessionListItem }
  | { readonly outcome: 'overlap'; readonly conflictingSession: ClinicSessionListItem }
  | { readonly outcome: 'stale' }
  | { readonly outcome: 'not_found' };

export interface SessionSlotItem {
  readonly slotId: string;
  readonly slotIndex: number;
  readonly slotStartsAt: Date;
  /** Reflects the moment of the read (API §3.3) — the authoritative check is at booking commit (VR-20, EC-01), which does not exist until M3. */
  readonly isAvailable: boolean;
}

/** API §3.3 `GET /sessions/{id}/queue`'s aggregate-only counterpart, embedded in the session detail response. Honestly zero until M3 books appointments. */
export interface QueueSummary {
  readonly waiting: number;
  readonly completed: number;
  readonly noShow: number;
  readonly inConsultation: number;
}

/** An appointment affected by a lifecycle transition — enough to notify its owner (FR-SCH-08/09), never any clinical detail (BR-04). */
export interface AffectedAppointment {
  readonly appointmentId: string;
  readonly appointmentRef: string;
  readonly studentId: string | null;
  readonly serialNumber: number;
}

export type StartSessionOutcome =
  | { readonly outcome: 'started'; readonly session: ClinicSessionListItem }
  | { readonly outcome: 'invalid_transition' }
  | { readonly outcome: 'stale' }
  | { readonly outcome: 'not_found' };

export type InterruptSessionOutcome =
  | { readonly outcome: 'interrupted'; readonly session: ClinicSessionListItem; readonly remainingAppointments: readonly AffectedAppointment[] }
  | { readonly outcome: 'invalid_transition' }
  | { readonly outcome: 'stale' }
  | { readonly outcome: 'not_found' };

export type CompleteSessionOutcome =
  | { readonly outcome: 'completed'; readonly session: ClinicSessionListItem; readonly expiredAppointments: readonly AffectedAppointment[] }
  | { readonly outcome: 'invalid_transition' }
  | { readonly outcome: 'consultation_in_progress' }
  | { readonly outcome: 'stale' }
  | { readonly outcome: 'not_found' };

export type CancelSessionOutcome =
  | { readonly outcome: 'cancelled'; readonly session: ClinicSessionListItem; readonly cancelledAppointments: readonly AffectedAppointment[] }
  | { readonly outcome: 'invalid_transition' }
  | { readonly outcome: 'stale' }
  | { readonly outcome: 'not_found' };

/**
 * Port for API §3.3's clinic-session administration. VR-19 (no two
 * sessions for a doctor may overlap) is enforced by the
 * `ex_session_no_overlap` GiST exclusion constraint — race-free by
 * construction — so `overlap` outcomes here reflect that constraint
 * (pre-checked for a friendly error, re-checked on an actual constraint
 * violation), never an application-level check-then-insert.
 */
export interface ClinicSessionRepository {
  listClinicSessions(filter: ClinicSessionListFilter): Promise<readonly ClinicSessionListItem[]>;
  findClinicSessionById(sessionId: string): Promise<ClinicSessionListItem | null>;
  /** API §3.3's `POST /sessions` body carries no `locationId` — a session inherits the doctor's own. Null means the doctor id doesn't exist. */
  findDoctorLocationId(doctorId: string): Promise<string | null>;
  findServiceCalendarClosure(locationId: string, sessionDate: string): Promise<ServiceCalendarClosure | null>;
  countBookedAppointments(sessionId: string): Promise<number>;
  createClinicSession(input: CreateClinicSessionInput): Promise<CreateClinicSessionResult>;
  updateClinicSession(input: UpdateClinicSessionInput): Promise<UpdateClinicSessionOutcome>;
  /** Only `is_online_bookable` slots (API §3.3's own documented filter) — filtering to `availableOnly` is the query layer's job, not the repository's, so callers can still compute a summary over the full set. */
  listSessionSlots(sessionId: string): Promise<readonly SessionSlotItem[]>;
  getQueueSummary(sessionId: string): Promise<QueueSummary>;
  /** Every appointment not yet in a terminal state — the "would be affected" preview `POST /sessions/{id}/cancel` shows before `confirmedImpact` is required (API §3.3's `CONFIRMATION_REQUIRED`). A read, never a mutation. */
  listOpenAppointments(sessionId: string): Promise<readonly AffectedAppointment[]>;
  /** EC-02/FR-APT-25 — `canStart` (domain) allows both `scheduled` and `interrupted`; the actual start time is only ever set once, never overwritten on a resume. */
  startSession(sessionId: string, expectedVersion: number, now: Date): Promise<StartSessionOutcome>;
  /** EC-04 — bookings are never auto-cancelled here; only listed for staff to act on. */
  interruptSession(sessionId: string, expectedVersion: number, reason: string): Promise<InterruptSessionOutcome>;
  countInConsultation(sessionId: string): Promise<number>;
  /** BR-22/EC-13 — only appointments still `booked` transition to `expired`; no penalty, and it is never `no_show` (FR-APT-32 keeps that a staff decision). */
  completeSession(sessionId: string, expectedVersion: number, now: Date): Promise<CompleteSessionOutcome>;
  /** BR-26/BR-27 — every non-terminal appointment in the session transitions to `cancelled` with the fixed reason "Doctor Unavailable" (the caller's own `reason` is recorded against the session, not the appointment). */
  cancelSession(sessionId: string, expectedVersion: number, reason: string): Promise<CancelSessionOutcome>;
}
