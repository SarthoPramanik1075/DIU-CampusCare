import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';

import type { Database } from './schema.js';

/**
 * `node-postgres` defaults `date` (OID 1082) columns to a JS `Date` at UTC
 * midnight — for `2026-08-08`, that is `2026-08-07T18:00:00.000Z`, since
 * BST is +06:00. Reading it back with `.toISOString()` or any UTC-based
 * accessor silently yields the *previous* calendar day (EC-54/VR-91: BST
 * is the only calendar this system uses). Registered once, at module load,
 * because `pg-types`' parser table is a process-wide registry, not a
 * per-`Pool` setting — keeping the raw `'YYYY-MM-DD'` string is the correct
 * fix, not a workaround: nothing in this codebase does date arithmetic on a
 * `date` column, only string handling.
 */
types.setTypeParser(types.builtins.DATE, (value) => value);

/**
 * Creates the Kysely instance for `campuscare_core`.
 *
 * The composition root (Checkpoint D) is the only place this is called — an
 * infrastructure adapter is constructed once, there, and passed down to
 * every kernel and module component that needs it (DR-5: no module
 * constructs its own database client).
 */
export function createDatabase(connectionString: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString }),
    }),
  });
}

export type * from './schema.js';
