import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { KyselyServiceCalendarRepository } from '../../src/modules/config/index.js';
import { deriveSlots, KyselyClinicSessionRepository, KyselyDoctorRepository } from '../../src/modules/scheduling/index.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

describe('listPublicAvailability — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let sessionRepository: KyselyClinicSessionRepository;
  let calendarRepository: KyselyServiceCalendarRepository;
  let doctorId: string;
  let locationId: string;
  const createdBy = '01920000-0000-7000-8000-000000008a01';

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    sessionRepository = new KyselyClinicSessionRepository(db);
    calendarRepository = new KyselyServiceCalendarRepository(db);

    locationId = (await db.selectFrom('config.location').select('id').executeTakeFirstOrThrow()).id;
    await db.insertInto('identity.user_account').values({ id: createdBy, email: 'public-availability-test@diu.edu.bd', full_name: 'DIU Medical Staff', status: 'active' }).execute();

    const doctorRepository = new KyselyDoctorRepository(db);
    const doctor = await doctorRepository.createDoctor({ fullName: 'Dr. Availability', designation: 'Consultant', specialisation: 'General Medicine', photoUrl: '/media/doctors/x.jpg', userAccountId: null, locationId });
    if (doctor.outcome !== 'created') throw new Error('setup failed');
    doctorId = doctor.doctor.doctorId;
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  it('shows a closed day with its reason and zero sessions, and an open day with the real session and slot counts', async () => {
    await calendarRepository.createEntries(locationId, ['2026-08-20'], false, 'National Mourning Day', createdBy);

    const startsAt = new Date('2026-08-21T09:00:00+06:00');
    const endsAt = new Date('2026-08-21T13:00:00+06:00');
    const derived = deriveSlots({ startsAt, endsAt, slotLengthMinutes: 10, walkInAllocationPct: 30 });
    const created = await sessionRepository.createClinicSession({
      doctorId,
      locationId,
      dutyRosterId: null,
      sessionDate: '2026-08-21',
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

    const days = await sessionRepository.listPublicAvailability(locationId, '2026-08-20', '2026-08-21', undefined);
    expect(days).toHaveLength(2);

    const closedDay = days[0];
    expect(closedDay).toEqual({ date: '2026-08-20', isServiceDay: false, closureReason: 'National Mourning Day', sessions: [] });

    const openDay = days[1];
    expect(openDay?.isServiceDay).toBe(true);
    expect(openDay?.closureReason).toBeNull();
    expect(openDay?.sessions).toEqual([
      expect.objectContaining({
        sessionId: created.session.sessionId,
        doctorId,
        doctorName: 'Dr. Availability',
        designation: 'Consultant',
        specialisation: 'General Medicine',
        photoUrl: '/media/doctors/x.jpg',
        status: 'scheduled',
        bookableSlotCount: derived.bookableSlotCount,
        bookedSlotCount: 0,
      }),
    ]);
  });

  it('a day with no calendar entry and no session defaults to open with an empty session list', async () => {
    const days = await sessionRepository.listPublicAvailability(locationId, '2026-12-25', '2026-12-25', undefined);
    expect(days).toEqual([{ date: '2026-12-25', isServiceDay: true, closureReason: null, sessions: [] }]);
  });

  it('excludes cancelled sessions from the projection', async () => {
    const startsAt = new Date('2026-08-25T09:00:00+06:00');
    const endsAt = new Date('2026-08-25T13:00:00+06:00');
    const derived = deriveSlots({ startsAt, endsAt, slotLengthMinutes: 10, walkInAllocationPct: 30 });
    const created = await sessionRepository.createClinicSession({
      doctorId,
      locationId,
      dutyRosterId: null,
      sessionDate: '2026-08-25',
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

    await sessionRepository.cancelSession(created.session.sessionId, 1, 'Doctor called to an emergency at the main campus');

    const days = await sessionRepository.listPublicAvailability(locationId, '2026-08-25', '2026-08-25', undefined);
    expect(days).toEqual([{ date: '2026-08-25', isServiceDay: true, closureReason: null, sessions: [] }]);
  });

  it('filters to one doctor when doctorId is given', async () => {
    const doctorRepository = new KyselyDoctorRepository(db);
    const otherDoctor = await doctorRepository.createDoctor({ fullName: 'Dr. Other', designation: null, specialisation: null, photoUrl: null, userAccountId: null, locationId });
    if (otherDoctor.outcome !== 'created') throw new Error('setup failed');

    const startsAt = new Date('2026-08-26T09:00:00+06:00');
    const endsAt = new Date('2026-08-26T13:00:00+06:00');
    const derived = deriveSlots({ startsAt, endsAt, slotLengthMinutes: 10, walkInAllocationPct: 30 });
    await sessionRepository.createClinicSession({
      doctorId: otherDoctor.doctor.doctorId,
      locationId,
      dutyRosterId: null,
      sessionDate: '2026-08-26',
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

    const filtered = await sessionRepository.listPublicAvailability(locationId, '2026-08-26', '2026-08-26', doctorId);
    expect(filtered).toEqual([{ date: '2026-08-26', isServiceDay: true, closureReason: null, sessions: [] }]);
  });
});
