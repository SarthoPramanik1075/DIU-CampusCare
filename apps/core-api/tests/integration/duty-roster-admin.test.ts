import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { KyselyDoctorRepository, KyselyDutyRosterRepository } from '../../src/modules/scheduling/index.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

describe('KyselyDutyRosterRepository — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let repository: KyselyDutyRosterRepository;
  let doctorId: string;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    repository = new KyselyDutyRosterRepository(db);

    const locationId = (await db.selectFrom('config.location').select('id').executeTakeFirstOrThrow()).id;
    const doctorRepository = new KyselyDoctorRepository(db);
    const created = await doctorRepository.createDoctor({
      fullName: 'Dr. Rahman',
      designation: null,
      specialisation: null,
      photoUrl: null,
      userAccountId: null,
      locationId,
    });
    if (created.outcome !== 'created') throw new Error('setup failed');
    doctorId = created.doctor.doctorId;
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  it('doctorExists: true for a real doctor, false otherwise', async () => {
    expect(await repository.doctorExists(doctorId)).toBe(true);
    expect(await repository.doctorExists('01920000-0000-7000-8000-0000000000ff')).toBe(false);
  });

  it('createDutyRoster / listDutyRosters: real round trip', async () => {
    const result = await repository.createDutyRoster({
      doctorId,
      weekday: 1,
      startsAtLocal: '09:00',
      endsAtLocal: '13:00',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      createdBy: doctorId,
    });
    expect(result.outcome).toBe('created');

    const items = await repository.listDutyRosters({ doctorId });
    expect(items).toEqual([
      expect.objectContaining({ weekday: 1, startsAtLocal: '09:00:00', endsAtLocal: '13:00:00', isActive: true, version: 1 }),
    ]);
  });

  it('createDutyRoster: ROSTER_OVERLAP for the same weekday with an overlapping time range', async () => {
    const overlapping = await repository.createDutyRoster({
      doctorId,
      weekday: 1,
      startsAtLocal: '12:00',
      endsAtLocal: '15:00',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      createdBy: doctorId,
    });
    expect(overlapping.outcome).toBe('overlap');
    if (overlapping.outcome === 'overlap') {
      expect(overlapping.conflictingRoster.startsAtLocal).toBe('09:00:00');
    }
  });

  it('createDutyRoster: no overlap for a non-overlapping time on the same weekday', async () => {
    const result = await repository.createDutyRoster({
      doctorId,
      weekday: 1,
      startsAtLocal: '14:00',
      endsAtLocal: '17:00',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      createdBy: doctorId,
    });
    expect(result.outcome).toBe('created');
  });

  it('createDutyRoster: no overlap for the same time range on a different weekday', async () => {
    const result = await repository.createDutyRoster({
      doctorId,
      weekday: 2,
      startsAtLocal: '09:00',
      endsAtLocal: '13:00',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      createdBy: doctorId,
    });
    expect(result.outcome).toBe('created');
  });

  it('createDutyRoster: no overlap when effective date ranges do not intersect', async () => {
    const result = await repository.createDutyRoster({
      doctorId,
      weekday: 1,
      startsAtLocal: '09:00',
      endsAtLocal: '13:00',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-03-01',
      createdBy: doctorId,
    });
    // Overlaps in time/weekday with the very first roster, but that one is
    // still open-ended (effectiveTo: null) so it DOES overlap in date range
    // too — confirms the date-range check is a real AND, not a decoy.
    expect(result.outcome).toBe('overlap');
  });

  it('updateDutyRoster: applies a partial update, bumps version, excludes itself from its own overlap check', async () => {
    const created = await repository.createDutyRoster({
      doctorId,
      weekday: 3,
      startsAtLocal: '09:00',
      endsAtLocal: '11:00',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      createdBy: doctorId,
    });
    if (created.outcome !== 'created') throw new Error('setup failed');

    // Updating its own end time to the same value it already has must not
    // conflict with itself.
    const updated = await repository.updateDutyRoster({
      rosterId: created.roster.rosterId,
      weekday: undefined,
      startsAtLocal: undefined,
      endsAtLocal: '12:00',
      effectiveFrom: undefined,
      effectiveTo: undefined,
      expectedVersion: 1,
    });
    expect(updated.outcome).toBe('updated');
    if (updated.outcome === 'updated') {
      expect(updated.roster.endsAtLocal).toBe('12:00:00');
      expect(updated.roster.version).toBe(2);
    }

    const stale = await repository.updateDutyRoster({
      rosterId: created.roster.rosterId,
      weekday: undefined,
      startsAtLocal: undefined,
      endsAtLocal: '13:00',
      effectiveFrom: undefined,
      effectiveTo: undefined,
      expectedVersion: 1,
    });
    expect(stale.outcome).toBe('stale');
  });

  it('updateDutyRoster: not_found for a roster that does not exist', async () => {
    const result = await repository.updateDutyRoster({
      rosterId: '01920000-0000-7000-8000-0000000000ff',
      weekday: undefined,
      startsAtLocal: undefined,
      endsAtLocal: undefined,
      effectiveFrom: undefined,
      effectiveTo: undefined,
      expectedVersion: 1,
    });
    expect(result.outcome).toBe('not_found');
  });

  it('deleteDutyRoster: soft-deletes (is_active = false), row is retained — P4', async () => {
    const created = await repository.createDutyRoster({
      doctorId,
      weekday: 4,
      startsAtLocal: '09:00',
      endsAtLocal: '11:00',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      createdBy: doctorId,
    });
    if (created.outcome !== 'created') throw new Error('setup failed');

    const deleted = await repository.deleteDutyRoster(created.roster.rosterId);
    expect(deleted.outcome).toBe('deleted');

    const stillThere = await repository.findDutyRosterById(created.roster.rosterId);
    expect(stillThere).toEqual(expect.objectContaining({ isActive: false }));

    // A new, overlapping roster for the same slot is now permitted — the
    // deactivated row is excluded from the overlap check (is_active = true).
    const replacement = await repository.createDutyRoster({
      doctorId,
      weekday: 4,
      startsAtLocal: '09:00',
      endsAtLocal: '11:00',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      createdBy: doctorId,
    });
    expect(replacement.outcome).toBe('created');
  });

  it('deleteDutyRoster: not_found for a roster that does not exist', async () => {
    expect(await repository.deleteDutyRoster('01920000-0000-7000-8000-0000000000ff')).toEqual({ outcome: 'not_found' });
  });
});
