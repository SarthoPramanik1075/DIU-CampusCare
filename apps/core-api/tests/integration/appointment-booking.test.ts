import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import type { SlotBookingContext } from '../../src/modules/queueing/application/appointment-repository.js';
import { KyselyAppointmentRepository } from '../../src/modules/queueing/index.js';
import { deriveSlots, KyselyClinicSessionRepository, KyselyDoctorRepository } from '../../src/modules/scheduling/index.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

/**
 * The roadmap's own named concurrency test for M3-B (EC-01, VR-20):
 * "N parallel clients commit to the same last slot. Assert: exactly one
 * 201; every other response is 409 SLOT_TAKEN... the appointment table
 * contains exactly one row; no partial state." Proven here at the
 * repository layer against `uq_appointment_slot_active` itself — the same
 * abstraction level `clinic-session-admin.test.ts`'s own
 * `ex_session_no_overlap` race test uses, and for the same reason: a
 * SELECT-based pre-check (VR-20's friendly rejection in the handler) can
 * never be the thing that actually decides a race, only the constraint can.
 */
describe('KyselyAppointmentRepository.createBooking — concurrency (EC-01)', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let locationId: string;
  let doctorId: string;
  let doctorName: string;
  const createdBy = '01920000-0000-7000-8000-000000006a01';
  let studentCounter = 0;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }) });

    locationId = (await db.selectFrom('config.location').select('id').executeTakeFirstOrThrow()).id;
    await db.insertInto('identity.user_account').values({ id: createdBy, email: 'appointment-booking-test@diu.edu.bd', full_name: 'DIU Medical Staff', status: 'active' }).execute();

    const doctorRepository = new KyselyDoctorRepository(db);
    const doctor = await doctorRepository.createDoctor({ fullName: 'Dr. Booking Race', designation: null, specialisation: null, photoUrl: null, userAccountId: null, locationId });
    if (doctor.outcome !== 'created') throw new Error('setup failed');
    doctorId = doctor.doctor.doctorId;
    doctorName = doctor.doctor.fullName;
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  /** One clinic session with exactly one bookable slot — the contested resource every racer in a test targets. */
  async function createSingleSlotSession(sessionDate: string, startsAt: Date): Promise<SlotBookingContext> {
    const endsAt = new Date(startsAt.getTime() + 10 * 60 * 1000);
    const derived = deriveSlots({ startsAt, endsAt, slotLengthMinutes: 10, walkInAllocationPct: 0 });
    const clinicSessionRepository = new KyselyClinicSessionRepository(db);
    const created = await clinicSessionRepository.createClinicSession({
      doctorId,
      locationId,
      dutyRosterId: null,
      sessionDate,
      startsAt,
      endsAt,
      slotLengthMinutes: 10,
      walkInAllocationPct: 0,
      changeReason: null,
      totalSlotCount: derived.totalSlotCount,
      bookableSlotCount: derived.bookableSlotCount,
      slots: derived.slots,
      createdBy,
    });
    if (created.outcome !== 'created') throw new Error('setup failed');

    const slot = await db.selectFrom('scheduling.session_slot').select(['id', 'slot_starts_at']).where('clinic_session_id', '=', created.session.sessionId).executeTakeFirstOrThrow();

    return {
      slotId: slot.id,
      sessionId: created.session.sessionId,
      doctorId,
      doctorName,
      locationId,
      sessionDate,
      slotStartsAt: slot.slot_starts_at,
      sessionStartsAt: startsAt,
      isOnlineBookable: true,
    };
  }

  async function insertStudent(pool: Kysely<Database>): Promise<string> {
    studentCounter += 1;
    const suffix = String(studentCounter).padStart(2, '0');
    const studentId = `01920000-0000-7000-8000-0000000061${suffix}`;
    await pool.insertInto('identity.user_account').values({ id: studentId, email: `booking-race-student-${suffix}-test@diu.edu.bd`, full_name: 'Race Student', status: 'active' }).execute();
    await pool.insertInto('identity.student_profile').values({ user_account_id: studentId, student_ref: `221-15-91${suffix}`, is_enrolled: true }).execute();
    return studentId;
  }

  async function raceForSlot(n: number, slot: SlotBookingContext): Promise<void> {
    const pools = Array.from({ length: n }, () => new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }) }));
    try {
      const studentIds = await Promise.all(pools.map((pool) => insertStudent(pool)));
      const repositories = pools.map((pool) => new KyselyAppointmentRepository(pool));

      const outcomes = await Promise.all(
        repositories.map((repository, index) =>
          repository.createBooking({ slot, studentId: studentIds[index] ?? '', visitReasonCategoryId: null, visitReasonNote: null, createdBy: studentIds[index] ?? '' }),
        ),
      );

      const created = outcomes.filter((outcome) => outcome.outcome === 'created');
      const slotTaken = outcomes.filter((outcome) => outcome.outcome === 'slot_taken');
      expect(created).toHaveLength(1);
      expect(slotTaken).toHaveLength(n - 1);

      const rows = await db.selectFrom('queueing.appointment').select('id').where('session_slot_id', '=', slot.slotId).execute();
      expect(rows).toHaveLength(1);
    } finally {
      await Promise.all(pools.map((pool) => pool.destroy()));
    }
  }

  it('N=2 — exactly one winner, one row, no partial state', async () => {
    const slot = await createSingleSlotSession('2026-08-20', new Date('2026-08-20T09:00:00+06:00'));
    await raceForSlot(2, slot);
  }, 30_000);

  it('N=10 — exactly one winner, one row, no partial state', async () => {
    const slot = await createSingleSlotSession('2026-08-21', new Date('2026-08-21T09:00:00+06:00'));
    await raceForSlot(10, slot);
  }, 30_000);
});
