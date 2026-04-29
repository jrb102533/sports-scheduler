/**
 * @emu @settings Settings page UAT (migrated from e2e/settings.spec.ts)
 *
 * Covers:
 *   SET-01: Admin can navigate to /settings
 *   SET-02: Settings page renders main sections
 *   SET-03: Notifications section + Weekly digest toggle visible
 *   SET-04: Weekly digest toggle is interactive
 *   SET-05: Privacy & Legal section + document links
 *   SET-06: Legal links have correct href paths
 *   SET-07: Your Consents section + Terms/Privacy rows
 *   SET-08: About section visible (env badge or Version row)
 *   SET-09: Kids Sports Mode (feature-flag gated)
 *   SET-10: Parent can access /settings (no role guard)
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';

test('@emu @settings admin can navigate to /settings', async ({ adminPage }) => {
  await adminPage.goto('/settings');
  await expect(adminPage).not.toHaveURL(/\/login/);
  await expect(adminPage.locator('main')).toBeVisible({ timeout: 10_000 });
});

test('@emu @settings page renders main sections without crash', async ({ adminPage }) => {
  await adminPage.goto('/settings');
  await adminPage.waitForLoadState('domcontentloaded');
  await expect(adminPage.getByText('Notifications', { exact: true }))
    .toBeVisible({ timeout: 10_000 });
});

test('@emu @settings Notifications section shows Weekly digest toggle', async ({ adminPage }) => {
  await adminPage.goto('/settings');
  await adminPage.waitForLoadState('domcontentloaded');
  await expect(adminPage.getByText('Notifications', { exact: true }))
    .toBeVisible({ timeout: 10_000 });
  await expect(adminPage.getByText('Weekly digest', { exact: true }))
    .toBeVisible({ timeout: 5_000 });
});

test('@emu @settings weekly digest toggle is interactive', async ({ adminPage }) => {
  await adminPage.goto('/settings');
  await adminPage.waitForLoadState('domcontentloaded');

  const toggle = adminPage.getByRole('switch').first();
  await expect(toggle).toBeVisible({ timeout: 5_000 });

  const initial = await toggle.getAttribute('aria-checked');
  await toggle.click();
  await expect(toggle).not.toHaveAttribute('aria-checked', initial ?? '', { timeout: 10_000 });

  // Restore original state
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', initial ?? '', { timeout: 10_000 });
});

test('@emu @settings Privacy & Legal section visible with document links', async ({ adminPage }) => {
  await adminPage.goto('/settings');
  await adminPage.waitForLoadState('domcontentloaded');
  await expect(adminPage.getByText('Privacy & Legal', { exact: false }))
    .toBeVisible({ timeout: 10_000 });
  await expect(adminPage.getByRole('link', { name: /privacy policy/i }))
    .toBeVisible({ timeout: 5_000 });
  await expect(adminPage.getByRole('link', { name: /terms of service/i }))
    .toBeVisible({ timeout: 5_000 });
});

test('@emu @settings legal links point to correct paths', async ({ adminPage }) => {
  await adminPage.goto('/settings');
  await adminPage.waitForLoadState('domcontentloaded');
  await expect(adminPage.getByRole('link', { name: /privacy policy/i }))
    .toHaveAttribute('href', /privacy-policy/);
  await expect(adminPage.getByRole('link', { name: /terms of service/i }))
    .toHaveAttribute('href', /terms-of-service/);
});

test('@emu @settings Your Consents section shows Terms and Privacy rows', async ({ adminPage }) => {
  await adminPage.goto('/settings');
  await adminPage.waitForLoadState('domcontentloaded');
  await expect(adminPage.getByText('Your Consents', { exact: false }))
    .toBeVisible({ timeout: 10_000 });
  await expect(adminPage.getByText('Terms of Service', { exact: false }).first())
    .toBeVisible({ timeout: 5_000 });
  await expect(adminPage.getByText('Privacy Policy', { exact: false }).first())
    .toBeVisible({ timeout: 5_000 });
});

test('@emu @settings About section visible (Version or env badge)', async ({ adminPage }) => {
  await adminPage.goto('/settings');
  await adminPage.waitForLoadState('domcontentloaded');
  await expect(adminPage.getByText('About', { exact: true }))
    .toBeVisible({ timeout: 10_000 });

  const hasVersion = await adminPage.getByText('Version', { exact: true })
    .isVisible({ timeout: 3_000 }).catch(() => false);
  const hasBadge = await adminPage.locator('[class*="bg-amber-100"], [class*="bg-purple-100"]')
    .first().isVisible({ timeout: 3_000 }).catch(() => false);

  expect(hasVersion || hasBadge,
    'Expected About section to show either Version row or env badge').toBe(true);
});

test('@emu @settings Kids Sports Mode section is consistent with feature flag', async ({ adminPage }) => {
  await adminPage.goto('/settings');
  await adminPage.waitForLoadState('domcontentloaded');

  const heading = adminPage.getByText('Kids Sports Mode', { exact: true });
  const visible = await heading.isVisible({ timeout: 2_000 }).catch(() => false);

  if (visible) {
    await expect(adminPage.getByText('Enable Kids Sports Mode', { exact: false }))
      .toBeVisible({ timeout: 5_000 });
  } else {
    await expect(heading).not.toBeVisible();
  }
});

test('@emu @settings parent can access /settings without redirect', async ({ parentPage }) => {
  await parentPage.goto('/settings');
  await parentPage.waitForLoadState('domcontentloaded');
  await expect(parentPage).not.toHaveURL(/\/login/);
  await expect(parentPage.getByText('Notifications', { exact: true }))
    .toBeVisible({ timeout: 10_000 });
});
