import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { E2E_ADMIN, E2E_STUDENT, signIn } from './support/auth.js';

/**
 * A-02/A-03/A-04 (FRONTEND §10.6) — the Administrator account console this
 * project's Gate G1 names explicitly: "an account can be created by an
 * Administrator... and it can be suspended/reactivated/have a role granted
 * by that Administrator." Each created account uses a run-unique email so
 * repeated local runs (outside CI's always-fresh database) never collide
 * on `EMAIL_ALREADY_REGISTERED`.
 */
test.describe('A-02 · Accounts list', () => {
  test('redirects a Student (non-ADM) session to /no-access', async ({ page }) => {
    await signIn(page, E2E_STUDENT.email, E2E_STUDENT.password);
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/no-access$/);
  });

  test('renders the list for an Administrator with zero accessibility violations', async ({ page }) => {
    await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Email' })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('A-02/A-03/A-04 · Account lifecycle', () => {
  test('create, view, grant a role, suspend and reactivate an account', async ({ page }) => {
    const email = `e2e-lifecycle-${Date.now()}@diu.edu.bd`;

    await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');

    // A-02: create account.
    await page.getByRole('button', { name: 'Create account' }).click();
    const createDialog = page.getByRole('dialog', { name: 'Create account' });
    await createDialog.getByRole('textbox', { name: 'DIU institutional email' }).fill(email);
    await createDialog.getByRole('textbox', { name: 'Full name' }).fill('E2E Lifecycle Test');
    await createDialog.getByRole('checkbox', { name: /Medical Center Staff/ }).check();
    await createDialog.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.waitForLoadState('networkidle');

    // A-03: lands on the new account's detail page.
    await expect(page).toHaveURL(/\/admin\/users\/[0-9a-f-]+$/);
    await expect(page.getByText(email)).toBeVisible();

    const detailAxe = await new AxeBuilder({ page }).analyze();
    expect(detailAxe.violations).toEqual([]);

    // A-04: grant an additional role.
    await page.getByRole('button', { name: 'Manage roles' }).click();
    await page.getByRole('textbox', { name: 'Reason for this change' }).fill('E2E: granting Store Operator');
    await page.locator('#role-toggle-STO').click();
    await expect(page.locator('#role-toggle-STO')).toBeChecked();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Medical Center Staff, Store Operator')).toBeVisible();

    // Lifecycle: suspend, then reactivate.
    await page.getByRole('button', { name: 'Suspend' }).click();
    const suspendDialog = page.getByRole('alertdialog', { name: 'Suspend this account?' });
    await suspendDialog.getByRole('textbox', { name: 'Reason' }).fill('E2E: testing suspend flow');
    await suspendDialog.getByRole('button', { name: 'Suspend' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Suspended')).toBeVisible();

    await page.getByRole('button', { name: 'Activate', exact: true }).click();
    const activateDialog = page.getByRole('alertdialog', { name: 'Activate this account?' });
    await activateDialog.getByRole('textbox', { name: 'Reason' }).fill('E2E: testing activate flow');
    await activateDialog.getByRole('button', { name: 'Activate' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
  });
});
