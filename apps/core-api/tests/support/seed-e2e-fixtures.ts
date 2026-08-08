import 'dotenv/config';

import { Client } from 'pg';
import { uuidv7 } from 'uuidv7';

import { PasswordHasher } from '../../src/modules/iam/infrastructure/password-hasher.js';

import { E2E_ADMIN, E2E_OPERATOR, E2E_STAFF, E2E_STUDENT } from './e2e-fixture-accounts.js';

/**
 * Seeds the fixture accounts `tests/e2e/` needs to exercise a real
 * sign-in, against whatever database `CORE_DATABASE_URL` points at (a
 * fresh, migrated, otherwise-empty `postgres:16` in CI; the developer's
 * own dev database locally). `pnpm test:e2e` runs this before `playwright
 * test` — never folded into a migration, since none of these accounts may
 * exist in a real deployment.
 *
 * The Administrator and Student accounts are a deliberate bootstrap
 * exception, not a precedent to copy:
 *
 *   - No Administrator can self-register (BR-05, FR-AUTH-02) — every ADM
 *     account is created by an existing one. The very first has to come
 *     from somewhere outside the API, which is exactly what this script
 *     is; the M1 plan's own Gate G1 calls this "seeded manually once" for
 *     a human's walkthrough, and this is that same step, automated for CI.
 *   - A real student account is always SSO-provisioned on first login
 *     (`findOrProvisionBySsoSubject`), never created this way — `POST
 *     /users` explicitly refuses `STU` (see `create-account.handler.ts`).
 *     No SSO identity provider is configured in this environment (M1-C),
 *     so there is no real path to a student account here at all. This
 *     script writes the `identity.student_profile`/`local_credential` rows
 *     directly, bypassing the application layer entirely — acceptable for
 *     a disposable test fixture in a way it would never be for production
 *     provisioning.
 *
 * The Staff (MCS) and Operator (STO) accounts have no such bootstrap
 * problem — an Administrator can create either through the real `POST
 * /users` API — but are seeded the same direct-SQL way for symmetry and
 * speed rather than round-tripping through create-account and
 * password-reset-confirm on every test run.
 *
 * Idempotent: safe to run against a dev database that already has these
 * rows (checks by email first), which is what a local `pnpm test:e2e` —
 * outside CI's always-fresh database — does every time.
 */

interface SeedAccount {
  readonly email: string;
  readonly fullName: string;
  readonly password: string;
  readonly roleCode: 'ADM' | 'STU' | 'MCS' | 'STO';
  readonly studentRef?: string;
}

const ACCOUNTS: readonly SeedAccount[] = [
  { email: E2E_ADMIN.email, fullName: 'E2E Administrator', password: E2E_ADMIN.password, roleCode: 'ADM' },
  {
    email: E2E_STUDENT.email,
    fullName: 'E2E Student',
    password: E2E_STUDENT.password,
    roleCode: 'STU',
    studentRef: '000-00-0000',
  },
  { email: E2E_STAFF.email, fullName: 'E2E Staff', password: E2E_STAFF.password, roleCode: 'MCS' },
  { email: E2E_OPERATOR.email, fullName: 'E2E Operator', password: E2E_OPERATOR.password, roleCode: 'STO' },
];

async function seedAccount(client: Client, hasher: PasswordHasher, account: SeedAccount): Promise<void> {
  const existing = await client.query<{ id: string }>('SELECT id FROM identity.user_account WHERE email = $1', [
    account.email,
  ]);
  if (existing.rows.length > 0) {
    return;
  }

  const roleRow = await client.query<{ id: string }>('SELECT id FROM identity.role WHERE code = $1', [
    account.roleCode,
  ]);
  if (roleRow.rows.length === 0) {
    throw new Error(`identity.role has no ${account.roleCode} row — has the seed migration run?`);
  }

  const userId = uuidv7();
  const passwordHash = await hasher.hash(account.password);

  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO identity.user_account (id, email, full_name, status) VALUES ($1, $2, $3, 'active')`,
      [userId, account.email, account.fullName],
    );
    await client.query(`INSERT INTO identity.local_credential (user_account_id, password_hash) VALUES ($1, $2)`, [
      userId,
      passwordHash,
    ]);
    await client.query(
      `INSERT INTO identity.user_role (id, user_account_id, role_id, granted_by) VALUES ($1, $2, $3, $2)`,
      [uuidv7(), userId, roleRow.rows[0]!.id],
    );
    if (account.studentRef !== undefined) {
      await client.query(
        `INSERT INTO identity.student_profile (user_account_id, student_ref, programme) VALUES ($1, $2, $3)`,
        [userId, account.studentRef, 'BSc in CSE'],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.CORE_DATABASE_URL;
  if (connectionString === undefined) {
    throw new Error('CORE_DATABASE_URL is not set — run this after `pnpm db:setup`/`pnpm migrate`.');
  }

  const client = new Client({ connectionString });
  await client.connect();
  const hasher = new PasswordHasher();
  try {
    for (const account of ACCOUNTS) {
      await seedAccount(client, hasher, account);
    }
  } finally {
    await client.end();
  }
}

await main();
