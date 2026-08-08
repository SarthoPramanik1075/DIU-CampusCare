export interface DutyRosterListFilter {
  readonly doctorId: string;
  readonly isActive?: boolean;
}

export interface DutyRoster {
  readonly rosterId: string;
  readonly doctorId: string;
  readonly weekday: number;
  readonly startsAtLocal: string;
  readonly endsAtLocal: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly isActive: boolean;
  readonly version: number;
}

export interface CreateDutyRosterInput {
  readonly doctorId: string;
  readonly weekday: number;
  readonly startsAtLocal: string;
  readonly endsAtLocal: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly createdBy: string;
}

export type CreateDutyRosterResult =
  | { readonly outcome: 'created'; readonly roster: DutyRoster }
  | { readonly outcome: 'overlap'; readonly conflictingRoster: DutyRoster };

export interface UpdateDutyRosterInput {
  readonly rosterId: string;
  readonly weekday: number | undefined;
  readonly startsAtLocal: string | undefined;
  readonly endsAtLocal: string | undefined;
  readonly effectiveFrom: string | undefined;
  readonly effectiveTo: string | null | undefined;
  readonly expectedVersion: number;
}

export type UpdateDutyRosterOutcome =
  | { readonly outcome: 'updated'; readonly roster: DutyRoster }
  | { readonly outcome: 'overlap'; readonly conflictingRoster: DutyRoster }
  | { readonly outcome: 'stale' }
  | { readonly outcome: 'not_found' };

export type DeleteDutyRosterOutcome =
  | { readonly outcome: 'deleted' }
  | { readonly outcome: 'not_found' };

/**
 * Port for API §3.2's duty-roster administration. Overlap detection
 * (`ROSTER_OVERLAP`) is an application-level query, not a GiST exclusion
 * constraint the way `clinic_session` gets one — RST-01
 * (`000_AMENDMENTS.md`) documents why that gap is accepted for M2.
 */
export interface DutyRosterRepository {
  listDutyRosters(filter: DutyRosterListFilter): Promise<readonly DutyRoster[]>;
  findDutyRosterById(rosterId: string): Promise<DutyRoster | null>;
  doctorExists(doctorId: string): Promise<boolean>;
  createDutyRoster(input: CreateDutyRosterInput): Promise<CreateDutyRosterResult>;
  updateDutyRoster(input: UpdateDutyRosterInput): Promise<UpdateDutyRosterOutcome>;
  /** Sets `is_active = false` — the row is retained (P4), never deleted. */
  deleteDutyRoster(rosterId: string): Promise<DeleteDutyRosterOutcome>;
}
