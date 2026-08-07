import type { RoleCode } from '@campuscare/shared-types';
import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';

import type { Database } from '../../../infrastructure/database/client.js';
import type {
  AccountSummary,
  AccountWithCredential,
  AuthenticationRepository,
  RecordLoginAttemptInput,
} from '../application/authentication-repository.js';

export class KyselyAuthenticationRepository implements AuthenticationRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findAccountWithCredentialByEmail(email: string): Promise<AccountWithCredential | null> {
    const row = await this.db
      .selectFrom('identity.user_account')
      .innerJoin('identity.local_credential', 'identity.local_credential.user_account_id', 'identity.user_account.id')
      .select([
        'identity.user_account.id',
        'identity.user_account.email',
        'identity.user_account.full_name',
        'identity.user_account.status',
        'identity.user_account.version',
        'identity.local_credential.password_hash',
        'identity.local_credential.failed_attempts',
        'identity.local_credential.locked_until',
      ])
      // citext makes this comparison case-insensitive at the database level.
      .where('identity.user_account.email', '=', email)
      .executeTakeFirst();

    if (row === undefined) return null;

    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      status: row.status,
      version: row.version,
      passwordHash: row.password_hash,
      failedAttempts: row.failed_attempts,
      lockedUntil: row.locked_until,
    };
  }

  async findAccountById(userAccountId: string): Promise<AccountSummary | null> {
    const row = await this.db
      .selectFrom('identity.user_account')
      .select(['id', 'email', 'full_name', 'status', 'version'])
      .where('id', '=', userAccountId)
      .executeTakeFirst();

    if (row === undefined) return null;

    return { id: row.id, email: row.email, fullName: row.full_name, status: row.status, version: row.version };
  }

  async loadActiveRoleCodes(userAccountId: string): Promise<readonly RoleCode[]> {
    const rows = await this.db
      .selectFrom('identity.user_role')
      .innerJoin('identity.role', 'identity.role.id', 'identity.user_role.role_id')
      .select('identity.role.code')
      .where('identity.user_role.user_account_id', '=', userAccountId)
      .where('identity.user_role.revoked_at', 'is', null)
      .execute();
    return rows.map((row) => row.code);
  }

  async recordFailedAttempt(userAccountId: string, lockedUntil: Date | null): Promise<void> {
    await this.db
      .updateTable('identity.local_credential')
      .set((eb) => ({
        failed_attempts: eb('failed_attempts', '+', 1),
        locked_until: lockedUntil,
      }))
      .where('user_account_id', '=', userAccountId)
      .execute();
  }

  async resetFailedAttempts(userAccountId: string): Promise<void> {
    await this.db
      .updateTable('identity.local_credential')
      .set({ failed_attempts: 0, locked_until: null })
      .where('user_account_id', '=', userAccountId)
      .execute();
  }

  async recordLoginAttempt(input: RecordLoginAttemptInput): Promise<void> {
    await this.db
      .insertInto('identity.login_attempt')
      .values({
        id: uuidv7(),
        email_attempted: input.emailAttempted,
        user_account_id: input.userAccountId,
        succeeded: input.succeeded,
        source_address: input.sourceAddress,
      })
      .execute();
  }
}
