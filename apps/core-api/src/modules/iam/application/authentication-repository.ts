import type { RoleCode } from '@campuscare/shared-types';

import type { AccountStatus } from '../domain/user-account.js';

/**
 * A `user_account` joined with its `local_credential` row — `null` when
 * either the account doesn't exist or it has no password credential at
 * all (an SSO-only account attempting the password fallback). The login
 * handler treats both `null` cases identically (API §0.4 rule 2: never
 * confirm existence through an error), which is why this port returns one
 * shape rather than surfacing "which kind of missing" to its caller.
 */
export interface AccountWithCredential {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: AccountStatus;
  readonly version: number;
  readonly passwordHash: string;
  readonly failedAttempts: number;
  readonly lockedUntil: Date | null;
}

/** The account fields needed once a session already identifies who is asking — no credential material. */
export interface AccountSummary {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: AccountStatus;
  readonly version: number;
}

export interface RecordLoginAttemptInput {
  readonly emailAttempted: string;
  readonly userAccountId: string | null;
  readonly succeeded: boolean;
  readonly sourceAddress: string | null;
}

/**
 * Port for the `identity` tables the login/session use cases touch —
 * `application/` owns this interface, `infrastructure/` supplies the
 * Kysely implementation (same split as the config module's
 * `AnnouncementRepository`).
 */
export interface AuthenticationRepository {
  findAccountWithCredentialByEmail(email: string): Promise<AccountWithCredential | null>;
  findAccountById(userAccountId: string): Promise<AccountSummary | null>;
  loadActiveRoleCodes(userAccountId: string): Promise<readonly RoleCode[]>;
  recordFailedAttempt(userAccountId: string, lockedUntil: Date | null): Promise<void>;
  resetFailedAttempts(userAccountId: string): Promise<void>;
  recordLoginAttempt(input: RecordLoginAttemptInput): Promise<void>;
}
