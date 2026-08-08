export interface UnavailabilityRecord {
  readonly unavailabilityId: string;
  readonly doctorId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly reason: string;
  readonly createdBy: string;
  readonly createdAt: Date;
}

/** One booking that would be (or was) cancelled by a leave period. BR-04: no clinical detail, only what's needed to notify and reconcile payment. */
export interface AffectedAppointmentDetail {
  readonly appointmentId: string;
  readonly appointmentRef: string;
  readonly studentId: string | null;
  readonly studentRef: string | null;
  readonly studentName: string | null;
  readonly sessionDate: string;
  readonly serialNumber: number;
  readonly paymentStatus: string;
  /** True where a payment exists — Phase 1 has no automated refund (EC-24), so this is a manual-review flag. */
  readonly requiresRefundFlag: boolean;
}

/** BR-27 — every affected student must be offered remaining alternatives; computed here so the notification can carry them. */
export interface AlternativeAvailabilityEntry {
  readonly doctorName: string;
  readonly sessionDate: string;
  readonly remainingSlots: number;
}

export interface ImpactAnalysis {
  readonly affectedSessions: number;
  readonly affectedAppointments: readonly AffectedAppointmentDetail[];
  readonly alternativeAvailability: readonly AlternativeAvailabilityEntry[];
}

export interface PreviewRecord {
  readonly previewToken: string;
  readonly doctorId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly reason: string;
  readonly affectedAppointmentIds: readonly string[];
  readonly expiresAt: Date;
}

export type CreateUnavailabilityOutcome =
  /** Ids actually transitioned to `cancelled` — a subset of what was asked for if a race narrowed it between the confirm check and this write. The caller (which already holds the full `AffectedAppointmentDetail[]` from its own `computeImpact` call) cross-references this list rather than the repository re-querying joins it already has. */
  | { readonly outcome: 'created'; readonly unavailabilityId: string; readonly cancelledAppointmentIds: readonly string[] }
  | { readonly outcome: 'overlap'; readonly conflicting: UnavailabilityRecord };

export type DeleteUnavailabilityOutcome = 'deleted' | 'not_found';

/**
 * Port for API §3.4's two-step doctor-unavailability flow. RST-02
 * (`000_AMENDMENTS.md`) — overlap is an application-level check, not a
 * GiST exclusion constraint the way `ex_session_no_overlap` is for
 * sessions, because recording leave is staff data entry, not a
 * concurrent booking-adjacent path.
 */
export interface UnavailabilityRepository {
  doctorExists(doctorId: string): Promise<boolean>;
  findOverlappingUnavailability(doctorId: string, startDate: string, endDate: string): Promise<UnavailabilityRecord | null>;
  /** Every open booking in the doctor's sessions across `[startDate, endDate]`, plus same-day alternatives with other doctors. A read — never writes anything. */
  computeImpact(doctorId: string, startDate: string, endDate: string): Promise<ImpactAnalysis>;
  createPreview(doctorId: string, startDate: string, endDate: string, reason: string, affectedAppointmentIds: readonly string[], expiresAt: Date): Promise<{ readonly previewToken: string }>;
  /** Null if the token doesn't exist, doesn't belong to this doctor, or has expired. */
  findPreview(previewToken: string, doctorId: string): Promise<PreviewRecord | null>;
  /** Inserts the leave record and cancels every id in `affectedAppointmentIds` still in an open status, in one transaction. */
  createUnavailability(doctorId: string, startDate: string, endDate: string, reason: string, affectedAppointmentIds: readonly string[], createdBy: string): Promise<CreateUnavailabilityOutcome>;
  listUnavailability(doctorId: string, from: string, to: string): Promise<readonly UnavailabilityRecord[]>;
  findUnavailabilityById(unavailabilityId: string): Promise<UnavailabilityRecord | null>;
  deleteUnavailability(unavailabilityId: string): Promise<DeleteUnavailabilityOutcome>;
}
