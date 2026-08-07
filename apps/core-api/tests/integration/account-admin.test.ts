import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { SystemClock } from '../../src/kernel/clock/clock.js';
import { KyselyAccountAdminRepository, PasswordHasher } from '../../src/modules/iam/index.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

const ADMIN_ID = '01920000-0000-7000-8000-000000001a01';
const STUDENT_ID = '01920000-0000-7000-8000-000000001a02';
const LOCATION_ID = '01920000-0000-7000-8000-000000001a03';
const DOCTOR_ID = '01920000-0000-7000-8000-000000001a04';
const DOCTOR_ACCOUNT_ID = '01920000-0000-7000-8000-000000001a05';
const CLINIC_SESSION_ID = '01920000-0000-7000-8000-000000001a06';
const APPOINTMENT_ID = '01920000-0000-7000-8000-000000001a07';

describe('KyselyAccountAdminRepository — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let repository: KyselyAccountAdminRepository;
  const clock = new SystemClock();

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    repository = new KyselyAccountAdminRepository(db);

    await db
      .insertInto('identity.user_account')
      .values({ id: ADMIN_ID, email: 'admin@diu.edu.bd', full_name: 'DIU IT Admin', status: 'active' })
      .execute();

    await db
      .insertInto('identity.user_account')
      .values({ id: STUDENT_ID, email: 'student-admin-test@diu.edu.bd', full_name: 'Nusrat Jahan', status: 'active' })
      .execute();
    await db
      .insertInto('identity.student_profile')
      .values({ user_account_id: STUDENT_ID, student_ref: '221-15-1234', programme: 'BSc in CSE', is_enrolled: true })
      .execute();
    const studentRoleId = '00000000-0000-7000-8000-000000000001';
    await db
      .insertInto('identity.user_role')
      .values({ id: '01920000-0000-7000-8000-000000001a08', user_account_id: STUDENT_ID, role_id: studentRoleId, granted_by: ADMIN_ID })
      .execute();
    await db
      .insertInto('identity.login_attempt')
      .values({ id: '01920000-0000-7000-8000-000000001a09', email_attempted: 'student-admin-test@diu.edu.bd', user_account_id: STUDENT_ID, succeeded: true })
      .execute();
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  it('isEmailRegistered / createAccount: local account gets a local_credential row and the requested roles', async () => {
    expect(await repository.isEmailRegistered('dr.rahman@diu.edu.bd')).toBe(false);

    const passwordHasher = new PasswordHasher();
    const result = await repository.createAccount({
      email: 'dr.rahman@diu.edu.bd',
      fullName: 'Dr. Rahman',
      authMethod: 'local',
      passwordHash: await passwordHasher.hash('unguessable-placeholder'),
      roles: ['MCS'],
      isClinicalStaff: false,
      locationId: null,
      createdBy: ADMIN_ID,
    });

    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') return;
    expect(result.account.authMethod).toBe('local');
    expect(result.account.roles.map((r) => r.code)).toEqual(['MCS']);
    expect(result.account.status).toBe('pending');

    expect(await repository.isEmailRegistered('dr.rahman@diu.edu.bd')).toBe(true);

    const duplicate = await repository.createAccount({
      email: 'dr.rahman@diu.edu.bd',
      fullName: 'Someone Else',
      authMethod: 'sso',
      passwordHash: null,
      roles: ['STO'],
      isClinicalStaff: false,
      locationId: null,
      createdBy: ADMIN_ID,
    });
    expect(duplicate.outcome).toBe('email_taken');
  });

  it('findAccountDetailById: distinguishes sso vs local, includes studentProfile and lastLoginAt', async () => {
    const studentDetail = await repository.findAccountDetailById(STUDENT_ID);
    expect(studentDetail).toMatchObject({
      userId: STUDENT_ID,
      authMethod: 'sso',
      studentProfile: { studentRef: '221-15-1234', programme: 'BSc in CSE', isEnrolled: true },
    });
    expect(studentDetail?.lastLoginAt).not.toBeNull();
    expect(studentDetail?.roles.map((r) => r.code)).toEqual(['STU']);

    expect(await repository.findAccountDetailById('01920000-0000-7000-8000-0000000000ff')).toBeNull();
  });

  it('listAccounts: filters by status and role, supports keyset pagination', async () => {
    const activeOnly = await repository.listAccounts({ status: 'active', limit: 50 });
    expect(activeOnly.items.every((item) => item.status === 'active')).toBe(true);
    expect(activeOnly.items.some((item) => item.userId === STUDENT_ID)).toBe(true);

    const studentsOnly = await repository.listAccounts({ role: 'STU', limit: 50 });
    expect(studentsOnly.items.every((item) => item.roles.includes('STU'))).toBe(true);

    const firstPage = await repository.listAccounts({ limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await repository.listAccounts({ limit: 1, cursor: firstPage.nextCursor! });
    expect(secondPage.items[0]?.userId).not.toBe(firstPage.items[0]?.userId);
  });

  it('updateAccountAdmin: CAS succeeds on the right version, reports stale otherwise', async () => {
    const before = await repository.findAccountDetailById(STUDENT_ID);
    const updated = await repository.updateAccountAdmin({
      userId: STUDENT_ID,
      fullName: 'Nusrat Jahan Renamed',
      isClinicalStaff: undefined,
      locationId: undefined,
      expectedVersion: before!.version,
      now: clock.now(),
    });
    expect(updated.outcome).toBe('updated');
    if (updated.outcome === 'updated') expect(updated.account.fullName).toBe('Nusrat Jahan Renamed');

    const stale = await repository.updateAccountAdmin({
      userId: STUDENT_ID,
      fullName: 'Should not apply',
      isClinicalStaff: undefined,
      locationId: undefined,
      expectedVersion: before!.version,
      now: clock.now(),
    });
    expect(stale.outcome).toBe('stale');
  });

  it('transitionStatus: moves status and increments version under CAS', async () => {
    const before = await repository.findAccountDetailById(STUDENT_ID);
    const suspended = await repository.transitionStatus({
      userId: STUDENT_ID,
      newStatus: 'suspended',
      expectedVersion: before!.version,
      now: clock.now(),
    });
    expect(suspended.outcome).toBe('transitioned');
    if (suspended.outcome === 'transitioned') expect(suspended.account.status).toBe('suspended');

    expect(await repository.transitionStatus({ userId: STUDENT_ID, newStatus: 'active', expectedVersion: before!.version, now: clock.now() })).toEqual({
      outcome: 'stale',
    });
    expect(
      await repository.transitionStatus({
        userId: '01920000-0000-7000-8000-0000000000ff',
        newStatus: 'active',
        expectedVersion: 1,
        now: clock.now(),
      }),
    ).toEqual({ outcome: 'not_found' });
  });

  it('findActiveAppointmentsForStudent: real query against queueing.appointment, correct calendar date under BST', async () => {
    await db.insertInto('config.location').values({ id: LOCATION_ID, code: 'MAIN', name: 'Main Campus Medical Centre' }).execute();
    await db
      .insertInto('identity.user_account')
      .values({ id: DOCTOR_ACCOUNT_ID, email: 'doctor-admin-test@diu.edu.bd', full_name: 'Dr. Rahman', status: 'active' })
      .execute();
    await db
      .insertInto('scheduling.doctor')
      .values({ id: DOCTOR_ID, user_account_id: DOCTOR_ACCOUNT_ID, full_name: 'Dr. Rahman', location_id: LOCATION_ID })
      .execute();
    await db
      .insertInto('scheduling.clinic_session')
      .values({
        id: CLINIC_SESSION_ID,
        doctor_id: DOCTOR_ID,
        location_id: LOCATION_ID,
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
        appointment_ref: 'MED-2026-0081',
        clinic_session_id: CLINIC_SESSION_ID,
        student_id: STUDENT_ID,
        serial_number: 1,
        // 'walk_in' avoids needing a real scheduling.session_slot row —
        // ck_appointment_booked_slot requires one for origin='booked'.
        origin: 'walk_in',
        status: 'booked',
        created_by: ADMIN_ID,
      })
      .execute();

    const active = await repository.findActiveAppointmentsForStudent(STUDENT_ID);

    expect(active).toEqual([{ appointmentRef: 'MED-2026-0081', sessionDate: '2026-08-10', doctorName: 'Dr. Rahman' }]);
  });
});
