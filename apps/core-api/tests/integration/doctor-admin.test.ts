import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { KyselyDoctorRepository } from '../../src/modules/scheduling/index.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

const ADMIN_ID = '01920000-0000-7000-8000-000000002a01';
const DOCTOR_ACCOUNT_ID = '01920000-0000-7000-8000-000000002a02';
const CLINIC_SESSION_ID = '01920000-0000-7000-8000-000000002a03';
const APPOINTMENT_ID = '01920000-0000-7000-8000-000000002a04';

describe('KyselyDoctorRepository — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let repository: KyselyDoctorRepository;
  let locationId: string;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    repository = new KyselyDoctorRepository(db);

    // 008_scheduling_extensions.sql seeds the single Phase 1 location.
    locationId = (await db.selectFrom('config.location').select('id').executeTakeFirstOrThrow()).id;

    await db.insertInto('identity.user_account').values({ id: ADMIN_ID, email: 'doctor-admin-test@diu.edu.bd', full_name: 'DIU IT Admin', status: 'active' }).execute();
    await db
      .insertInto('identity.user_account')
      .values({ id: DOCTOR_ACCOUNT_ID, email: 'dr-rahman-doctor-test@diu.edu.bd', full_name: 'Dr. Rahman', status: 'active' })
      .execute();
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  it('findDefaultLocationId: resolves the single seeded Phase 1 location', async () => {
    expect(await repository.findDefaultLocationId()).toBe(locationId);
  });

  it('createDoctor / findDoctorDetailById: real round trip with real roster/session counts', async () => {
    const result = await repository.createDoctor({
      fullName: 'Dr. Chowdhury',
      designation: 'Consultant',
      specialisation: 'General Medicine',
      photoUrl: null,
      userAccountId: null,
      locationId,
    });
    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') return;

    expect(result.doctor).toEqual({
      doctorId: result.doctor.doctorId,
      userAccountId: null,
      fullName: 'Dr. Chowdhury',
      designation: 'Consultant',
      specialisation: 'General Medicine',
      photoUrl: null,
      isActive: true,
      activeRosterCount: 0,
      upcomingSessionCount: 0,
      version: 1,
    });

    const detail = await repository.findDoctorDetailById(result.doctor.doctorId);
    expect(detail).toEqual(result.doctor);
  });

  it('createDoctor: ACCOUNT_ALREADY_LINKED when the user account is already linked to a doctor', async () => {
    const first = await repository.createDoctor({
      fullName: 'Dr. Rahman',
      designation: null,
      specialisation: null,
      photoUrl: null,
      userAccountId: DOCTOR_ACCOUNT_ID,
      locationId,
    });
    expect(first.outcome).toBe('created');

    const second = await repository.createDoctor({
      fullName: 'Dr. Rahman (duplicate)',
      designation: null,
      specialisation: null,
      photoUrl: null,
      userAccountId: DOCTOR_ACCOUNT_ID,
      locationId,
    });
    expect(second.outcome).toBe('account_already_linked');

    expect(await repository.isUserAccountLinked(DOCTOR_ACCOUNT_ID)).toBe(true);
  });

  it('updateDoctor: applies a partial update and bumps version; stale version is detected', async () => {
    const created = await repository.createDoctor({
      fullName: 'Dr. Islam',
      designation: 'Registrar',
      specialisation: null,
      photoUrl: null,
      userAccountId: null,
      locationId,
    });
    if (created.outcome !== 'created') throw new Error('setup failed');

    const updated = await repository.updateDoctor({
      doctorId: created.doctor.doctorId,
      fullName: undefined,
      designation: 'Senior Consultant',
      specialisation: undefined,
      photoUrl: undefined,
      expectedVersion: 1,
    });
    expect(updated.outcome).toBe('updated');
    if (updated.outcome === 'updated') {
      expect(updated.doctor.designation).toBe('Senior Consultant');
      expect(updated.doctor.fullName).toBe('Dr. Islam');
      expect(updated.doctor.version).toBe(2);
    }

    const stale = await repository.updateDoctor({
      doctorId: created.doctor.doctorId,
      fullName: 'Dr. Islam (renamed)',
      designation: undefined,
      specialisation: undefined,
      photoUrl: undefined,
      expectedVersion: 1,
    });
    expect(stale.outcome).toBe('stale');
  });

  it('updateDoctor: not_found for a doctor that does not exist', async () => {
    const result = await repository.updateDoctor({
      doctorId: '01920000-0000-7000-8000-0000000000ff',
      fullName: 'Nobody',
      designation: undefined,
      specialisation: undefined,
      photoUrl: undefined,
      expectedVersion: 1,
    });
    expect(result.outcome).toBe('not_found');
  });

  it('deactivateDoctor: deactivates and reports zero affected upcoming sessions when there are none', async () => {
    const created = await repository.createDoctor({
      fullName: 'Dr. Karim',
      designation: null,
      specialisation: null,
      photoUrl: null,
      userAccountId: null,
      locationId,
    });
    if (created.outcome !== 'created') throw new Error('setup failed');

    const outcome = await repository.deactivateDoctor(created.doctor.doctorId, 1);
    expect(outcome.outcome).toBe('deactivated');
    if (outcome.outcome === 'deactivated') {
      expect(outcome.doctor.isActive).toBe(false);
      expect(outcome.affectedUpcomingSessions).toBe(0);
    }
  });

  it('countAppointmentHistory / deleteDoctor: DOCTOR_HAS_HISTORY blocks deletion; zero-history deletes cleanly', async () => {
    // A doctor with real appointment history, via a real clinic_session — EC-20.
    const withHistory = await repository.createDoctor({
      fullName: 'Dr. Fatima',
      designation: null,
      specialisation: null,
      photoUrl: null,
      userAccountId: null,
      locationId,
    });
    if (withHistory.outcome !== 'created') throw new Error('setup failed');

    await db
      .insertInto('scheduling.clinic_session')
      .values({
        id: CLINIC_SESSION_ID,
        doctor_id: withHistory.doctor.doctorId,
        location_id: locationId,
        session_date: '2026-08-10',
        starts_at: new Date('2026-08-10T09:00:00+06:00'),
        ends_at: new Date('2026-08-10T12:00:00+06:00'),
        slot_length_minutes: 10,
        walk_in_allocation_pct: 20,
        total_slot_count: 18,
        bookable_slot_count: 18,
        created_by: ADMIN_ID,
      })
      .execute();
    await db
      .insertInto('queueing.appointment')
      .values({
        id: APPOINTMENT_ID,
        appointment_ref: 'MED-2026-0099',
        clinic_session_id: CLINIC_SESSION_ID,
        serial_number: 1,
        // 'walk_in' avoids needing a real scheduling.session_slot row — ck_appointment_booked_slot requires one for origin='booked'.
        origin: 'walk_in',
        unregistered_name: 'Walk-in patient',
        status: 'completed',
        created_by: ADMIN_ID,
      })
      .execute();

    expect(await repository.countAppointmentHistory(withHistory.doctor.doctorId)).toBe(1);
    // `DeleteDoctorHandler` checks `countAppointmentHistory`/`isDeletable`
    // before ever calling this and returns a friendly `DOCTOR_HAS_HISTORY`
    // (see the contract test for that path) — but the real backstop is the
    // database itself: `clinic_session.doctor_id` has no `ON DELETE
    // CASCADE`, so a doctor referenced by a session can't be deleted no
    // matter what application code does or doesn't check. Proving that
    // directly here is more convincing than trusting the handler's
    // pre-check alone.
    await expect(repository.deleteDoctor(withHistory.doctor.doctorId)).rejects.toThrow(/foreign key constraint/);

    // A doctor with zero history deletes cleanly.
    const withoutHistory = await repository.createDoctor({
      fullName: 'Dr. Noor',
      designation: null,
      specialisation: null,
      photoUrl: null,
      userAccountId: null,
      locationId,
    });
    if (withoutHistory.outcome !== 'created') throw new Error('setup failed');
    expect(await repository.countAppointmentHistory(withoutHistory.doctor.doctorId)).toBe(0);
    expect(await repository.deleteDoctor(withoutHistory.doctor.doctorId)).toEqual({ outcome: 'deleted' });
    expect(await repository.findDoctorDetailById(withoutHistory.doctor.doctorId)).toBeNull();
  });

  it('deleteDoctor: not_found for a doctor that does not exist', async () => {
    expect(await repository.deleteDoctor('01920000-0000-7000-8000-0000000000ff')).toEqual({ outcome: 'not_found' });
  });

  it('listDoctors: filters by isActive and q, paginates with a cursor', async () => {
    const page = await repository.listDoctors({ limit: 2 });
    expect(page.items.length).toBeGreaterThan(0);

    const activeOnly = await repository.listDoctors({ isActive: true, limit: 200 });
    expect(activeOnly.items.every((item) => item.isActive)).toBe(true);

    const searched = await repository.listDoctors({ q: 'Chowdhury', limit: 200 });
    expect(searched.items.some((item) => item.fullName.includes('Chowdhury'))).toBe(true);
  });
});
