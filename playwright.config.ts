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
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
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
