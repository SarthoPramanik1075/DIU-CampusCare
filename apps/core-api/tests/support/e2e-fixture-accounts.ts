/**
 * Credentials for the fixture accounts `seed-e2e-fixtures.ts` inserts and
 * `tests/e2e/` signs in as. A plain constants module, deliberately separate
 * from the seeding script itself (which runs a database write at module
 * scope) — importing this file must never have a side effect.
 */
export const E2E_ADMIN = { email: 'e2e-admin@diu.edu.bd', password: 'E2E admin pass 1!' };
export const E2E_STUDENT = { email: 'e2e-student@diu.edu.bd', password: 'E2E student pass 1!' };
export const E2E_STAFF = { email: 'e2e-staff@diu.edu.bd', password: 'E2E staff pass 1!' };
export const E2E_OPERATOR = { email: 'e2e-operator@diu.edu.bd', password: 'E2E operator pass 1!' };
