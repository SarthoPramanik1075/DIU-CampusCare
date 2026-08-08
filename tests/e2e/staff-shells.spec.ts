import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { E2E_OPERATOR, E2E_STAFF, signIn } from './support/auth.js';

/**
 * M1-M's `/staff` (MCS) and `/operator` (STO) navigation shells — chrome
 * and a role guard only, since every real feature screen behind them is
 * M2+ scope (see `StaffShell`'s own doc comment).
 */
test.describe('/staff · Medical centre shell', () => {
  test('redirects an unauthenticated visitor to sign-in', async ({ page }) => {
    await page.goto('/staff');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/sign-in\?redirectTo=%2Fstaff/);
  });

  test('an Operator (STO) session is bounced to /no-access', async ({ page }) => {
    await signIn(page, E2E_OPERATOR.email, E2E_OPERATOR.password);
    await page.goto('/staff');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/no-access$/);
  });

  test('renders for MCS with zero accessibility violations', async ({ page }) => {
    await signIn(page, E2E_STAFF.email, E2E_STAFF.password);
    await page.goto('/staff');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Medical centre' })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('/operator · Medicine store shell', () => {
  test('a Staff (MCS) session is bounced to /no-access', async ({ page }) => {
    await signIn(page, E2E_STAFF.email, E2E_STAFF.password);
    await page.goto('/operator');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/no-access$/);
  });

  test('renders for STO with zero accessibility violations', async ({ page }) => {
    await signIn(page, E2E_OPERATOR.email, E2E_OPERATOR.password);
    await page.goto('/operator');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Medicine store' })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
