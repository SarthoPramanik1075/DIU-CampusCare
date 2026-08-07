import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { enqueueNotification } from '../../src/kernel/notifications/enqueue-notification.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

describe('enqueueNotification', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  const RECIPIENT_ID = '01920000-0000-7000-8000-0000000000c1';

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    await db
      .insertInto('identity.user_account')
      .values({ id: RECIPIENT_ID, email: 'recipient@diu.edu.bd', full_name: 'Recipient', status: 'active' })
      .execute();
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  it('writes both the notification row and its outbox entry, atomically', async () => {
    await enqueueNotification(db, {
      recipientId: RECIPIENT_ID,
      templateKey: 'account_locked',
      payload: { unlockAt: '2026-08-03T15:20:00+06:00' },
      channel: 'email',
      correlationId: 'corr-1',
    });

    const notification = await db
      .selectFrom('notification.notification')
      .selectAll()
      .where('recipient_id', '=', RECIPIENT_ID)
      .executeTakeFirstOrThrow();
    expect(notification.payload).toEqual({ unlockAt: '2026-08-03T15:20:00+06:00' });
    expect(notification.correlation_id).toBe('corr-1');

    const outboxRow = await db
      .selectFrom('notification.notification_outbox')
      .selectAll()
      .where('notification_id', '=', notification.id)
      .executeTakeFirstOrThrow();
    expect(outboxRow.channel).toBe('email');
    expect(outboxRow.status).toBe('pending');
  });

  it('throws, and writes nothing, when the template key is unknown', async () => {
    await expect(
      enqueueNotification(db, {
        recipientId: RECIPIENT_ID,
        templateKey: 'no_such_template',
        channel: 'email',
      }),
    ).rejects.toThrow('no_such_template');

    const count = await db
      .selectFrom('notification.notification')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('recipient_id', '=', RECIPIENT_ID)
      .executeTakeFirstOrThrow();
    expect(count.total).toBe('1'); // only the row from the previous test
  });
});
