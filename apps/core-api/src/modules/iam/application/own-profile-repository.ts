import type { AccountStatus } from '../domain/user-account.js';

export interface OwnProfileAccount {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: AccountStatus;
  readonly version: number;
  /** `local` iff `identity.local_credential` has a row for this account — API §1.2. */
  readonly authMethod: 'sso' | 'local';
}

export interface StudentProfile {
  readonly studentRef: string;
  readonly programme: string | null;
  readonly isEnrolled: boolean;
}

export interface UpdateFullNameInput {
  readonly userAccountId: string;
  /** `undefined` when the request omitted `fullName` — a version-only, no-op PATCH. */
  readonly fullName: string | undefined;
  readonly expectedVersion: number;
  readonly now: Date;
}

export type UpdateFullNameOutcome =
  | { readonly outcome: 'updated'; readonly account: OwnProfileAccount }
  /** VR-92: the row's current `version` did not match `expectedVersion`. */
  | { readonly outcome: 'stale' };

/**
 * Port for `GET/PATCH /me` (API §1.2) — kept separate from
 * `AuthenticationRepository` (which this module's queries still use for
 * `loadActiveRoleCodes`) because it reads and writes a different slice of
 * `identity`: the caller's own editable profile, not login/session state.
 */
export interface OwnProfileRepository {
  findAccountById(userAccountId: string): Promise<OwnProfileAccount | null>;
  /** `null` for a non-student account — API §1.2 "studentProfile: null". */
  findStudentProfile(userAccountId: string): Promise<StudentProfile | null>;
  updateFullName(input: UpdateFullNameInput): Promise<UpdateFullNameOutcome>;
}
