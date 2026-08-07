import 'dotenv/config';
// Side-effect import: registers the `date`-column type parser fix
// (`client.ts`) before any integration test's queries run. Every
// integration test imports this module, so this is the one place that
// guarantees it — each test otherwise builds its own `Pool` directly
// rather than going through `createDatabase()`.
import '../../src/infrastructure/database/client.js';

import { randomBytes } from 'node:crypto';

import { migrate, type TargetName } from '@campuscare/db-tools';
import { Client } from 'pg';


/**
 * A disposable database, built from the real migrations.
 *
 * Integration tests run against **actual PostgreSQL**, not an emulator,
 * because the invariants being tested are PostgreSQL features: a GiST
 * `EXCLUDE` constraint, partial unique indexes, a generated column and
 * plpgsql triggers. An in-memory substitute would pass tests the real engine
 * would fail, which is worse than having no test.
 *
 * Docker is not available in this environment, so rather than Testcontainers
 * each suite provisions a uniquely-named scratch database on the local
 * server and drops it afterwards. CI does the same against a `postgres:16`
 * service container.
 *
 * The scratch database is built by calling `migrate()` — the same function
 * `pnpm migrate` uses. A separate fixture schema would drift from production
 * silently, and the drift would only surface in production.
 */
export interface ScratchDatabase {
  readonly name: string;
  readonly connectionString: string;
  readonly client: Client;
  drop(): Promise<void>;
}

function adminConnectionString(): string {
  return (
    process.env.ADMIN_DATABASE_URL ?? 'postgresql://postgres@localhost/postgres?host=/tmp'
  );
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

async function runAsAdmin(sql: string, database = 'postgres'): Promise<void> {
  const client = new Client({
    connectionString: withDatabase(adminConnectionString(), database),
  });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/**
 * Creates and migrates a scratch database.
 *
 * Connects as the administrative role rather than the application role: these
 * tests assert what the *schema* permits, and running them under a role whose
 * grants are themselves under test would confuse two separate questions. The
 * grants are asserted directly in `grants.test.ts`.
 */
export async function createScratchDatabase(target: TargetName): Promise<ScratchDatabase> {
  const name = `campuscare_test_${target}_${randomBytes(6).toString('hex')}`;

  await runAsAdmin(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8'`);

  const connectionString = withDatabase(adminConnectionString(), name);
  await migrate(target, connectionString);

  const client = new Client({ connectionString });
  await client.connect();

  return {
    name,
    connectionString,
    client,
    async drop(): Promise<void> {
      await client.end();
      await runAsAdmin(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
      );
      await runAsAdmin(`DROP DATABASE IF EXISTS ${name}`);
    },
  };
}

/** The PostgreSQL SQLSTATE of a rejected statement, for precise assertions. */
export function sqlState(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code?: unknown };
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * Asserts a statement is rejected, and returns the SQLSTATE.
 *
 * Deliberately fails when the statement *succeeds* — a constraint test that
 * silently passes because nothing was enforced is the failure mode these
 * tests exist to catch.
 */
export async function expectRejection(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (error) {
    return sqlState(error);
  }
  throw new Error('Expected the statement to be rejected, but it succeeded.');
}
