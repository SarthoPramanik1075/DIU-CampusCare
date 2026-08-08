import type { Page } from '@playwright/test';

// Credentials for the two fixture accounts `pnpm seed:e2e` inserts before
// this suite runs. Re-exported from the same constants module the seeding
// script itself reads, rather than duplicated, so a password change in one
// place can't silently drift from the other.
export { E2E_ADMIN, E2E_OPERATOR, E2E_SCHEDULING_STAFF, E2E_STAFF, E2E_STUDENT } from '../../../apps/core-api/tests/support/e2e-fixture-accounts.js';

/**
 * Argon2id verification (NFR-SEC-02) is deliberately CPU/memory-hard, so
 * several parallel workers signing in at once against one dev-mode server
 * can genuinely take longer than a network-idle heuristic assumes — this
 * waits for the actual outcome (`SignInPage` navigates away from
 * `/sign-in` on success) rather than a fixed idle window, so a slow-but-
 * real login is not mistaken for a silent failure.
 */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 20_000 });
  await page.waitForLoadState('networkidle');
}
