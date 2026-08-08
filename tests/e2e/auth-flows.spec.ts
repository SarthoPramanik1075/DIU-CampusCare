import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { E2E_STUDENT, signIn } from './support/auth.js';

/**
 * P-06 sign-in and the S-01 student dashboard it leads to. Signs in as the
 * `e2e-student` fixture account `pnpm seed:e2e` inserts — see
 * `apps/core-api/tests/support/seed-e2e-fixtures.ts` for why a real student
 * account can't be created any other way in an environment with no SSO
 * identity provider configured (M1-C).
 */
test.describe('P-06 · Sign-in', () => {
  test('renders the form with no console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await page.goto('/sign-in');
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test('has zero automated accessibility violations — FRONTEND §13.8', async ({ page }) => {
    await page.goto('/sign-in');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('wrong password shows a generic message, never confirming the account exists', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByRole('textbox', { name: 'Email' }).fill(E2E_STUDENT.email);
    await page.getByRole('textbox', { name: 'Password' }).fill('definitely wrong');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText(/don't match/i)).toBeVisible();
  });

  test('signs in and reaches the student dashboard', async ({ page }) => {
    await signIn(page, E2E_STUDENT.email, E2E_STUDENT.password);
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/student');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/student$/);
    await expect(page.getByText('E2E Student')).toBeVisible();
  });
});

test.describe('S-01 · Student dashboard', () => {
  test('redirects an unauthenticated visitor to sign-in with a way back', async ({ page }) => {
    await page.goto('/student');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/sign-in\?redirectTo=%2Fstudent/);
  });

  test('renders the real dashboard once signed in, with zero accessibility violations', async ({ page }) => {
    await signIn(page, E2E_STUDENT.email, E2E_STUDENT.password);
    await page.goto('/student');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('No upcoming appointments.')).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
