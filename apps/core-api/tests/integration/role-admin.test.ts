import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { KyselyAccountAdminRepository } from '../../src/modules/iam/index.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

const ADMIN_1_ID = '01920000-0000-7000-8000-000000002a01';
const ADMIN_2_ID = '01920000-0000-7000-8000-000000002a02';
const STAFF_ID = '01920000-0000-7000-8000-000000002a03';

describe('KyselyAccountAdminRepository — roles — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let repository: KyselyAccountAdminRepository;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    repository = new KyselyAccountAdminRepository(db);

    await db
      .insertInto('identity.user_account')
      .values({ id: ADMIN_1_ID, email: 'role-admin-1@diu.edu.bd', full_name: 'Admin One', status: 'active' })
      .execute();
    await db
      .insertInto('identity.user_account')
      .values({ id: ADMIN_2_ID, email: 'role-admin-2@diu.edu.bd', full_name: 'Admin Two', status: 'active' })
      .execute();
    await db
      .insertInto('identity.user_account')
      .values({ id: STAFF_ID, email: 'role-staff@diu.edu.bd', full_name: 'Reception Staff', status: 'active' })
      .execute();

    const admRoleId = '00000000-0000-7000-8000-000000000006';
    await db
      .insertInto('identity.user_role')
      .values([
        { id: '01920000-0000-7000-8000-000000002a04', user_account_id: ADMIN_1_ID, role_id: admRoleId, granted_by: ADMIN_1_ID },
        { id: '01920000-0000-7000-8000-000000002a05', user_account_id: ADMIN_2_ID, role_id: admRoleId, granted_by: ADMIN_1_ID },
      ])
      .execute();
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  it('listRoleCatalogue: all six roles, STU not assignable, only CNP requires clinical staff', async () => {
    const catalogue = await repository.listRoleCatalogue();

    expect(catalogue.map((entry) => entry.code).sort()).toEqual(['ADM', 'CNP', 'DOC', 'MCS', 'STO', 'STU'].sort());
    expect(catalogue.find((entry) => entry.code === 'STU')).toMatchObject({ assignableByAdmin: false, requiresClinicalStaff: false });
    expect(catalogue.find((entry) => entry.code === 'CNP')).toMatchObject({ assignableByAdmin: true, requiresClinicalStaff: true });
    expect(catalogue.find((entry) => entry.code === 'MCS')).toMatchObject({ assignableByAdmin: true, requiresClinicalStaff: false });
  });

  it('grantRole: not_found for an unknown account, then a real grant appears in roles[]', async () => {
    expect(await repository.grantRole({ userId: '01920000-0000-7000-8000-0000000000ff', roleCode: 'MCS', grantedBy: ADMIN_1_ID })).toEqual({
      outcome: 'not_found',
    });

    const granted = await repository.grantRole({ userId: STAFF_ID, roleCode: 'MCS', grantedBy: ADMIN_1_ID });
    expect(granted.outcome).toBe('granted');
    if (granted.outcome === 'granted') {
      expect(granted.account.roles).toEqual([{ code: 'MCS', grantedBy: ADMIN_1_ID, grantedAt: expect.any(Date) }]);
    }
  });

  it('grantRole: already_held for a role the account actively holds', async () => {
    const result = await repository.grantRole({ userId: STAFF_ID, roleCode: 'MCS', grantedBy: ADMIN_1_ID });
    expect(result.outcome).toBe('already_held');
  });

  it('revokeRole: not_held, then a real revoke sets revoked_at (role no longer in roles[])', async () => {
    expect(await repository.revokeRole({ userId: STAFF_ID, roleCode: 'STO', now: new Date() })).toEqual({ outcome: 'not_held' });

    const revoked = await repository.revokeRole({ userId: STAFF_ID, roleCode: 'MCS', now: new Date() });
    expect(revoked.outcome).toBe('revoked');
    if (revoked.outcome === 'revoked') expect(revoked.account.roles).toEqual([]);
  });

  it('UQ-01 (000_AMENDMENTS.md): re-granting a revoked role hits uq_user_role, reported as already_held rather than a raw 500', async () => {
    // STAFF_ID's MCS grant was revoked in the previous test — the row still
    // exists with revoked_at set, so a fresh INSERT for the same
    // (user_account_id, role_id) pair collides with the DB's own unique
    // constraint (no `WHERE revoked_at IS NULL` scoping — see UQ-01).
    const result = await repository.grantRole({ userId: STAFF_ID, roleCode: 'MCS', grantedBy: ADMIN_1_ID });
    expect(result.outcome).toBe('already_held');
  });

  it('revokeRole: LAST_ADMIN_ROLE protects the system when exactly one active ADM remains', async () => {
    const firstRevoke = await repository.revokeRole({ userId: ADMIN_1_ID, roleCode: 'ADM', now: new Date() });
    expect(firstRevoke.outcome).toBe('revoked');

    // Now only ADMIN_2_ID holds ADM — revoking it must be refused.
    const secondRevoke = await repository.revokeRole({ userId: ADMIN_2_ID, roleCode: 'ADM', now: new Date() });
    expect(secondRevoke.outcome).toBe('would_remove_last_admin');

    const stillAdmin = await repository.findAccountDetailById(ADMIN_2_ID);
    expect(stillAdmin?.roles.map((r) => r.code)).toContain('ADM');
  });
});
