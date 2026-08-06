/**
 * Local database provisioning.
 *
 * Creates the two databases and the five roles of DATABASE.md §11, then
 * writes generated local-dev passwords into `.env`.
 *
 * This is separate from `migrate.ts` because CREATE ROLE and CREATE DATABASE
 * are cluster-scoped: neither can run inside a transaction, and the CONNECT
 * grant on the counseling database cannot be issued from a session connected
 * to the core one.
 *
 * ## The boundary this file establishes
 *
 * `campuscare_core_app` is granted CONNECT on `campuscare_core` and is
 * deliberately **absent** from the grant on `campuscare_counseling`. That
 * absence is ADR-001. It is asserted on every build by the architecture
 * suite; if this file is ever "simplified" into a single shared role, that
 * test fails and the build stops.
 *
 * Usage:
 *   pnpm db:setup             provision
 *   pnpm db:teardown          drop both databases and the roles
 */
import 'dotenv/config';

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { Client } from 'pg';

const ROOT = resolve(import.meta.dirname, '../../..');
const ENV_PATH = resolve(ROOT, '.env');

const CORE_DB = 'campuscare_core';
const COUNSELING_DB = 'campuscare_counseling';

interface RoleSpec {
  readonly name: string;
  readonly envKey: string;
  /** Databases this role may CONNECT to. Emptiness here is a security property. */
  readonly connectTo: readonly string[];
}

const ROLES: readonly RoleSpec[] = [
  { name: 'campuscare_core_migrator', envKey: 'CORE_MIGRATOR_PW', connectTo: [CORE_DB] },
  { name: 'campuscare_core_app', envKey: 'CORE_APP_PW', connectTo: [CORE_DB] },
  {
    name: 'campuscare_counseling_migrator',
    envKey: 'CNS_MIGRATOR_PW',
    connectTo: [COUNSELING_DB],
  },
  {
    name: 'campuscare_counseling_app',
    envKey: 'CNS_APP_PW',
    // Note the single entry. campuscare_core_app is not in this list and
    // campuscare_counseling_app is not in the core list. ADR-001.
    connectTo: [COUNSELING_DB],
  },
  { name: 'campuscare_reporting', envKey: 'REPORTING_PW', connectTo: [CORE_DB] },
];

/**
 * Each database is owned by its own migrator. Ownership is what grants the
 * migrator rights on the `public` schema in PostgreSQL 15+; the application
 * roles own nothing and hold only the privileges granted in 005/003.
 */
const DATABASE_OWNERS: readonly (readonly [database: string, owner: string])[] = [
  [CORE_DB, 'campuscare_core_migrator'],
  [COUNSELING_DB, 'campuscare_counseling_migrator'],
];

function adminUrl(): string {
  return (
    process.env.ADMIN_DATABASE_URL ?? 'postgresql://postgres@localhost/postgres?host=/tmp'
  );
}

/**
 * Host:port for the application connection strings.
 *
 * The admin connection may go over a unix socket (trust auth on a local
 * install), but the application roles authenticate with a password over TCP,
 * so their URLs always need a real host:port.
 */
function appHostPort(): string {
  const host = new URL(adminUrl()).host;
  return host === '' ? 'localhost:5432' : host;
}

async function withAdmin<T>(database: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const url = new URL(adminUrl());
  url.pathname = `/${database}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** URL-safe password. Local development only; production credentials come from DIU IT. */
function generatePassword(): string {
  return randomBytes(24).toString('base64url');
}

async function exists(c: Client, sql: string, param: string): Promise<boolean> {
  const { rowCount } = await c.query(sql, [param]);
  return (rowCount ?? 0) > 0;
}

async function provision(): Promise<void> {
  const passwords = new Map<string, string>();

  await withAdmin('postgres', async (c) => {
    for (const role of ROLES) {
      const password = generatePassword();
      passwords.set(role.envKey, password);

      const present = await exists(c, 'SELECT 1 FROM pg_roles WHERE rolname = $1', role.name);
      if (present) {
        await c.query(`ALTER ROLE ${role.name} LOGIN PASSWORD '${password}'`);
        console.log(`  role ${role.name} — password rotated`);
      } else {
        await c.query(`CREATE ROLE ${role.name} LOGIN PASSWORD '${password}'`);
        console.log(`  role ${role.name} — created`);
      }
    }

    for (const [database, owner] of DATABASE_OWNERS) {
      const present = await exists(c, 'SELECT 1 FROM pg_database WHERE datname = $1', database);
      if (present) {
        console.log(`  database ${database} — already present`);
      } else {
        await c.query(
          `CREATE DATABASE ${database} ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0`,
        );
        console.log(`  database ${database} — created`);
      }

      // The migrator owns its database, and therefore the `public` schema
      // via pg_database_owner. PostgreSQL 15 removed the implicit CREATE for
      // PUBLIC on `public`, so without this the migration runner cannot even
      // create its own tracking table.
      //
      // The application roles deliberately do NOT own anything: they receive
      // only the privileges granted explicitly in the 005/003 migrations, so
      // a compromised application role cannot alter the schema it runs on.
      await c.query(`ALTER DATABASE ${database} OWNER TO ${owner}`);
      console.log(`  database ${database} — owner set to ${owner}`);
    }
  });

  // CONNECT grants must be issued while connected to the target database.
  for (const database of [CORE_DB, COUNSELING_DB]) {
    await withAdmin(database, async (c) => {
      await c.query(`REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC`);
      const permitted = ROLES.filter((r) => r.connectTo.includes(database));
      for (const role of permitted) {
        await c.query(`GRANT CONNECT ON DATABASE ${database} TO ${role.name}`);
      }
      const names = permitted.map((r) => r.name).join(', ');
      console.log(`  ${database} — CONNECT granted to: ${names}`);

      const excluded = ROLES.filter((r) => !r.connectTo.includes(database)).map((r) => r.name);
      console.log(`  ${database} — CONNECT withheld from: ${excluded.join(', ')}`);
    });
  }

  writeEnv(passwords);
}

/**
 * Writes generated passwords into `.env`, preserving any keys already there.
 * `.env` is git-ignored; nothing here belongs in version control.
 */
function writeEnv(passwords: ReadonlyMap<string, string>): void {
  const template = readFileSync(resolve(ROOT, '.env.example'), 'utf8');
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : template;

  const host = appHostPort();
  const urls: Record<string, string> = {
    CORE_DATABASE_URL: `postgresql://campuscare_core_app:${passwords.get('CORE_APP_PW') ?? ''}@${host}/${CORE_DB}`,
    COUNSELING_DATABASE_URL: `postgresql://campuscare_counseling_app:${passwords.get('CNS_APP_PW') ?? ''}@${host}/${COUNSELING_DB}`,
    CORE_MIGRATOR_DATABASE_URL: `postgresql://campuscare_core_migrator:${passwords.get('CORE_MIGRATOR_PW') ?? ''}@${host}/${CORE_DB}`,
    COUNSELING_MIGRATOR_DATABASE_URL: `postgresql://campuscare_counseling_migrator:${passwords.get('CNS_MIGRATOR_PW') ?? ''}@${host}/${COUNSELING_DB}`,
  };

  // Secrets that must be present but are not database credentials.
  const secrets: Record<string, string> = {
    SESSION_SECRET: randomBytes(32).toString('base64url'),
    INTERNAL_SERVICE_TOKEN: randomBytes(32).toString('base64url'),
  };

  let output = existing;
  for (const [key, value] of Object.entries({ ...urls, ...secrets })) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    output = pattern.test(output) ? output.replace(pattern, line) : `${output.trimEnd()}\n${line}\n`;
  }

  writeFileSync(ENV_PATH, output, { mode: 0o600 });
  console.log(`\n  wrote ${ENV_PATH} (mode 0600, git-ignored)`);
}

async function teardown(): Promise<void> {
  await withAdmin('postgres', async (c) => {
    for (const database of [CORE_DB, COUNSELING_DB]) {
      await c.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [database],
      );
      await c.query(`DROP DATABASE IF EXISTS ${database}`);
      console.log(`  database ${database} — dropped`);
    }
    for (const role of ROLES) {
      await c.query(`DROP ROLE IF EXISTS ${role.name}`);
      console.log(`  role ${role.name} — dropped`);
    }
  });
}

const teardownRequested = process.argv.includes('--teardown');
console.log(teardownRequested ? 'Tearing down CampusCare databases…' : 'Provisioning CampusCare databases…');

try {
  await (teardownRequested ? teardown() : provision());
  console.log('\nDone.');
} catch (error) {
  console.error('\nFailed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
