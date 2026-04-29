/**
 * @emu @auth Auth — logout flows (migrated from e2e/auth-logout.spec.ts)
 *
 * Covers:
 *   AUTH-05a: Logout from sidebar clears session and redirects to /login
 *   AUTH-05b: Logout from profile page clears session and redirects to /login
 *   AUTH-05c: Protected route is inaccessible after logout
 *
 * Excluded:
 *   AUTH-04 (resend verification UI) — requires a seeded unverified account.
 *   The emu seed marks all 5 users as `emailVerified: true`. Worth a follow-up
 *   if/when we add an unverified seed user.
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';

// ---------------------------------------------------------------------------
// AUTH-05a — Logout via sidebar
// ---------------------------------------------------------------------------

test('@emu @auth logout from sidebar clears session and redirects to /login', async ({ adminPage }) => {
  await adminPage.goto('/home');
  await adminPage.waitForLoadState('domcontentloaded');

  // The sidebar logout button may be behind a user/account menu on narrow viewports
  const logoutTrigger = adminPage
    .getByRole('button', { name: /logout|sign out|log out/i })
    .or(adminPage.getByRole('link', { name: /logout|sign out|log out/i }))
    .first();

  if (!(await logoutTrigger.isVisible({ timeout: 3_000 }).catch(() => false))) {
    const userMenu = adminPage.locator('[aria-label*="user" i], [aria-label*="account" i]').first();
    if (await userMenu.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await userMenu.click();
    }
  }

  await expect(logoutTrigger).toBeVisible({ timeout: 5_000 });
  await logoutTrigger.click();

  await expect(adminPage).toHaveURL(/\/login/, { timeout: 10_000 });
  await expect(adminPage.getByRole('button', { name: 'Sign In' }))
    .toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// AUTH-05b — Logout via Profile page
// ---------------------------------------------------------------------------

test('@emu @auth logout from profile page clears session and redirects to /login', async ({ adminPage }) => {
  await adminPage.goto('/profile');
  await adminPage.waitForLoadState('domcontentloaded');

  const logoutBtn = adminPage.getByRole('button', { name: /logout|sign out|log out/i }).first();
  await expect(logoutBtn).toBeVisible({ timeout: 5_000 });
  await logoutBtn.click();

  await expect(adminPage).toHaveURL(/\/login/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// AUTH-05c — Protected route inaccessible after logout
// ---------------------------------------------------------------------------

test('@emu @auth protected route is inaccessible after logout', async ({ adminPage }) => {
  await adminPage.goto('/profile');
  await adminPage.waitForLoadState('domcontentloaded');

  const logoutBtn = adminPage.getByRole('button', { name: /logout|sign out|log out/i }).first();
  await expect(logoutBtn).toBeVisible({ timeout: 5_000 });
  await logoutBtn.click();

  await expect(adminPage).toHaveURL(/\/login/, { timeout: 10_000 });

  // Attempt to access a protected route — should redirect back to /login
  await adminPage.goto('/teams');
  await expect(adminPage).toHaveURL(/\/login/, { timeout: 10_000 });
});
