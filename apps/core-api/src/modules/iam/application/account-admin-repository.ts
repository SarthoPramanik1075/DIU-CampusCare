import type { AuthenticatedRoleCode } from '@campuscare/shared-types';

import type { AccountStatus } from '../domain/user-account.js';

import type { StudentProfile } from './own-profile-repository.js';

export interface AccountListFilter {
  readonly q?: string;
  readonly status?: AccountStatus;
  readonly role?: AuthenticatedRoleCode;
  readonly limit: number;
  readonly cursor?: string;
}

export interface AccountListItem {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: AccountStatus;
  readonly roles: readonly AuthenticatedRoleCode[];
  readonly studentRef: string | null;
  readonly createdAt: Date;
  readonly version: number;
}

export interface AccountListPage {
  readonly items: readonly AccountListItem[];
  readonly nextCursor: string | null;
}

export interface RoleGrant {
  readonly code: AuthenticatedRoleCode;
  readonly grantedBy: string;
  readonly grantedAt: Date;
}

export interface AccountDetail {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: AccountStatus;
  readonly authMethod: 'sso' | 'local';
  readonly roles: readonly RoleGrant[];
  readonly studentProfile: StudentProfile | null;
  readonly lockedUntil: Date | null;
  readonly lastLoginAt: Date | null;
  readonly isClinicalStaff: boolean;
  readonly version: number;
}

export interface CreateAccountInput {
  readonly email: string;
  readonly fullName: string;
  readonly authMethod: 'sso' | 'local';
  /** Pre-hashed by the caller (Argon2id) — the repository never hashes anything. `null` for `authMethod: 'sso'`. */
  readonly passwordHash: string | null;
  readonly roles: readonly AuthenticatedRoleCode[];
  readonly isClinicalStaff: boolean;
  readonly locationId: string | null;
  readonly createdBy: string;
}

export type CreateAccountResult =
  | { readonly outcome: 'created'; readonly account: AccountDetail }
  | { readonly outcome: 'email_taken' };

export interface UpdateAccountAdminInput {
  readonly userId: string;
  readonly fullName: string | undefined;
  readonly isClinicalStaff: boolean | undefined;
  readonly locationId: string | null | undefined;
  readonly expectedVersion: number;
  readonly now: Date;
}

export type UpdateAccountAdminOutcome =
  | { readonly outcome: 'updated'; readonly account: AccountDetail }
  | { readonly outcome: 'stale' }
  | { readonly outcome: 'not_found' };

export interface ActiveAppointmentSummary {
  readonly appointmentRef: string;
  readonly sessionDate: string;
  readonly doctorName: string;
}

export interface TransitionStatusInput {
  readonly userId: string;
  readonly newStatus: AccountStatus;
  readonly expectedVersion: number;
  readonly now: Date;
}

/**
 * No `invalid_current_status` outcome: the calling handler always reads
 * the account (for `canSuspend`/`canActivate`/`canDeactivate`) immediately
 * before calling this with that same read's `version`, so a status change
 * that races the transition is exactly a `version` mismatch — 'stale'
 * already covers it without this port needing to re-derive it.
 */
export type TransitionStatusOutcome =
  | { readonly outcome: 'transitioned'; readonly account: AccountDetail }
  | { readonly outcome: 'stale' }
  | { readonly outcome: 'not_found' };

/**
 * Port for API §1.3's account-administration console — a distinct slice of
 * `identity` from `OwnProfileRepository` (a caller's own record) and
 * `AuthenticationRepository` (login/session plumbing): this one reads and
 * writes *other* accounts, always under `Session + Role(ADM)`.
 */
export interface AccountAdminRepository {
  listAccounts(filter: AccountListFilter): Promise<AccountListPage>;
  findAccountDetailById(userId: string): Promise<AccountDetail | null>;
  isEmailRegistered(email: string): Promise<boolean>;
  createAccount(input: CreateAccountInput): Promise<CreateAccountResult>;
  updateAccountAdmin(input: UpdateAccountAdminInput): Promise<UpdateAccountAdminOutcome>;
  transitionStatus(input: TransitionStatusInput): Promise<TransitionStatusOutcome>;
  /**
   * VR-05's impact check for `POST /users/{id}/deactivate`. Real query
   * against `queueing.appointment` (already migrated in full — DATABASE.md
   * was applied verbatim in M0.5), joined for a human-readable summary;
   * honestly empty until M2 ships booking, since nothing has ever written
   * a row there yet. Not a stub — the query is real and will start
   * returning rows the day M2 lands, with no code change here.
   */
  findActiveAppointmentsForStudent(userId: string): Promise<readonly ActiveAppointmentSummary[]>;
}
