import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { KyselyAppointmentRepository } from '../../src/modules/queueing/index.js';
import { deriveSlots, KyselyClinicSessionRepository, KyselyDoctorRepository } from '../../src/modules/scheduling/index.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

/**
 * The roadmap's other named concurrency test (M3-I, M3-T12/T13, FR-APT-37,
 * EC-09): "50 concurrent walk-ins into one session produce a contiguous,
 * gap-free serial sequence with zero duplicates." Unlike booking's race
 * (EC-01 — N clients contesting one scarce slot, where only one may win),
 * every walk-in here legitimately succeeds — the property under test is
 * that `queueing.fn_next_serial`'s row-locking (already proven for booking
 * in M3-B) gives each concurrent insert a distinct, sequential serial with
 * no gap and no collision, the same primitive both origins share.
 */
describe('KyselyAppointmentRepository.createWalkIn — concurrency (EC-09, M3-T12/T13)', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let locationId: string;
  let doctorId: string;
  const createdBy = '01920000-0000-7000-8000-000000006b01';
  let studentCounter = 0;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }) });

    locationId = (await db.selectFrom('config.location').select('id').executeTakeFirstOrThrow()).id;
    await db.insertInto('identity.user_account').values({ id: createdBy, email: 'walkin-concurrency-test@diu.edu.bd', full_name: 'DIU Medical Staff', status: 'active' }).execute();

    const doctorRepository = new KyselyDoctorRepository(db);
    const doctor = await doctorRepository.createDoctor({ fullName: 'Dr. Walk-in Race', designation: null, specialisation: null, photoUrl: null, userAccountId: null, locationId });
    if (doctor.outcome !== 'created') throw new Error('setup failed');
    doctorId = doctor.doctor.doctorId;
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  async function createSession(sessionDate: string, startsAt: Date): Promise<string> {
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
    const derived = deriveSlots({ startsAt, endsAt, slotLengthMinutes: 10, walkInAllocationPct: 30 });
    const clinicSessionRepository = new KyselyClinicSessionRepository(db);
    const created = await clinicSessionRepository.createClinicSession({
      doctorId,
      locationId,
      dutyRosterId: null,
      sessionDate,
      startsAt,
      endsAt,
      slotLengthMinutes: 10,
      walkInAllocationPct: 30,
      changeReason: null,
      totalSlotCount: derived.totalSlotCount,
      bookableSlotCount: derived.bookableSlotCount,
      slots: derived.slots,
      createdBy,
    });
    if (created.outcome !== 'created') throw new Error('setup failed');
    return created.session.sessionId;
  }

  async function insertStudent(pool: Kysely<Database>): Promise<string> {
    studentCounter += 1;
    const suffix = String(studentCounter).padStart(2, '0');
    const studentId = `01920000-0000-7000-8000-0000000062${suffix}`;
    await pool.insertInto('identity.user_account').values({ id: studentId, email: `walkin-race-student-${suffix}-test@diu.edu.bd`, full_name: 'Race Student', status: 'active' }).execute();
    await pool.insertInto('identity.student_profile').values({ user_account_id: studentId, student_ref: `221-16-91${suffix}`, is_enrolled: true }).execute();
    return studentId;
  }

  async function raceWalkIns(n: number, clinicSessionId: string): Promise<void> {
    const pools = Array.from({ length: n }, () => new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }) }));
    try {
      const studentIds = await Promise.all(pools.map((pool) => insertStudent(pool)));
      const repositories = pools.map((pool) => new KyselyAppointmentRepository(pool));
      const now = new Date();

      const outcomes = await Promise.all(
        repositories.map((repository, index) =>
          repository.createWalkIn(
            {
              clinicSessionId,
              studentId: studentIds[index] ?? null,
              unregisteredName: null,
              visitReasonCategoryId: null,
              isEmergency: false,
              emergencyReason: null,
              createdBy: studentIds[index] ?? createdBy,
              idempotencyKey: null,
            },
            now,
          ),
        ),
      );

      const created = outcomes.filter((outcome) => outcome.outcome === 'created');
      expect(created).toHaveLength(n);

      const rows = await db.selectFrom('queueing.appointment').select('serial_number').where('clinic_session_id', '=', clinicSessionId).where('origin', '=', 'walk_in').execute();
      expect(rows).toHaveLength(n);

      const serials = rows.map((row) => row.serial_number).sort((a, b) => a - b);
      const distinctSerials = new Set(serials);
      expect(distinctSerials.size).toBe(n);
      expect(serials).toEqual(Array.from({ length: n }, (_, index) => index + 1));
    } finally {
      await Promise.all(pools.map((pool) => pool.destroy()));
    }
  }

  it('N=2 — distinct, sequential serials, zero duplicates', async () => {
    const sessionId = await createSession('2026-08-22', new Date('2026-08-22T09:00:00+06:00'));
    await raceWalkIns(2, sessionId);
  }, 30_000);

  it('N=50 — a contiguous, gap-free 1…50, zero duplicates (the roadmap\'s own named test)', async () => {
    const sessionId = await createSession('2026-08-23', new Date('2026-08-23T09:00:00+06:00'));
    await raceWalkIns(50, sessionId);
  }, 60_000);
});
