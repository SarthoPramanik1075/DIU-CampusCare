import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import { SystemClock } from '../../src/kernel/clock/clock.js';
import {
  GetOwnProfileQuery,
  KyselyAuthenticationRepository,
  KyselyOwnProfileRepository,
  UpdateOwnProfileHandler,
} from '../../src/modules/iam/index.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

const STUDENT_ID = '01920000-0000-7000-8000-0000000000f1';
const STAFF_ID = '01920000-0000-7000-8000-0000000000f2';

describe('Own profile — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let getOwnProfile: GetOwnProfileQuery;
  let updateOwnProfile: UpdateOwnProfileHandler;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    const clock = new SystemClock();
    const authenticationRepository = new KyselyAuthenticationRepository(db);
    const ownProfileRepository = new KyselyOwnProfileRepository(db);
    const auditRecorder = new AuditRecorder(db);

    getOwnProfile = new GetOwnProfileQuery(ownProfileRepository, authenticationRepository);
    updateOwnProfile = new UpdateOwnProfileHandler(ownProfileRepository, authenticationRepository, auditRecorder, clock);

    // A student account with a local credential and a student_profile row.
    await db
      .insertInto('identity.user_account')
      .values({ id: STUDENT_ID, email: 'profile-student@diu.edu.bd', full_name: 'Profile Student', status: 'active' })
      .execute();
    await db
      .insertInto('identity.local_credential')
      .values({ user_account_id: STUDENT_ID, password_hash: 'unused-in-this-suite' })
      .execute();
    await db
      .insertInto('identity.student_profile')
      .values({ user_account_id: STUDENT_ID, student_ref: '221-15-9999', programme: 'BSc in CSE', is_enrolled: true })
      .execute();
    const studentRoleId = '00000000-0000-7000-8000-000000000001';
    await db
      .insertInto('identity.user_role')
      .values({ id: '01920000-0000-7000-8000-0000000000f3', user_account_id: STUDENT_ID, role_id: studentRoleId, granted_by: STUDENT_ID })
      .execute();

    // An SSO-only staff account: no local_credential row, no student_profile.
    await db
      .insertInto('identity.user_account')
      .values({
        id: STAFF_ID,
        email: 'profile-staff@diu.edu.bd',
        external_subject: 'sso-subject-profile-staff',
        full_name: 'Profile Staff',
        status: 'active',
      })
      .execute();
    const doctorRoleId = '00000000-0000-7000-8000-000000000002';
    await db
      .insertInto('identity.user_role')
      .values({ id: '01920000-0000-7000-8000-0000000000f4', user_account_id: STAFF_ID, role_id: doctorRoleId, granted_by: STAFF_ID })
      .execute();
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  it('GET /me shape: a local student account has authMethod "local" and a real studentProfile', async () => {
    const profile = await getOwnProfile.execute(STUDENT_ID);

    expect(profile).toMatchObject({
      userId: STUDENT_ID,
      email: 'profile-student@diu.edu.bd',
      authMethod: 'local',
      roles: ['STU'],
      studentProfile: { studentRef: '221-15-9999', programme: 'BSc in CSE', isEnrolled: true },
    });
  });

  it('GET /me shape: an SSO-only staff account has authMethod "sso" and a null studentProfile', async () => {
    const profile = await getOwnProfile.execute(STAFF_ID);

    expect(profile).toMatchObject({ userId: STAFF_ID, authMethod: 'sso', roles: ['DOC'], studentProfile: null });
  });

  it('returns null for an unknown account', async () => {
    expect(await getOwnProfile.execute('01920000-0000-7000-8000-00000000ffff')).toBeNull();
  });

  it('PATCH /me updates fullName, increments version, and audits — real row persists', async () => {
    const before = await getOwnProfile.execute(STUDENT_ID);

    const result = await updateOwnProfile.execute({
      userAccountId: STUDENT_ID,
      fullName: 'Profile Student Renamed',
      expectedVersion: before!.version,
      correlationId: 'corr-profile-update',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.fullName).toBe('Profile Student Renamed');
      expect(result.value.version).toBe(before!.version + 1);
    }

    const reread = await getOwnProfile.execute(STUDENT_ID);
    expect(reread?.fullName).toBe('Profile Student Renamed');
    expect(reread?.version).toBe(before!.version + 1);

    const auditRow = await db
      .selectFrom('audit.audit_log')
      .selectAll()
      .where('entity_id', '=', STUDENT_ID)
      .where('action', '=', 'profile_updated')
      .executeTakeFirst();
    expect(auditRow).toBeDefined();
  });

  it('PATCH /me with a stale version returns CONFLICT_STALE_VERSION and does not change the row', async () => {
    const before = await getOwnProfile.execute(STUDENT_ID);

    const result = await updateOwnProfile.execute({
      userAccountId: STUDENT_ID,
      fullName: 'Should not be applied',
      expectedVersion: before!.version - 1,
      correlationId: 'corr-profile-stale',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT_STALE_VERSION');
      expect(result.error.details?.current).toMatchObject({ userId: STUDENT_ID, version: before!.version });
    }

    const unchanged = await getOwnProfile.execute(STUDENT_ID);
    expect(unchanged?.fullName).toBe(before!.fullName);
    expect(unchanged?.version).toBe(before!.version);
  });
});
