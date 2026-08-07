import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { PolicyStore } from '../../src/kernel/policy/policy-store.js';
import { seedIamPolicies } from '../../src/modules/iam/index.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

describe('seedIamPolicies', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let store: PolicyStore;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    store = new PolicyStore(db);
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  it('seeds the OI-14 defaults, and the reset-link expiry, with the documented values', async () => {
    await seedIamPolicies(store);

    await expect(store.getRequiredInteger('auth.session.idleTimeoutMinutes.student')).resolves.toBe(30);
    await expect(store.getRequiredInteger('auth.session.idleTimeoutMinutes.staff')).resolves.toBe(15);
    await expect(store.getRequiredInteger('auth.lockout.maxAttempts')).resolves.toBe(5);
    await expect(store.getRequiredInteger('auth.lockout.durationMinutes')).resolves.toBe(15);
    await expect(store.getRequiredInteger('auth.passwordReset.expiryMinutes')).resolves.toBe(30);
  });

  it('is idempotent — running twice never overwrites an Administrator-changed value', async () => {
    await seedIamPolicies(store);
    const current = await store.get('auth.lockout.maxAttempts');
    await store.set({
      key: 'auth.lockout.maxAttempts',
      valueText: '7',
      updatedBy: '01920000-0000-7000-8000-0000000000a1',
      expectedVersion: current!.version,
    });

    await seedIamPolicies(store);

    await expect(store.getRequiredInteger('auth.lockout.maxAttempts')).resolves.toBe(7);
  });
});
