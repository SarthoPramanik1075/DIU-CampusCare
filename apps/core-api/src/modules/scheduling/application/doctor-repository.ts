export interface DoctorListFilter {
  readonly isActive?: boolean;
  readonly q?: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface DoctorListItem {
  readonly doctorId: string;
  readonly fullName: string;
  readonly designation: string | null;
  readonly specialisation: string | null;
  readonly photoUrl: string | null;
  readonly isActive: boolean;
  readonly version: number;
}

export interface DoctorListPage {
  readonly items: readonly DoctorListItem[];
  readonly nextCursor: string | null;
}

export interface DoctorDetail {
  readonly doctorId: string;
  readonly userAccountId: string | null;
  readonly fullName: string;
  readonly designation: string | null;
  readonly specialisation: string | null;
  readonly photoUrl: string | null;
  readonly isActive: boolean;
  /** API §3.1 `GET /doctors/{id}` — "Counts only; no appointment or patient data" (BR-04). */
  readonly activeRosterCount: number;
  readonly upcomingSessionCount: number;
  readonly version: number;
}

export interface CreateDoctorInput {
  readonly fullName: string;
  readonly designation: string | null;
  readonly specialisation: string | null;
  readonly photoUrl: string | null;
  /** Nullable by design — CON-02: no Phase 1 function depends on a doctor logging in. */
  readonly userAccountId: string | null;
  readonly locationId: string;
}

export type CreateDoctorResult =
  | { readonly outcome: 'created'; readonly doctor: DoctorDetail }
  | { readonly outcome: 'account_already_linked' };

export interface UpdateDoctorInput {
  readonly doctorId: string;
  readonly fullName: string | undefined;
  readonly designation: string | null | undefined;
  readonly specialisation: string | null | undefined;
  readonly photoUrl: string | null | undefined;
  readonly expectedVersion: number;
}

export type UpdateDoctorOutcome =
  | { readonly outcome: 'updated'; readonly doctor: DoctorDetail }
  | { readonly outcome: 'stale' }
  | { readonly outcome: 'not_found' };

export type DeactivateDoctorOutcome =
  | { readonly outcome: 'deactivated'; readonly doctor: DoctorDetail; readonly affectedUpcomingSessions: number }
  | { readonly outcome: 'stale' }
  | { readonly outcome: 'not_found' };

export type DeleteDoctorOutcome =
  | { readonly outcome: 'deleted' }
  | { readonly outcome: 'not_found' };

/**
 * Port for API §3.1's doctor-profile administration — `Session + Role(MCS)`
 * for writes, unauthenticated for reads (F-09/F-10; the matrix's
 * `doctor-profiles` row grants `ANON: read`).
 */
export interface DoctorRepository {
  /** API §3.1: `locationId` on create "defaults to [the] single Phase 1 location" — resolved here rather than a hardcoded id anywhere in application/interface code, so the lookup stays correct however that row ends up identified (DDL-05, `008_scheduling_extensions.sql`). */
  findDefaultLocationId(): Promise<string>;
  listDoctors(filter: DoctorListFilter): Promise<DoctorListPage>;
  findDoctorDetailById(doctorId: string): Promise<DoctorDetail | null>;
  isUserAccountLinked(userAccountId: string): Promise<boolean>;
  createDoctor(input: CreateDoctorInput): Promise<CreateDoctorResult>;
  updateDoctor(input: UpdateDoctorInput): Promise<UpdateDoctorOutcome>;
  deactivateDoctor(doctorId: string, expectedVersion: number): Promise<DeactivateDoctorOutcome>;
  /** EC-20's impact check — real query against `queueing.appointment`, honestly empty until M3 ships booking, same reasoning as `AccountAdminRepository.findActiveAppointmentsForStudent`. */
  countAppointmentHistory(doctorId: string): Promise<number>;
  deleteDoctor(doctorId: string): Promise<DeleteDoctorOutcome>;
}
