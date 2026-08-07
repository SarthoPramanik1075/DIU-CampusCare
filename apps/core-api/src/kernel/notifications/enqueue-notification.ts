import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';

import type { Database, NotificationChannel } from '../../infrastructure/database/client.js';
import { writeOutboxEntry } from '../events/outbox-writer.js';

/**
 * Looks up a template by key and writes both the `notification` row and its
 * outbox entry in one transaction — the same atomicity `writeOutboxEntry`'s
 * own doc comment requires, one level up. Generic, cross-cutting plumbing
 * (like `AuditRecorder`), not IAM-specific — the account-locked and
 * password-reset notifications this backs today are the first callers, not
 * the only ones this is meant to ever have.
 *
 * Every `notification.notification` row requires a `template_id` FK, so an
 * unseeded `templateKey` is a deployment defect, not a caller mistake — it
 * throws a bare `Error` rather than a `DomainError`, and the generic 500
 * fallback in `http-error-mapper.ts` is the correct outcome for that.
 */
export interface EnqueueNotificationInput {
  readonly recipientId: string;
  readonly templateKey: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly channel: NotificationChannel;
  readonly correlationId?: string | null;
}

export async function enqueueNotification(db: Kysely<Database>, input: EnqueueNotificationInput): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const template = await trx
      .selectFrom('notification.notification_template')
      .select('id')
      .where('template_key', '=', input.templateKey)
      .where('is_active', '=', true)
      .executeTakeFirst();

    if (template === undefined) {
      throw new Error(`No active notification template named "${input.templateKey}".`);
    }

    const notificationId = uuidv7();
    await trx
      .insertInto('notification.notification')
      .values({
        id: notificationId,
        recipient_id: input.recipientId,
        template_id: template.id,
        payload: input.payload ?? {},
        correlation_id: input.correlationId ?? null,
      })
      .execute();

    await writeOutboxEntry(trx, { notificationId, channel: input.channel });
  });
}
