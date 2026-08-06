import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import type { Database } from './schema.js';

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
