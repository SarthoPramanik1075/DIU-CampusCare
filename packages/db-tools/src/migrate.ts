/**
 * SQL migration runner.
 *
 * Applies `migrations/*.sql` in filename order, each inside its own
 * transaction, recording what has been applied in `public.schema_migration`.
 *
 * ## Why this and not a migration library
 *
 * `DATABASE.md` is already a complete, reviewed SQL schema that leans on
 * PostgreSQL features a schema-owning tool would either mangle or refuse:
 * a GiST `EXCLUDE` constraint (VR-19), partial unique indexes (EC-01, BR-11),
 * a generated column, plpgsql triggers and a materialized view. The approved
 * DDL must reach the database **verbatim**, so the runner's only job is to
 * apply files in order and remember which ones it applied.
 *
 * Each file is hashed. A change to an already-applied migration is refused
 * rather than silently ignored — editing applied history is how two
 * environments quietly diverge.
 *
 * Usage:
 *   pnpm migrate:core
 *   pnpm migrate:counseling
 *   tsx tools/migrate.ts core --url postgresql://…    (scratch DBs in tests)
 */
import 'dotenv/config';

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Client } from 'pg';

export type TargetName = 'core' | 'counseling';

interface Target {
  readonly migrationsDir: string;
  readonly urlEnvKey: string;
}

const ROOT = resolve(import.meta.dirname, '../../..');

const TARGETS: Readonly<Record<TargetName, Target>> = {
  core: {
    migrationsDir: resolve(ROOT, 'apps/core-api/migrations'),
    urlEnvKey: 'CORE_MIGRATOR_DATABASE_URL',
  },
  counseling: {
    migrationsDir: resolve(ROOT, 'apps/counseling-api/migrations'),
    urlEnvKey: 'COUNSELING_MIGRATOR_DATABASE_URL',
  },
};

const TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS public.schema_migration (
    filename    text PRIMARY KEY,
    checksum    text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
  )`;

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function listMigrations(dir: string): readonly string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Applies pending migrations. Idempotent: running twice applies nothing the
 * second time, which is the property the G0.5 verification checks.
 *
 * Exported so integration tests can build a scratch database with the same
 * code path production uses, rather than a parallel fixture that can drift.
 */
export async function migrate(
  target: TargetName,
  connectionString: string,
  log: (message: string) => void = () => undefined,
): Promise<{ applied: number; skipped: number }> {
  const { migrationsDir } = TARGETS[target];
  const client = new Client({ connectionString });
  await client.connect();

  let applied = 0;
  let skipped = 0;

  try {
    await client.query(TRACKING_TABLE);

    const { rows } = await client.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM public.schema_migration',
    );
    const alreadyApplied = new Map(rows.map((r) => [r.filename, r.checksum]));

    for (const filename of listMigrations(migrationsDir)) {
      const sql = readFileSync(resolve(migrationsDir, filename), 'utf8');
      const checksum = sha256(sql);
      const previous = alreadyApplied.get(filename);

      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `${filename} has changed since it was applied. Applied migrations are immutable — ` +
              `add a new migration instead of editing this one.`,
          );
        }
        skipped += 1;
        continue;
      }

      // Each migration is atomic. A failure half-way leaves nothing behind.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO public.schema_migration (filename, checksum) VALUES ($1, $2)',
          [filename, checksum],
        );
        await client.query('COMMIT');
        applied += 1;
        log(`  applied ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `${filename} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    await client.end();
  }

  return { applied, skipped };
}

function isTargetName(value: string | undefined): value is TargetName {
  return value === 'core' || value === 'counseling';
}

/** CLI entry point. Skipped when this module is imported by a test. */
async function main(): Promise<void> {
  const [, , targetArg, ...rest] = process.argv;

  if (!isTargetName(targetArg)) {
    console.error('Usage: tsx tools/migrate.ts <core|counseling> [--url <connection-string>]');
    process.exit(1);
  }

  const urlFlagIndex = rest.indexOf('--url');
  const explicitUrl = urlFlagIndex >= 0 ? rest[urlFlagIndex + 1] : undefined;
  const connectionString = explicitUrl ?? process.env[TARGETS[targetArg].urlEnvKey];

  if (connectionString === undefined || connectionString === '') {
    console.error(
      `No connection string. Set ${TARGETS[targetArg].urlEnvKey} in .env (run "pnpm db:setup" first) or pass --url.`,
    );
    process.exit(1);
  }

  console.log(`Migrating ${targetArg}…`);
  const { applied, skipped } = await migrate(targetArg, connectionString, (m) => {
    console.log(m);
  });
  console.log(`Done. ${String(applied)} applied, ${String(skipped)} already present.`);
}

if (process.argv[1]?.endsWith('migrate.ts') === true) {
  await main();
}
