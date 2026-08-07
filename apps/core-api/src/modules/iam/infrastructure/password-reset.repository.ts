import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';

import type { Database } from '../../../infrastructure/database/client.js';
import type {
  CreateResetTokenInput,
  PasswordResetRepository,
  ValidResetToken,
} from '../application/password-reset-repository.js';

export class KyselyPasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async createToken(input: CreateResetTokenInput): Promise<void> {
    await this.db
      .insertInto('identity.password_reset_token')
      .values({
        id: uuidv7(),
        user_account_id: input.userAccountId,
        token_hash: input.tokenHash,
        expires_at: input.expiresAt,
      })
      .execute();
  }

  async findValidToken(tokenHash: string, now: Date): Promise<ValidResetToken | null> {
    const row = await this.db
      .selectFrom('identity.password_reset_token')
      .select(['id', 'user_account_id'])
      .where('token_hash', '=', tokenHash)
      .where('consumed_at', 'is', null)
      .where('expires_at', '>', now)
      .executeTakeFirst();

    return row === undefined ? null : { id: row.id, userAccountId: row.user_account_id };
  }

  async consumeToken(tokenId: string, now: Date): Promise<void> {
    await this.db
      .updateTable('identity.password_reset_token')
      .set({ consumed_at: now })
      .where('id', '=', tokenId)
      .execute();
  }

  async updatePasswordHash(userAccountId: string, newPasswordHash: string, now: Date): Promise<void> {
    await this.db
      .updateTable('identity.local_credential')
      .set({ password_hash: newPasswordHash, password_changed_at: now, failed_attempts: 0, locked_until: null })
      .where('user_account_id', '=', userAccountId)
      .execute();
  }
}
