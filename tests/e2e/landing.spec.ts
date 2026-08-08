import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * P-01 landing page — the M0.5 vertical slice. One route exists so far;
 * ROADMAP M0.5-T13 requires axe on every route, which this file satisfies
 * completely for the current route inventory and is meant to grow one
 * `test.describe` block per route as later checkpoints add them, rather
 * than becoming one enormous file.
 */
test.describe('P-01 · Landing', () => {
  test('renders the heading with no unexpected console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'DIU CampusCare' })).toBeVisible();

    // `useSession()` calls `GET /auth/session` on every load to detect an
    // anonymous visitor (API.md: "Authentication — Session," 401 for
    // anyone without one) — the browser logs any non-2xx fetch to the
    // console regardless of the app's own try/catch, so this one message
    // is expected on every anonymous page load, not a defect (M1-B).
    const unexpected = consoleErrors.filter((message) => !message.includes('401'));
    expect(unexpected).toEqual([]);
  });

  test('has zero automated accessibility violations — FRONTEND §13.8', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'DIU CampusCare' })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('renders at 320px with the heading above the fold — FR-UI-01', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');

    const heading = page.getByRole('heading', { name: 'DIU CampusCare' });
    await expect(heading).toBeVisible();
    const box = await heading.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(568);
  });
});
