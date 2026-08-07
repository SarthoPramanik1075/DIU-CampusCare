import type { Kysely } from 'kysely';

import type { Database } from '../../../infrastructure/database/client.js';
import type {
  OwnProfileAccount,
  OwnProfileRepository,
  StudentProfile,
  UpdateFullNameInput,
  UpdateFullNameOutcome,
} from '../application/own-profile-repository.js';

export class KyselyOwnProfileRepository implements OwnProfileRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findAccountById(userAccountId: string): Promise<OwnProfileAccount | null> {
    const row = await this.db
      .selectFrom('identity.user_account')
      .leftJoin(
        'identity.local_credential',
        'identity.local_credential.user_account_id',
        'identity.user_account.id',
      )
      .select([
        'identity.user_account.id',
        'identity.user_account.email',
        'identity.user_account.full_name',
        'identity.user_account.status',
        'identity.user_account.version',
        'identity.local_credential.user_account_id as credential_account_id',
      ])
      .where('identity.user_account.id', '=', userAccountId)
      .executeTakeFirst();

    if (row === undefined) return null;

    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      status: row.status,
      version: row.version,
      authMethod: row.credential_account_id === null ? 'sso' : 'local',
    };
  }

  async findStudentProfile(userAccountId: string): Promise<StudentProfile | null> {
    const row = await this.db
      .selectFrom('identity.student_profile')
      .select(['student_ref', 'programme', 'is_enrolled'])
      .where('user_account_id', '=', userAccountId)
      .executeTakeFirst();

    if (row === undefined) return null;

    return { studentRef: row.student_ref, programme: row.programme, isEnrolled: row.is_enrolled };
  }

  async updateFullName(input: UpdateFullNameInput): Promise<UpdateFullNameOutcome> {
    const row = await this.db
      .updateTable('identity.user_account')
      .set((eb) => ({
        ...(input.fullName === undefined ? {} : { full_name: input.fullName }),
        version: eb('version', '+', 1),
        updated_at: input.now,
      }))
      .where('id', '=', input.userAccountId)
      .where('version', '=', input.expectedVersion)
      .returning(['id', 'email', 'full_name', 'status', 'version'])
      .executeTakeFirst();

    if (row === undefined) return { outcome: 'stale' };

    const account = await this.findAccountById(row.id);
    if (account === null) {
      // Unreachable outside a concurrent hard-delete of the very account
      // that just accepted this update — no such operation exists in this
      // system (accounts are deactivated, never deleted).
      throw new Error(`identity.user_account ${row.id} vanished immediately after its own update`);
    }

    return { outcome: 'updated', account };
  }
}
