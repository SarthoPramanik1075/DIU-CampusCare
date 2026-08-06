import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { writeOutboxEntry } from '../../src/kernel/events/outbox-writer.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

describe('writeOutboxEntry — ADR-006', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let templateId: string;
  let recipientId: string;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });

    recipientId = '01920000-0000-7000-8000-0000000000c1';
    await db
      .insertInto('config.location')
      .values({ id: '01920000-0000-7000-8000-0000000000c0', code: 'MAIN', name: 'Main' })
      .execute();
    await db
      .insertInto('identity.user_account')
      .values({
        id: recipientId,
        email: 'student@diu.edu.bd',
        full_name: 'Nusrat Jahan',
        location_id: '01920000-0000-7000-8000-0000000000c0',
      })
      .execute();

    const [template] = await db
      .insertInto('notification.notification_template')
      .values({
        id: '01920000-0000-7000-8000-0000000000c2',
        template_key: 'APT_BOOKING_CONFIRMED',
        subject_template: 'Booking confirmed',
        body_template: 'Your appointment {{ref}} is booked.',
      })
      .returning('id')
      .execute();
    templateId = template?.id ?? '';
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  async function insertNotification(): Promise<string> {
    const [row] = await db
      .insertInto('notification.notification')
      .values({ id: crypto.randomUUID(), recipient_id: recipientId, template_id: templateId })
      .returning('id')
      .execute();
    return row?.id ?? '';
  }

  it('writes a pending outbox row for the given notification and channel', async () => {
    const notificationId = await insertNotification();
    await writeOutboxEntry(db, { notificationId, channel: 'in_app' });

    const row = await db
      .selectFrom('notification.notification_outbox')
      .selectAll()
      .where('notification_id', '=', notificationId)
      .executeTakeFirstOrThrow();

    expect(row.channel).toBe('in_app');
    expect(row.status).toBe('pending');
    expect(row.attempt_count).toBe(0);
    expect(row.claimed_by).toBeNull();
  });

  it('supports more than one channel for the same notification', async () => {
    const notificationId = await insertNotification();
    await writeOutboxEntry(db, { notificationId, channel: 'in_app' });
    await writeOutboxEntry(db, { notificationId, channel: 'email' });

    const rows = await db
      .selectFrom('notification.notification_outbox')
      .select('channel')
      .where('notification_id', '=', notificationId)
      .execute();
    expect(rows.map((r) => r.channel).sort()).toEqual(['email', 'in_app']);
  });

  // The property the whole pattern exists for: the outbox row and the domain
  // write it accompanies rise and fall together.
  it('is rolled back with the transaction when the domain write fails afterward', async () => {
    const notificationId = await insertNotification();

    await expect(
      db.transaction().execute(async (trx) => {
        await writeOutboxEntry(trx, { notificationId, channel: 'in_app' });
        // Simulate a failure in the "domain write" that was meant to share
        // this transaction — a FK violation against a nonexistent template.
        await trx
          .insertInto('notification.notification')
          .values({
            id: crypto.randomUUID(),
            recipient_id: recipientId,
            template_id: '00000000-0000-0000-0000-000000000000',
          })
          .execute();
      }),
    ).rejects.toBeDefined();

    const rows = await db
      .selectFrom('notification.notification_outbox')
      .selectAll()
      .where('notification_id', '=', notificationId)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('commits together with the domain write when the transaction succeeds', async () => {
    const secondNotificationId = crypto.randomUUID();

    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('notification.notification')
        .values({ id: secondNotificationId, recipient_id: recipientId, template_id: templateId })
        .execute();
      await writeOutboxEntry(trx, { notificationId: secondNotificationId, channel: 'email' });
    });

    const outboxRow = await db
      .selectFrom('notification.notification_outbox')
      .selectAll()
      .where('notification_id', '=', secondNotificationId)
      .executeTakeFirst();
    expect(outboxRow).toBeDefined();
  });
});
