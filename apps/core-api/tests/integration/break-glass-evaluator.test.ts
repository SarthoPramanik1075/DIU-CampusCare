import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { BreakGlassEvaluator } from '../../src/kernel/authz/break-glass-evaluator.js';
import { FixedClock } from '../support/fixed-clock.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

const NOW = new Date('2026-08-04T14:25:00+06:00');

describe('BreakGlassEvaluator — FR-AUD-05…07, PRM-14', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let evaluator: BreakGlassEvaluator;
  const adminId = '01920000-0000-7000-8000-0000000000e1';

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    evaluator = new BreakGlassEvaluator(db, new FixedClock(NOW));

    await db
      .insertInto('config.location')
      .values({ id: '01920000-0000-7000-8000-0000000000e0', code: 'MAIN', name: 'Main' })
      .execute();
    await db
      .insertInto('identity.user_account')
      .values({
        id: adminId,
        email: 'admin@diu.edu.bd',
        full_name: 'DIU IT',
        location_id: '01920000-0000-7000-8000-0000000000e0',
      })
      .execute();
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  it('returns false when no grant exists at all', async () => {
    await expect(evaluator.hasActiveGrant(adminId)).resolves.toBe(false);
  });

  it('returns true for a grant that has not yet expired', async () => {
    await db
      .insertInto('audit.break_glass_grant')
      .values({
        id: '01920000-0000-7000-8000-0000000000e2',
        administrator_id: adminId,
        justification: 'Serious incident reported by the Proctor and the head is unreachable.',
        granted_at: NOW,
        expires_at: new Date(NOW.getTime() + 60 * 60 * 1000),
      })
      .execute();
    await expect(evaluator.hasActiveGrant(adminId)).resolves.toBe(true);
  });

  it('returns false once the grant has expired', async () => {
    const laterEvaluator = new BreakGlassEvaluator(db, new FixedClock(new Date(NOW.getTime() + 61 * 60 * 1000)));
    await expect(laterEvaluator.hasActiveGrant(adminId)).resolves.toBe(false);
  });

  it('returns false for a grant that was revoked before expiry', async () => {
    const revokedAdminId = '01920000-0000-7000-8000-0000000000e3';
    await db
      .insertInto('identity.user_account')
      .values({
        id: revokedAdminId,
        email: 'admin2@diu.edu.bd',
        full_name: 'Second Admin',
        location_id: '01920000-0000-7000-8000-0000000000e0',
      })
      .execute();
    await db
      .insertInto('audit.break_glass_grant')
      .values({
        id: '01920000-0000-7000-8000-0000000000e4',
        administrator_id: revokedAdminId,
        justification: 'Incident resolved shortly after the grant was requested this afternoon.',
        granted_at: NOW,
        expires_at: new Date(NOW.getTime() + 60 * 60 * 1000),
        revoked_at: new Date(NOW.getTime() + 5 * 60 * 1000),
      })
      .execute();

    await expect(evaluator.hasActiveGrant(revokedAdminId)).resolves.toBe(false);
  });

  it("never returns true for a different administrator's grant", async () => {
    const otherAdminId = '01920000-0000-7000-8000-0000000000e5';
    await expect(evaluator.hasActiveGrant(otherAdminId)).resolves.toBe(false);
  });
});
