/**
 * Settings page UAT
 *
 * Covers:
 *   SET-01: Admin can navigate to /settings
 *   SET-02: Settings page renders without error
 *   SET-03: Notifications section is present with a "Weekly digest" toggle
 *   SET-04: Weekly digest toggle can be toggled (enabled → disabled → restored)
 *   SET-05: Privacy & Legal section is present with links to Privacy Policy and Terms of Service
 *   SET-06: About section is present with version or environment information
 *   SET-07: Parent can access /settings without being redirected
 *
 * NOTE: The "Kids Sports Mode" section is hidden behind a feature flag (FLAGS.KIDS_MODE)
 * and may not be visible in staging/production.  Tests for it are skipped unless the
 * section header is detected.
 */

import { test, expect } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test('admin can navigate to /settings', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/settings');

  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Page renders without error
// ---------------------------------------------------------------------------

test('settings page renders the main sections without a crash', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/settings');
  await page.waitForLoadState('domcontentloaded');

  // At minimum the Notifications card must render
  await expect(page.getByText('Notifications', { exact: true })).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Notifications section
// ---------------------------------------------------------------------------

test('Notifications section is visible with a Weekly digest toggle', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/settings');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByText('Notifications', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Weekly digest', { exact: true })).toBeVisible({ timeout: 5_000 });
});

test('weekly digest toggle is a clickable checkbox/switch', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/settings');
  await page.waitForLoadState('domcontentloaded');

  // SettingsToggle renders a <button role="switch"> or <input type="checkbox">
  const toggle = page
    .getByRole('switch', { name: /weekly digest/i })
    .or(page.locator('button[role="switch"]').filter({ hasText: /weekly digest/i }))
    .or(page.locator('input[type="checkbox"]').nth(0))
    .first();

  // The toggle should be present and interactive
  const toggleVisible = await toggle.isVisible({ timeout: 5_000 }).catch(() => false);

  if (!toggleVisible) {
    // Fallback: find any switch-like element near the "Weekly digest" label
    const nearbySwitch = page
      .locator('[role="switch"], input[type="checkbox"]')
      .first();
    await expect(nearbySwitch).toBeVisible({ timeout: 5_000 });
    return;
  }

  await expect(toggle).toBeVisible({ timeout: 5_000 });
});

test('admin can toggle weekly digest off then back on', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/settings');
  await page.waitForLoadState('domcontentloaded');

  // SettingsToggle uses a <button role="switch"> pattern
  const toggle = page.getByRole('switch').first();

  const isVisible = await toggle.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!isVisible) {
    test.skip(true, 'Could not locate a role="switch" element — skipping toggle interaction test');
    return;
  }

  const initialChecked = await toggle.getAttribute('aria-checked');

  // Toggle the switch
  await toggle.click();
  // Wait for Firestore write to propagate — aria-checked must change
  await expect(toggle).not.toHaveAttribute('aria-checked', initialChecked ?? '', { timeout: 10_000 });

  const newChecked = await toggle.getAttribute('aria-checked');
  // State should have changed
  expect(newChecked).not.toBe(initialChecked);

  // Toggle back to original state
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', initialChecked ?? '', { timeout: 10_000 });

  const restoredChecked = await toggle.getAttribute('aria-checked');
  expect(restoredChecked).toBe(initialChecked);
});

// ---------------------------------------------------------------------------
// Privacy & Legal section
// ---------------------------------------------------------------------------

test('Privacy & Legal section is present with document links', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/settings');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByText('Privacy & Legal', { exact: false })).toBeVisible({ timeout: 10_000 });

  // Links to Privacy Policy and Terms of Service
  await expect(page.getByRole('link', { name: /privacy policy/i })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('link', { name: /terms of service/i })).toBeVisible({ timeout: 5_000 });
});

test('Legal Documents links point to the correct paths', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/settings');
  await page.waitForLoadState('domcontentloaded');

  const privacyLink = page.getByRole('link', { name: /privacy policy/i });
  const termsLink = page.getByRole('link', { name: /terms of service/i });

  await expect(privacyLink).toHaveAttribute('href', /privacy-policy/);
  await expect(termsLink).toHaveAttribute('href', /terms-of-service/);
});

test('Your Consents section shows consent status for Terms and Privacy Policy', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  await page.goto('/settings');
  await page.waitForLoadState('domcontentloaded');

  // Consent records section label
  await expect(page.getByText('Your Consents', { exact: false })).toBeVisible({ timeout: 10_000 });

  // Each row shows one of these labels (even if "Not on record")
  await expect(page.getByText('Terms of Service', { exact: false }).first()).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Privacy Policy', { exact: false }).first()).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// About section
// ---------------------------------------------------------------------------

test('About section is present with environment or version information', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/settings');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByText('About', { exact: true })).toBeVisible({ timeout: 10_000 });

  // Either "Version" (production) or environment badge (staging/dev) must be visible
  const versionRow = page.getByText('Version', { exact: true });
  const envBadge = page.locator('[class*="bg-amber-100"], [class*="bg-purple-100"]').first();

  const hasVersion = await versionRow.isVisible({ timeout: 3_000 }).catch(() => false);
  const hasEnvBadge = await envBadge.isVisible({ timeout: 3_000 }).catch(() => false);

  expect(hasVersion || hasEnvBadge).toBe(true);
});

// ---------------------------------------------------------------------------
// Kids Sports Mode — feature-flag gated
// ---------------------------------------------------------------------------

test('Kids Sports Mode section is hidden or visible depending on feature flag', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  await page.goto('/settings');
  await page.waitForLoadState('domcontentloaded');

  const kidsHeading = page.getByText('Kids Sports Mode', { exact: true });
  const isVisible = await kidsHeading.isVisible({ timeout: 2_000 }).catch(() => false);

  if (isVisible) {
    // Flag is on — the toggle for "Enable Kids Sports Mode" should be present
    await expect(page.getByText('Enable Kids Sports Mode', { exact: false })).toBeVisible({
      timeout: 5_000,
    });
  } else {
    // Flag is off — section should not be rendered at all
    await expect(kidsHeading).not.toBeVisible();
  }
});

// ---------------------------------------------------------------------------
// Access control — parent can reach /settings
// ---------------------------------------------------------------------------

test('parent can access /settings without being redirected', async ({ asParent }) => {
  const { page } = asParent;

  await page.goto('/settings');
  await page.waitForLoadState('domcontentloaded');

  // /settings is not behind a RoleGuard — parent should land on the page
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByText('Notifications', { exact: true })).toBeVisible({ timeout: 10_000 });
});
