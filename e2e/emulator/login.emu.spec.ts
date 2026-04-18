/**
 * Phase 2b: emulator E2E login spec.
 *
 * Tests 1 & 2 are the Phase 1 proof-of-concept assertions:
 *   1. Vite dev server (mode=emulator) boots and serves the app
 *   2. Firebase Web SDK is wired to the emulator suite (VITE_USE_EMULATOR=true)
 *   3. Playwright can hit localhost:5173 and render the login form
 *
 * Test 3 (Phase 2b) proves end-to-end sign-in against the seeded admin user
 * that seed-emulator.ts writes before Playwright starts.
 */
import { test, expect } from '@playwright/test';
import { EMU_USERS, EMU_PASSWORD } from '../seed-emulator.js';

test('@emu @auth login form renders against emulator stack', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  // Use role-scoped matchers so the password input isn't confused with the
  // "Show password" toggle button (which also has aria-label containing "password").
  await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /password/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
});

test('@emu @auth unauthenticated visitor is redirected from / to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});

test('@emu @auth seeded admin can sign in and reach authenticated view', async ({ page }) => {
  const admin = EMU_USERS.find(u => u.role === 'admin')!;

  await page.goto('/login');
  await page.getByRole('textbox', { name: /email/i }).fill(admin.email);
  await page.getByRole('textbox', { name: /password/i }).fill(EMU_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Redirect away from /login proves Firebase Auth accepted the seeded credentials.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  // At least one nav element visible after auth confirms the app rendered its
  // authenticated shell (loose assertion — avoids coupling to exact nav text).
  await expect(
    page.getByRole('navigation').or(page.getByRole('link', { name: /schedule/i }))
  ).toBeVisible({ timeout: 10_000 });
});
