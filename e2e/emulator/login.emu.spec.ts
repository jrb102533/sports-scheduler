/**
 * Phase 1 proof-of-concept for the emulator E2E tier.
 *
 * Goals of this spec (NOT comprehensive login coverage):
 *   1. Vite dev server (mode=emulator) boots and serves the app
 *   2. Firebase Web SDK is wired to the emulator suite (VITE_USE_EMULATOR=true)
 *   3. Playwright can hit localhost:5173 and render the login form
 *
 * Full auth coverage will migrate to this tier in Phase 2 (issue #466).
 */
import { test, expect } from '@playwright/test';

test('@emu @auth login form renders against emulator stack', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
});

test('@emu @auth unauthenticated visitor is redirected from / to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});
