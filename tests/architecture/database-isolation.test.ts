import 'dotenv/config';

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

/**
 * ADR-001 — physical database isolation.
 *
 * `campuscare_core_app` holds no CONNECT privilege on `campuscare_counseling`,
 * and `campuscare_counseling_app` holds none on `campuscare_core`. This was
 * proven once by hand during Checkpoint B with throwaway `pg.Client` scripts;
 * this test makes that proof permanent so a future `GRANT CONNECT` typo in
 * `db-setup.ts` fails CI instead of silently reopening the boundary.
 *
 * Postgres reports privilege failures at connection time (`28000`/`42501`
 * depending on version) rather than at query time, so a bare `client.connect()`
 * is sufficient to exercise the grant.
 */
function urlWithDatabase(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

async function attemptConnect(connectionString: string): Promise<{ connected: boolean; message: string }> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.end();
    return { connected: true, message: '' };
  } catch (error) {
    return { connected: false, message: error instanceof Error ? error.message : String(error) };
  }
}

const CORE_URL = process.env.CORE_DATABASE_URL;
const COUNSELING_URL = process.env.COUNSELING_DATABASE_URL;
const ADMIN_URL = process.env.ADMIN_DATABASE_URL;

/**
 * Temporarily grants CONNECT so the test can prove the *absence* of that
 * grant is actually what the earlier assertions depend on — the "fails when
 * deliberately violated" half of the proof. Restores the boundary in a
 * `finally` regardless of outcome.
 */
async function withTemporaryGrant<T>(database: string, role: string, fn: () => Promise<T>): Promise<T> {
  const admin = new Client({ connectionString: urlWithDatabase(ADMIN_URL!, database) });
  await admin.connect();
  try {
    await admin.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
    return await fn();
  } finally {
    await admin.query(`REVOKE CONNECT ON DATABASE ${database} FROM ${role}`);
    await admin.end();
  }
}

describe.skipIf(!CORE_URL || !COUNSELING_URL)('ADR-001 · database isolation', () => {
  it('campuscare_core_app cannot CONNECT to campuscare_counseling', async () => {
    const url = urlWithDatabase(CORE_URL!, 'campuscare_counseling');
    const result = await attemptConnect(url);
    expect(result.connected).toBe(false);
    expect(result.message.toLowerCase()).toMatch(/permission denied|not permitted|no pg_hba/);
  });

  it('campuscare_counseling_app cannot CONNECT to campuscare_core', async () => {
    const url = urlWithDatabase(COUNSELING_URL!, 'campuscare_core');
    const result = await attemptConnect(url);
    expect(result.connected).toBe(false);
    expect(result.message.toLowerCase()).toMatch(/permission denied|not permitted|no pg_hba/);
  });

  it('campuscare_core_app CAN still connect to its own database (sanity check)', async () => {
    const result = await attemptConnect(CORE_URL!);
    expect(result.connected).toBe(true);
  });

  it('campuscare_counseling_app CAN still connect to its own database (sanity check)', async () => {
    const result = await attemptConnect(COUNSELING_URL!);
    expect(result.connected).toBe(true);
  });

  it.skipIf(!ADMIN_URL)(
    'the isolation check actually detects a granted connection — proof it is not vacuously passing',
    async () => {
      const before = await attemptConnect(urlWithDatabase(CORE_URL!, 'campuscare_counseling'));
      expect(before.connected).toBe(false);

      await withTemporaryGrant('campuscare_counseling', 'campuscare_core_app', async () => {
        const during = await attemptConnect(urlWithDatabase(CORE_URL!, 'campuscare_counseling'));
        expect(during.connected).toBe(true);
      });

      const after = await attemptConnect(urlWithDatabase(CORE_URL!, 'campuscare_counseling'));
      expect(after.connected).toBe(false);
    },
  );
});
