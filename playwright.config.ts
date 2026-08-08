import { defineConfig, devices } from '@playwright/test';

/**
 * E2E + per-route accessibility gate (ROADMAP M0.5-T13/T14, FRONTEND §13.8).
 *
 * Both services genuinely run for this suite — this is deliberately not a
 * component test with a mocked API. `webServer` starts core-api and the web
 * app the same way a developer would (`pnpm --filter … dev`), against
 * whatever database `.env` points at; CI migrates a fresh `postgres:16`
 * service container before this step runs, so what E2E sees there is a
 * schema with no seeded announcements — the assertions in `tests/e2e/`
 * are written for that real, empty-but-valid state rather than assuming
 * fixture data that was never inserted.
 *
 * The one exception is identity: `pnpm test:e2e` (not this config, so it
 * runs whether Playwright is invoked directly or through that script) first
 * runs `pnpm seed:e2e`, which inserts exactly the Administrator and Student
 * accounts `tests/e2e/auth-flows.spec.ts` and `tests/e2e/admin.spec.ts` sign
 * in as — see `apps/core-api/tests/support/seed-e2e-fixtures.ts` for why
 * that bootstrap step can't go through the API itself.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  // Argon2id (NFR-SEC-02) is deliberately CPU/memory-hard, and Vite's dev
  // server (deliberately used here, not a production build — see above)
  // compiles each route's chunk on first request. Both costs are real and
  // per-request, so maxing out workers to the machine's core count — which
  // also has to run every browser instance plus the dev server itself —
  // measurably increases flake rate rather than just speeding things up.
  // Capped rather than left to the default so this suite is exactly as
  // reliable on a laptop as on a CI runner.
  workers: 2,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @campuscare/core-api dev',
      url: 'http://localhost:3001/api/v1/public/announcements',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @campuscare/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
