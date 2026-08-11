import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { GetBookingSuspensionQuery, KyselyBookingSuspensionRepository, computeSuspensionUntil, computeSuspensionWindowStart, shouldSuspendForNoShows } from '../../src/modules/queueing/index.js';
import { FixedClock } from '../support/fixed-clock.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

/** M3-D. The actual no-show → count → suspend pipeline is wired end to end in M3-F's mark-no-show handler; this proves the write/read halves this checkpoint owns work correctly in isolation, against real Postgres. */
describe('KyselyBookingSuspensionRepository + GetBookingSuspensionQuery — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let repository: KyselyBookingSuspensionRepository;
  let studentId: string;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }) });
    repository = new KyselyBookingSuspensionRepository(db);

    studentId = '01920000-0000-7000-8000-000000008a01';
    await db.insertInto('identity.user_account').values({ id: studentId, email: 'booking-suspension-test@diu.edu.bd', full_name: 'A Student', status: 'active' }).execute();
    await db.insertInto('identity.student_profile').values({ user_account_id: studentId, student_ref: '221-15-9301', is_enrolled: true }).execute();
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  it('countRecentNoShows counts only no_show appointments within the window, for that student', async () => {
    const now = new Date('2026-08-10T00:00:00Z');
    const withinWindow = new Date('2026-08-01T00:00:00Z');
    const outsideWindow = new Date('2026-06-01T00:00:00Z');

    await db.insertInto('scheduling.doctor').values({ id: '01920000-0000-7000-8000-000000008b01', full_name: 'Dr. Suspension', location_id: (await db.selectFrom('config.location').select('id').executeTakeFirstOrThrow()).id }).execute();
    const doctorId = '01920000-0000-7000-8000-000000008b01';
    await db
      .insertInto('scheduling.clinic_session')
      .values({
        id: '01920000-0000-7000-8000-000000008c01',
        doctor_id: doctorId,
        location_id: (await db.selectFrom('config.location').select('id').executeTakeFirstOrThrow()).id,
        session_date: '2026-08-01',
        starts_at: new Date('2026-08-01T03:00:00Z'),
        ends_at: new Date('2026-08-01T07:00:00Z'),
        slot_length_minutes: 10,
        walk_in_allocation_pct: 30,
        total_slot_count: 24,
        bookable_slot_count: 16,
        created_by: studentId,
      })
      .execute();
    const sessionId = '01920000-0000-7000-8000-000000008c01';

    async function insertNoShow(id: string, serial: number, markedAt: Date): Promise<void> {
      await db
        .insertInto('queueing.appointment')
        .values({
          id,
          appointment_ref: `MED-2026-SUSP${String(serial)}`,
          clinic_session_id: sessionId,
          session_slot_id: null,
          student_id: studentId,
          serial_number: serial,
          origin: 'walk_in',
          status: 'no_show',
          no_show_marked_at: markedAt,
          created_by: studentId,
        })
        .execute();
    }

    await insertNoShow('01920000-0000-7000-8000-000000008d01', 1, withinWindow);
    await insertNoShow('01920000-0000-7000-8000-000000008d02', 2, withinWindow);
    await insertNoShow('01920000-0000-7000-8000-000000008d03', 3, outsideWindow);

    const windowStart = computeSuspensionWindowStart(now, 30);
    const count = await repository.countRecentNoShows(studentId, windowStart);
    expect(count).toBe(2);
    expect(shouldSuspendForNoShows(count, 3)).toBe(false);

    await insertNoShow('01920000-0000-7000-8000-000000008d04', 4, withinWindow);
    const countAfterThird = await repository.countRecentNoShows(studentId, windowStart);
    expect(countAfterThird).toBe(3);
    expect(shouldSuspendForNoShows(countAfterThird, 3)).toBe(true);
  });

  it('createSuspension writes a row GetBookingSuspensionQuery can then read back, with a derived reason', async () => {
    const clock = new FixedClock(new Date('2026-08-10T00:00:00Z'));
    const query = new GetBookingSuspensionQuery(repository, clock);

    expect(await query.execute(studentId)).toBeNull();

    const suspendedUntil = computeSuspensionUntil(clock.now(), 14);
    await repository.createSuspension(studentId, suspendedUntil, 3);

    const state = await query.execute(studentId);
    expect(state).not.toBeNull();
    expect(state?.suspendedUntil).toEqual(suspendedUntil);
    expect(state?.reason).toBe('Missed 3 appointments without notice.');
    expect(state?.walkInRemainsAvailable).toBe(true);

    clock.set(new Date(suspendedUntil.getTime() + 1000));
    expect(await query.execute(studentId)).toBeNull();
  });
});
