/**
 * Environment checks UAT
 *
 * Covers:
 *   GO_LIVE_CHECKLIST: Production banner is NOT visible on firstwhistlesports.com
 *   GO_LIVE_CHECKLIST: Staging banner IS visible on staging URL
 *
 * The environment banner is rendered in MainLayout:
 *
 *   {!buildInfo.isProduction && (
 *     <div className="bg-amber-50 ...">
 *       <span className="...">staging</span>  ← or "development" / "pr-preview"
 *     </div>
 *   )}
 *
 * These tests authenticate first (the banner is inside the protected shell)
 * and then look for the amber banner element.
 */

import { test, expect, creds } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Local / staging — banner SHOULD be present
// ---------------------------------------------------------------------------

test('staging/development environment banner IS visible when not in production', async ({
  authPage,
  page,
}) => {
  // Skip this test when running against the production URL
  const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
  if (baseURL.includes('firstwhistlesports.com') && !baseURL.includes('staging')) {
    test.skip(true, 'Running against production — environment banner should be absent');
    return;
  }

  const { email, password } = creds.admin();
  await authPage.loginAndWaitForApp(email, password);

  // The banner has a distinctive amber background and contains the env label
  const banner = page.locator('[class*="bg-amber-50"]').filter({
    has: page.locator('span'),
  });

  await expect(banner).toBeVisible({ timeout: 10_000 });

  // The env label must be one of the non-production values
  const bannerText = await banner.textContent();
  expect(bannerText).toMatch(/staging|development|preview/i);
});

// ---------------------------------------------------------------------------
// Production — banner MUST NOT appear (separate .prod.spec.ts run)
// ---------------------------------------------------------------------------

// This file is NOT matched by the production project (which only matches *.prod.spec.ts).
// The production-specific version lives in environment.prod.spec.ts below.

// ---------------------------------------------------------------------------
// Legal pages are publicly accessible (no login required)
// ---------------------------------------------------------------------------

test('Privacy Policy page loads without authentication', async ({ page }) => {
  await page.goto('/legal/privacy-policy');

  // Should not redirect to login
  await expect(page).not.toHaveURL(/\/login/);

  // Should render some content
  await expect(page.locator('main, [role="main"], body')).toBeVisible();
});

test('Terms of Service page loads without authentication', async ({ page }) => {
  await page.goto('/legal/terms-of-service');
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('main, [role="main"], body')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Core authenticated pages — smoke test that they render without crash
// ---------------------------------------------------------------------------

test('admin can navigate to /calendar without error', async ({ authPage, page }) => {
  const { email, password } = creds.admin();
  await authPage.loginAndWaitForApp(email, password);
  await page.goto('/calendar');
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
  await expect(page).not.toHaveURL(/\/login/);
});

test('admin can navigate to /leagues without error', async ({ authPage, page }) => {
  const { email, password } = creds.admin();
  await authPage.loginAndWaitForApp(email, password);
  await page.goto('/leagues');
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
});

test('admin can navigate to /venues without error', async ({ authPage, page }) => {
  const { email, password } = creds.admin();
  await authPage.loginAndWaitForApp(email, password);
  await page.goto('/venues');
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
});

test('admin can navigate to /profile without error', async ({ authPage, page }) => {
  const { email, password } = creds.admin();
  await authPage.loginAndWaitForApp(email, password);
  await page.goto('/profile');
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
});

test('admin can navigate to /settings without error', async ({ authPage, page }) => {
  const { email, password } = creds.admin();
  await authPage.loginAndWaitForApp(email, password);
  await page.goto('/settings');
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// 404 / catch-all — unknown routes redirect to /
// ---------------------------------------------------------------------------

test('unknown route redirects to / (catch-all)', async ({ authPage, page }) => {
  const { email, password } = creds.admin();
  await authPage.loginAndWaitForApp(email, password);

  await page.goto('/this-route-does-not-exist');

  // Router has: { path: '*', element: <Navigate to="/" replace /> }
  await expect(page).toHaveURL('/', { timeout: 10_000 });
});
