import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { KyselyServiceCalendarRepository } from '../../src/modules/config/index.js';
import { deriveSlots, KyselyClinicSessionRepository, KyselyDoctorRepository } from '../../src/modules/scheduling/index.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

describe('KyselyServiceCalendarRepository — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let repository: KyselyServiceCalendarRepository;
  let locationId: string;
  const createdBy = '01920000-0000-7000-8000-000000007a01';

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    repository = new KyselyServiceCalendarRepository(db);

    locationId = (await db.selectFrom('config.location').select('id').executeTakeFirstOrThrow()).id;
    await db.insertInto('identity.user_account').values({ id: createdBy, email: 'service-calendar-admin-test@diu.edu.bd', full_name: 'DIU IT Admin', status: 'active' }).execute();
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  it('findDefaultLocationId: resolves the single seeded Phase 1 location', async () => {
    expect(await repository.findDefaultLocationId()).toBe(locationId);
  });

  it('createEntries: one row per date in the range, real round trip, conflict on a re-attempt', async () => {
    const created = await repository.createEntries(locationId, ['2026-08-15', '2026-08-16'], false, 'National Mourning Day', createdBy);
    expect(created.outcome).toBe('created');
    if (created.outcome === 'created') {
      expect(created.items).toHaveLength(2);
      expect(created.items[0]).toEqual(expect.objectContaining({ calendarDate: '2026-08-15', isServiceDay: false, reason: 'National Mourning Day', createdByName: 'DIU IT Admin', version: 1 }));
    }

    const conflict = await repository.createEntries(locationId, ['2026-08-16', '2026-08-17'], false, 'Trying again', createdBy);
    expect(conflict.outcome).toBe('conflict');
    if (conflict.outcome === 'conflict') expect(conflict.conflictingDate).toBe('2026-08-16');

    const stillOnlyTwo = await repository.listEntries(locationId, '2026-08-15', '2026-08-17');
    expect(stillOnlyTwo).toHaveLength(2); // the conflicting batch inserted nothing, not a partial write
  });

  it('findConflictingSessions: reports an already-scheduled session on a date being closed, without cancelling it', async () => {
    const doctorRepository = new KyselyDoctorRepository(db);
    const doctor = await doctorRepository.createDoctor({ fullName: 'Dr. Calendar', designation: null, specialisation: null, photoUrl: null, userAccountId: null, locationId });
    if (doctor.outcome !== 'created') throw new Error('setup failed');

    const sessionRepository = new KyselyClinicSessionRepository(db);
    const startsAt = new Date('2026-09-01T09:00:00+06:00');
    const endsAt = new Date('2026-09-01T13:00:00+06:00');
    const derived = deriveSlots({ startsAt, endsAt, slotLengthMinutes: 10, walkInAllocationPct: 30 });
    const session = await sessionRepository.createClinicSession({
      doctorId: doctor.doctor.doctorId,
      locationId,
      dutyRosterId: null,
      sessionDate: '2026-09-01',
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
    if (session.outcome !== 'created') throw new Error('setup failed');

    const conflicts = await repository.findConflictingSessions(locationId, ['2026-09-01']);
    expect(conflicts).toEqual([{ sessionId: session.session.sessionId, doctorName: 'Dr. Calendar', sessionDate: '2026-09-01' }]);

    const created = await repository.createEntries(locationId, ['2026-09-01'], false, 'Surprise closure', createdBy);
    expect(created.outcome).toBe('created');
    if (created.outcome === 'created') expect(created.conflictingSessions).toEqual([{ sessionId: session.session.sessionId, doctorName: 'Dr. Calendar', sessionDate: '2026-09-01' }]);

    // Creating the entry never touches the session itself — API §8.4's own rule.
    const stillScheduled = await sessionRepository.findClinicSessionById(session.session.sessionId);
    expect(stillScheduled?.status).toBe('scheduled');
  });

  it('updateEntry: applies a partial update, bumps version manually (no trigger), detects a stale version', async () => {
    const created = await repository.createEntries(locationId, ['2026-10-01'], false, 'Initial reason', createdBy);
    if (created.outcome !== 'created') throw new Error('setup failed');
    const entryId = created.items[0]?.id;
    if (entryId === undefined) throw new Error('setup failed');

    const updated = await repository.updateEntry(entryId, { isServiceDay: true, reason: undefined, expectedVersion: 1 });
    expect(updated.outcome).toBe('updated');
    if (updated.outcome === 'updated') {
      expect(updated.entry.isServiceDay).toBe(true);
      expect(updated.entry.reason).toBe('Initial reason'); // untouched
      expect(updated.entry.version).toBe(2);
    }

    const stale = await repository.updateEntry(entryId, { isServiceDay: false, reason: undefined, expectedVersion: 1 });
    expect(stale.outcome).toBe('stale');

    const missing = await repository.updateEntry('01920000-0000-7000-8000-0000000000ff', { isServiceDay: true, reason: undefined, expectedVersion: 1 });
    expect(missing.outcome).toBe('not_found');
  });

  it('deleteEntry: real round trip, not_found for an unknown id', async () => {
    const created = await repository.createEntries(locationId, ['2026-11-01'], false, 'To be removed', createdBy);
    if (created.outcome !== 'created') throw new Error('setup failed');
    const entryId = created.items[0]?.id;
    if (entryId === undefined) throw new Error('setup failed');

    expect(await repository.deleteEntry(entryId)).toBe('deleted');
    expect(await repository.findEntryById(entryId)).toBeNull();
    expect(await repository.deleteEntry('01920000-0000-7000-8000-0000000000ff')).toBe('not_found');
  });
});
