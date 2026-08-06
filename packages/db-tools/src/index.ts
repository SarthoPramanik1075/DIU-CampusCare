/**
 * `@campuscare/db-tools` — database provisioning and migration.
 *
 * Exists as a package rather than a loose script because both services'
 * integration tests build their scratch databases by calling `migrate()`
 * directly. A test fixture that recreated the schema by another route would
 * drift from what production runs, and the drift would only surface in
 * production.
 */
export { migrate, listMigrations, type TargetName } from './migrate.js';
