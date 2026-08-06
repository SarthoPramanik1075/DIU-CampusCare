import type { Kysely, Transaction } from 'kysely';
import { uuidv7 } from 'uuidv7';

import type { Database, NotificationChannel } from '../../infrastructure/database/client.js';

/**
 * The transactional outbox — ADR-006.
 *
 * A plain function, not a class holding its own connection: the whole point
 * of the outbox pattern is that the outbox row is written in the *same*
 * database transaction as the domain change that caused it, so the two can
 * never disagree — a notification is never lost because the process crashed
 * after committing the domain write but before enqueuing delivery, and a
 * notification is never sent for a domain write that itself rolled back.
 * That only works if the caller controls the transaction, which is why this
 * takes the executor (a plain connection or an open `Transaction`) as its
 * first argument rather than owning one.
 *
 * The background worker's dispatcher (built in M8) claims pending rows via
 * `claimed_by` / `claimed_at`, which is what lets multiple workers run
 * without double-sending — this function only ever inserts.
 */
export async function writeOutboxEntry(
  executor: Kysely<Database> | Transaction<Database>,
  input: { readonly notificationId: string; readonly channel: NotificationChannel },
): Promise<void> {
  await executor
    .insertInto('notification.notification_outbox')
    .values({
      id: uuidv7(),
      notification_id: input.notificationId,
      channel: input.channel,
    })
    .execute();
}
