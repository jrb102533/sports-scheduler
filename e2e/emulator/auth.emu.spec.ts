/**
 * @emu @auth — Login failure path (Phase 3a)
 *
 * Ported from e2e/auth.spec.ts line 37:
 *   "shows 'Incorrect email or password' when login fails with wrong password"
 *
 * No fixture needed — this is the failed-login path (never authenticates).
 * The seeded admin email is used so the request hits a real account; the
 * wrong password forces the auth/invalid-credential error path.
 */
import { test, expect } from '@playwright/test';
import { EMU_USERS } from '../seed-emulator.js';

const admin = EMU_USERS.find(u => u.role === 'admin')!;

test('@emu @auth shows "Incorrect email or password" when login fails with wrong password', async ({ page }) => {
  await page.goto('/login');

  await page.getByRole('textbox', { name: /email/i }).fill(admin.email);
  await page.getByRole('textbox', { name: /password/i }).fill('definitely-wrong-password!');
  await page.getByRole('button', { name: /sign in/i }).click();

  // mapAuthError in useAuthStore translates auth/invalid-credential to this string.
  await expect(page.getByText(/incorrect email or password/i)).toBeVisible({ timeout: 10_000 });

  // User must remain on the login page — no redirect on failure.
  await expect(page).toHaveURL(/\/login/);
});
