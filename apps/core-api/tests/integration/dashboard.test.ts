import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { KyselyDashboardRepository } from '../../src/modules/dashboard/index.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

const LOCATION_ID = '01920000-0000-7000-8000-000000003a01';
const ADMIN_ID = '01920000-0000-7000-8000-000000003a02';
const STUDENT_ID = '01920000-0000-7000-8000-000000003a03';
const RECIPIENT_ID = '01920000-0000-7000-8000-000000003a04';

describe('KyselyDashboardRepository — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let repository: KyselyDashboardRepository;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    repository = new KyselyDashboardRepository(db);

    await db.insertInto('identity.user_account').values({ id: ADMIN_ID, email: 'dash-admin@diu.edu.bd', full_name: 'Admin', status: 'active' }).execute();
    await db
      .insertInto('identity.user_account')
      .values({ id: STUDENT_ID, email: 'dash-student@diu.edu.bd', full_name: 'Dash Student', status: 'active' })
      .execute();
    await db.insertInto('identity.student_profile').values({ user_account_id: STUDENT_ID, student_ref: '221-15-9998', is_enrolled: true }).execute();
    await db.insertInto('identity.user_account').values({ id: RECIPIENT_ID, email: 'dash-recipient@diu.edu.bd', full_name: 'Recipient', status: 'active' }).execute();
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  it('findMedicineStoreState: closed with no hours when no location is configured', async () => {
    const state = await repository.findMedicineStoreState(new Date());
    expect(state).toEqual({ isOpen: false, opensAt: null, closesAt: null, stateSource: 'scheduled_hours' });
  });

  it('findMedicineStoreState: real scheduled hours from pharmacy.store_hours', async () => {
    await db.insertInto('config.location').values({ id: LOCATION_ID, code: 'MAIN', name: 'Main Campus' }).execute();
    // 2026-08-10 is a Monday — Postgres/Intl DOW convention, weekday 1.
    await db
      .insertInto('pharmacy.store_hours')
      .values({ id: '01920000-0000-7000-8000-000000003a05', location_id: LOCATION_ID, weekday: 1, opens_at: '09:00:00', closes_at: '17:00:00', updated_by: ADMIN_ID })
      .execute();

    const duringHours = await repository.findMedicineStoreState(new Date('2026-08-10T04:00:00Z')); // 10:00 BST
    expect(duringHours).toEqual({ isOpen: true, opensAt: '09:00:00', closesAt: '17:00:00', stateSource: 'scheduled_hours' });

    const beforeHours = await repository.findMedicineStoreState(new Date('2026-08-10T00:00:00Z')); // 06:00 BST
    expect(beforeHours.isOpen).toBe(false);
  });

  it('findMedicineStoreState: a same-day override wins over scheduled hours — BR-42', async () => {
    await db
      .insertInto('pharmacy.store_status_override')
      .values({ id: '01920000-0000-7000-8000-000000003a06', location_id: LOCATION_ID, effective_date: '2026-08-10', is_closed: true, created_by: ADMIN_ID, reason: 'Staff training day closure' })
      .execute();

    const state = await repository.findMedicineStoreState(new Date('2026-08-10T04:00:00Z')); // 10:00 BST, normally open
    expect(state).toEqual({ isOpen: false, opensAt: '09:00:00', closesAt: '17:00:00', stateSource: 'manual_override' });
  });

  it('findActiveBookingSuspension: null when the student has none, real row when active', async () => {
    expect(await repository.findActiveBookingSuspension(STUDENT_ID, new Date())).toBeNull();

    const suspendedUntil = new Date('2099-01-01T00:00:00+06:00');
    await db
      .insertInto('identity.booking_suspension')
      .values({ id: '01920000-0000-7000-8000-000000003a07', student_id: STUDENT_ID, suspended_until: suspendedUntil, no_show_count: 3 })
      .execute();

    const active = await repository.findActiveBookingSuspension(STUDENT_ID, new Date());
    expect(active).toEqual({ suspendedUntil, reason: 'Missed 3 appointments without notice.', walkInRemainsAvailable: true });
  });

  it('findActiveBookingSuspension: a lifted suspension no longer counts as active', async () => {
    await db
      .updateTable('identity.booking_suspension')
      .set({ lifted_at: new Date() })
      .where('student_id', '=', STUDENT_ID)
      .execute();

    expect(await repository.findActiveBookingSuspension(STUDENT_ID, new Date())).toBeNull();
  });

  it('countUnreadNotifications: real count, correctly typed despite Postgres returning bigint-as-string', async () => {
    expect(await repository.countUnreadNotifications(RECIPIENT_ID)).toBe(0);

    const templateRow = await db.selectFrom('notification.notification_template').select('id').where('template_key', '=', 'account_locked').executeTakeFirstOrThrow();
    await db
      .insertInto('notification.notification')
      .values([
        { id: '01920000-0000-7000-8000-000000003a08', recipient_id: RECIPIENT_ID, template_id: templateRow.id },
        { id: '01920000-0000-7000-8000-000000003a09', recipient_id: RECIPIENT_ID, template_id: templateRow.id },
        { id: '01920000-0000-7000-8000-000000003a0a', recipient_id: RECIPIENT_ID, template_id: templateRow.id, read_at: new Date() },
      ])
      .execute();

    const count = await repository.countUnreadNotifications(RECIPIENT_ID);
    expect(count).toBe(2);
    expect(typeof count).toBe('number');
  });
});
