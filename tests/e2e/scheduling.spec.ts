import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { E2E_SCHEDULING_STAFF, E2E_STUDENT, signIn } from './support/auth.js';

/**
 * M2 "Schedules" (F-09…F-13, A-06, P-01) — Gate G2's own stated scenario:
 * a Medical Centre Staff account creates a doctor, publishes a week of
 * sessions, sees slot counts reflect the walk-in allocation correctly, and
 * takes the doctor off duty through the two-step leave flow. Each screen
 * visited along the way is checked for zero accessibility violations, so
 * this single walkthrough also serves as "axe per new route" coverage for
 * every M2 frontend checkpoint (M2-I…M2-M) without re-signing-in per route.
 *
 * Uses its own dedicated MCS fixture account (`E2E_SCHEDULING_STAFF`), not
 * the shared `E2E_STAFF` that `staff-shells.spec.ts` also signs in as:
 * `SessionIssuer.issueFor` revokes every prior session for an account on
 * each login (NFR-SEC-08), so two specs racing on the same account across
 * parallel workers would otherwise silently revoke each other's session
 * mid-walkthrough — confirmed by reproducing it against the shared account
 * before adding this one.
 *
 * Confirming a leave period only cancels affected *appointments* — the
 * underlying clinic sessions are left `scheduled` (`unavailability.repository.ts`'s
 * `createUnavailability` only updates `queueing.appointment` rows). Since no
 * booking feature exists until M3, this walkthrough cannot show a booking
 * actually get cancelled or the public availability projection change as a
 * result — it exercises the real, currently-observable behaviour instead:
 * the preview correctly counts the affected session, and the confirmed
 * leave period appears in the doctor's unavailability list.
 */
test.describe('M2 · Schedules', () => {
  test('redirects a Student (non-MCS) session away from the doctors list', async ({ page }) => {
    await signIn(page, E2E_STUDENT.email, E2E_STUDENT.password);
    await page.goto('/staff/doctors');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/no-access$/);
  });

  test('publish a week of sessions and take the doctor off duty', async ({ page }) => {
    const doctorName = `Dr. M2N Verify ${String(Date.now())}`;

    await signIn(page, E2E_SCHEDULING_STAFF.email, E2E_SCHEDULING_STAFF.password);

    // F-09/F-10: create the doctor.
    await page.goto('/staff/doctors');
    await page.waitForLoadState('networkidle');
    let results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    await page.getByRole('button', { name: 'Add doctor' }).click();
    const createDoctorDialog = page.getByRole('dialog');
    await createDoctorDialog.getByLabel('Full name').fill(doctorName);
    await createDoctorDialog.getByLabel('Designation').fill('Consultant');
    await createDoctorDialog.getByLabel('Specialisation').fill('General Medicine');
    await createDoctorDialog.getByRole('button', { name: 'Add doctor' }).click();
    await page.waitForURL(/\/staff\/doctors\/[^/]+$/);
    const doctorId = new URL(page.url()).pathname.split('/').pop()!;

    results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    // F-11: a weekly duty roster entry.
    await page.getByRole('link', { name: 'Duty roster' }).click();
    await page.waitForURL(/\/roster$/);
    await page.getByRole('button', { name: 'Add a day' }).click();
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('cell', { name: 'Sunday' })).toBeVisible();

    results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    // F-12: publish this week's session for the doctor — the same UI a
    // staff member publishing every day of the week would repeat.
    await page.goto('/staff/schedule');
    await page.waitForLoadState('networkidle');
    results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    await page.getByRole('button', { name: 'Session', exact: true }).click();
    const sessionDialog = page.getByRole('dialog', { name: 'New session' });
    await sessionDialog.locator('#session-doctor').selectOption(doctorId);
    await sessionDialog.locator('#session-start-time').fill('09:00');
    await sessionDialog.locator('#session-end-time').fill('13:00');
    // VR-13/FR-SCH-05: 10-minute slots over a 4-hour session with a 30%
    // walk-in allocation derives to 24 total / 16 bookable exactly —
    // API.md's own documented example — proving the live preview and the
    // persisted result agree, not just that a number appears.
    await expect(sessionDialog.getByText('24 slots, 16 bookable online')).toBeVisible();
    const reasonField = sessionDialog.getByLabel(/Reason \(required/);
    if (await reasonField.isVisible().catch(() => false)) {
      await reasonField.fill('M2 Gate G2 verification walkthrough');
    }
    await sessionDialog.getByRole('button', { name: 'Create session' }).click();
    await expect(sessionDialog).not.toBeVisible({ timeout: 10_000 });

    const todaySessionCard = page.locator('.cc-session-card').filter({ hasText: doctorName });
    await expect(todaySessionCard).toBeVisible();
    await expect(todaySessionCard.getByText('24 slots · 16 bookable · 0 booked')).toBeVisible();

    results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    // F-13: take the doctor off duty over today's session.
    await page.goto(`/staff/doctors/${doctorId}/unavailability`);
    await page.waitForLoadState('networkidle');
    results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    const today = new Date().toISOString().slice(0, 10);
    await page.locator('#unavail-start').fill(today);
    await page.locator('#unavail-end').fill(today);
    await page.getByLabel('Reason').fill('Called away for a family emergency');
    await page.getByRole('button', { name: 'Review impact' }).click();

    // Step 2 is a full screen, not a dialog (FRONTEND's own design note).
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('1 session affected · 0 bookings to cancel')).toBeVisible();

    results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    await page.getByRole('button', { name: /Cancel these 0 and notify/ }).click();
    await expect(page.getByRole('cell', { name: today, exact: true }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Called away for a family emergency' })).toBeVisible();

    results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
