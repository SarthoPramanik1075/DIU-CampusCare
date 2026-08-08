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
/**
 * A second MCS account, distinct from `E2E_STAFF`. `SessionIssuer.issueFor`
 * revokes every prior session for an account on each new login (NFR-SEC-08 —
 * "regenerated on login" means the old one stops working, not just that a
 * new one exists), so two specs signing in as the same account in parallel
 * workers will race: whichever logs in second silently revokes the other's
 * in-progress session. `staff-shells.spec.ts` already owns `E2E_STAFF`;
 * `scheduling.spec.ts`'s long multi-step walkthrough needs its own account
 * rather than a scheduling delay to dodge that race.
 */
export const E2E_SCHEDULING_STAFF = { email: 'e2e-scheduling-staff@diu.edu.bd', password: 'E2E scheduling pass 1!' };
