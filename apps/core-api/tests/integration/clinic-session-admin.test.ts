import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { deriveSlots, KyselyClinicSessionRepository, KyselyDoctorRepository } from '../../src/modules/scheduling/index.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

function buildCreateInput(doctorId: string, locationId: string, startsAt: Date, endsAt: Date, createdBy: string) {
  const derived = deriveSlots({ startsAt, endsAt, slotLengthMinutes: 10, walkInAllocationPct: 30 });
  return {
    doctorId,
    locationId,
    dutyRosterId: null,
    sessionDate: startsAt.toISOString().slice(0, 10),
    startsAt,
    endsAt,
    slotLengthMinutes: 10,
    walkInAllocationPct: 30,
    changeReason: null,
    totalSlotCount: derived.totalSlotCount,
    bookableSlotCount: derived.bookableSlotCount,
    slots: derived.slots,
    createdBy,
  };
}

describe('KyselyClinicSessionRepository — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let repository: KyselyClinicSessionRepository;
  let doctorId: string;
  let locationId: string;
  const createdBy = '01920000-0000-7000-8000-000000003a01';

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    repository = new KyselyClinicSessionRepository(db);

    locationId = (await db.selectFrom('config.location').select('id').executeTakeFirstOrThrow()).id;
    await db.insertInto('identity.user_account').values({ id: createdBy, email: 'clinic-session-admin-test@diu.edu.bd', full_name: 'DIU Medical Staff', status: 'active' }).execute();

    const doctorRepository = new KyselyDoctorRepository(db);
    const created = await doctorRepository.createDoctor({ fullName: 'Dr. Rahman', designation: null, specialisation: null, photoUrl: null, userAccountId: null, locationId });
    if (created.outcome !== 'created') throw new Error('setup failed');
    doctorId = created.doctor.doctorId;
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  it('findDoctorLocationId: resolves for a real doctor, null otherwise', async () => {
    expect(await repository.findDoctorLocationId(doctorId)).toBe(locationId);
    expect(await repository.findDoctorLocationId('01920000-0000-7000-8000-0000000000ff')).toBeNull();
  });

  it('createClinicSession: real round trip creates the session and every derived session_slot row', async () => {
    const input = buildCreateInput(doctorId, locationId, new Date('2026-08-03T09:00:00+06:00'), new Date('2026-08-03T13:00:00+06:00'), createdBy);
    const result = await repository.createClinicSession(input);
    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') return;

    expect(result.session).toEqual(
      expect.objectContaining({ doctorId, doctorName: 'Dr. Rahman', totalSlotCount: 24, bookableSlotCount: 16, status: 'scheduled', isOverride: true, version: 1 }),
    );

    const slotRows = await db.selectFrom('scheduling.session_slot').selectAll().where('clinic_session_id', '=', result.session.sessionId).execute();
    expect(slotRows).toHaveLength(24);
    expect(slotRows.filter((row) => row.is_online_bookable)).toHaveLength(16);
  });

  it('createClinicSession: SESSION_OVERLAP for an overlapping time on the same doctor', async () => {
    const overlapping = buildCreateInput(doctorId, locationId, new Date('2026-08-03T12:00:00+06:00'), new Date('2026-08-03T15:00:00+06:00'), createdBy);
    const result = await repository.createClinicSession(overlapping);
    expect(result.outcome).toBe('overlap');
  });

  it('createClinicSession: no overlap for a non-overlapping time on the same doctor', async () => {
    const nonOverlapping = buildCreateInput(doctorId, locationId, new Date('2026-08-03T14:00:00+06:00'), new Date('2026-08-03T17:00:00+06:00'), createdBy);
    const result = await repository.createClinicSession(nonOverlapping);
    expect(result.outcome).toBe('created');
  });

  it("ex_session_no_overlap rejects a concurrent overlapping insert — proven against the GiST constraint itself, not the application's pre-check", async () => {
    const doctorRepository = new KyselyDoctorRepository(db);
    const raceDoctor = await doctorRepository.createDoctor({ fullName: 'Dr. Race', designation: null, specialisation: null, photoUrl: null, userAccountId: null, locationId });
    if (raceDoctor.outcome !== 'created') throw new Error('setup failed');

    // Two independent connections racing the identical overlapping window —
    // both can pass this repository's SELECT-based pre-check before either
    // commits its INSERT, so a "created"+"created" result here would prove
    // the pre-check alone is not enough; the exclusion constraint is what
    // actually decides the race.
    const firstDb = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }) });
    const secondDb = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }) });
    try {
      const firstRepository = new KyselyClinicSessionRepository(firstDb);
      const secondRepository = new KyselyClinicSessionRepository(secondDb);
      const input = buildCreateInput(raceDoctor.doctor.doctorId, locationId, new Date('2026-08-04T09:00:00+06:00'), new Date('2026-08-04T13:00:00+06:00'), createdBy);

      const [first, second] = await Promise.all([firstRepository.createClinicSession(input), secondRepository.createClinicSession(input)]);
      const outcomes = [first.outcome, second.outcome].sort();
      expect(outcomes).toEqual(['created', 'overlap']);

      const rows = await db.selectFrom('scheduling.clinic_session').select('id').where('doctor_id', '=', raceDoctor.doctor.doctorId).execute();
      expect(rows).toHaveLength(1);
    } finally {
      await firstDb.destroy();
      await secondDb.destroy();
    }
  }, 30_000);

  it('updateClinicSession: retimes, bumps version via the trigger, and detects a stale version', async () => {
    const created = await repository.createClinicSession(buildCreateInput(doctorId, locationId, new Date('2026-08-05T09:00:00+06:00'), new Date('2026-08-05T13:00:00+06:00'), createdBy));
    if (created.outcome !== 'created') throw new Error('setup failed');

    const newEndsAt = new Date('2026-08-05T13:30:00+06:00');
    const derived = deriveSlots({ startsAt: created.session.startsAt, endsAt: newEndsAt, slotLengthMinutes: 10, walkInAllocationPct: 30 });
    const updated = await repository.updateClinicSession({
      sessionId: created.session.sessionId,
      startsAt: undefined,
      endsAt: newEndsAt,
      slotLengthMinutes: undefined,
      walkInAllocationPct: undefined,
      changeReason: 'Doctor arriving late from an external commitment',
      totalSlotCount: derived.totalSlotCount,
      bookableSlotCount: derived.bookableSlotCount,
      slots: derived.slots,
      expectedVersion: 1,
    });
    expect(updated.outcome).toBe('updated');
    if (updated.outcome === 'updated') {
      expect(updated.session.endsAt).toEqual(newEndsAt);
      expect(updated.session.version).toBe(2);
      expect(updated.session.totalSlotCount).toBe(derived.totalSlotCount);
    }

    const stale = await repository.updateClinicSession({
      sessionId: created.session.sessionId,
      startsAt: undefined,
      endsAt: newEndsAt,
      slotLengthMinutes: undefined,
      walkInAllocationPct: undefined,
      changeReason: null,
      totalSlotCount: undefined,
      bookableSlotCount: undefined,
      slots: undefined,
      expectedVersion: 1,
    });
    expect(stale.outcome).toBe('stale');
  });

  it('updateClinicSession: not_found for a session that does not exist', async () => {
    const result = await repository.updateClinicSession({
      sessionId: '01920000-0000-7000-8000-0000000000ff',
      startsAt: undefined,
      endsAt: undefined,
      slotLengthMinutes: undefined,
      walkInAllocationPct: undefined,
      changeReason: undefined,
      totalSlotCount: undefined,
      bookableSlotCount: undefined,
      slots: undefined,
      expectedVersion: 1,
    });
    expect(result.outcome).toBe('not_found');
  });

  it('listSessionSlots: reflects a real booked appointment as unavailable, leaves the walk-in allocation absent entirely', async () => {
    const created = await repository.createClinicSession(buildCreateInput(doctorId, locationId, new Date('2026-08-06T09:00:00+06:00'), new Date('2026-08-06T09:30:00+06:00'), createdBy));
    if (created.outcome !== 'created') throw new Error('setup failed');
    // 30 minutes / 10-minute slots = 3 total, floor(3 * 0.7) = 2 bookable.
    expect(created.session.totalSlotCount).toBe(3);
    expect(created.session.bookableSlotCount).toBe(2);

    const beforeBooking = await repository.listSessionSlots(created.session.sessionId);
    expect(beforeBooking).toHaveLength(2);
    expect(beforeBooking.every((slot) => slot.isAvailable)).toBe(true);

    const firstBookableSlotId = beforeBooking[0]?.slotId;
    if (firstBookableSlotId === undefined) throw new Error('setup failed');
    await db
      .insertInto('queueing.appointment')
      .values({
        id: '01920000-0000-7000-8000-000000003a02',
        appointment_ref: 'MED-2026-9001',
        clinic_session_id: created.session.sessionId,
        session_slot_id: firstBookableSlotId,
        unregistered_name: 'Test patient',
        serial_number: 1,
        origin: 'booked',
        status: 'booked',
        created_by: createdBy,
      })
      .execute();

    const afterBooking = await repository.listSessionSlots(created.session.sessionId);
    expect(afterBooking.find((slot) => slot.slotId === firstBookableSlotId)?.isAvailable).toBe(false);
    expect(afterBooking.filter((slot) => slot.isAvailable)).toHaveLength(1);

    expect(await repository.countBookedAppointments(created.session.sessionId)).toBe(1);
  });

  it('getQueueSummary: honestly all-zero with no appointments in the counted statuses', async () => {
    const created = await repository.createClinicSession(buildCreateInput(doctorId, locationId, new Date('2026-08-07T09:00:00+06:00'), new Date('2026-08-07T13:00:00+06:00'), createdBy));
    if (created.outcome !== 'created') throw new Error('setup failed');
    expect(await repository.getQueueSummary(created.session.sessionId)).toEqual({ waiting: 0, completed: 0, noShow: 0, inConsultation: 0 });
  });

  it('findServiceCalendarClosure: null when no closure is recorded, real row when one exists', async () => {
    expect(await repository.findServiceCalendarClosure(locationId, '2026-08-15')).toBeNull();

    await db
      .insertInto('config.service_calendar')
      .values({ id: '01920000-0000-7000-8000-000000003a03', location_id: locationId, calendar_date: '2026-08-15', is_service_day: false, reason: 'National Mourning Day', created_by: createdBy })
      .execute();

    const closure = await repository.findServiceCalendarClosure(locationId, '2026-08-15');
    expect(closure).toEqual(expect.objectContaining({ calendarDate: '2026-08-15', reason: 'National Mourning Day' }));
  });
});
