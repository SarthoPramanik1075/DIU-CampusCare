import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { KyselyAnnouncementRepository } from '../../src/modules/config/infrastructure/announcement.repository.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

describe('KyselyAnnouncementRepository', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let repository: KyselyAnnouncementRepository;
  let adminId: string;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    repository = new KyselyAnnouncementRepository(db);

    await db
      .insertInto('config.location')
      .values({ id: '01920000-0000-7000-8000-0000000000aa', code: 'MAIN', name: 'Main' })
      .execute();
    adminId = '01920000-0000-7000-8000-0000000000ab';
    await db
      .insertInto('identity.user_account')
      .values({
        id: adminId,
        email: 'admin@diu.edu.bd',
        full_name: 'DIU IT',
        location_id: '01920000-0000-7000-8000-0000000000aa',
      })
      .execute();
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  it('returns an empty array when no announcements exist', async () => {
    await expect(repository.findAll()).resolves.toEqual([]);
  });

  it('maps every column and returns real Date instances', async () => {
    await db
      .insertInto('config.announcement')
      .values({
        id: '01920000-0000-7000-8000-0000000000ac',
        body: 'The medical centre will close at 1 PM on 12 August for a staff training day.',
        starts_at: new Date('2026-08-01T00:00:00+06:00'),
        ends_at: new Date('2026-08-12T23:59:00+06:00'),
        created_by: adminId,
      })
      .execute();

    const [announcement] = await repository.findAll();
    expect(announcement).toBeDefined();
    expect(announcement?.body).toContain('staff training day');
    expect(announcement?.startsAt).toBeInstanceOf(Date);
    expect(announcement?.endsAt).toBeInstanceOf(Date);
    expect(announcement?.startsAt.toISOString()).toBe(new Date('2026-08-01T00:00:00+06:00').toISOString());
  });

  it('returns every row, including ones outside their active window — filtering is the handler layer’s job', async () => {
    await db
      .insertInto('config.announcement')
      .values({
        id: '01920000-0000-7000-8000-0000000000ad',
        body: 'A long-expired announcement.',
        starts_at: new Date('2020-01-01T00:00:00+06:00'),
        ends_at: new Date('2020-01-02T00:00:00+06:00'),
        created_by: adminId,
      })
      .execute();

    const all = await repository.findAll();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});
