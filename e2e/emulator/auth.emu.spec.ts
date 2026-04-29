/**
 * @emu @auth Auth flows — login error paths, redirects, signup validation
 * (migrated from e2e/auth.spec.ts; consolidated with the existing emu spec)
 *
 * Covers:
 *   AUTH-login-fail: wrong password shows "Incorrect email or password"
 *   AUTH-redirect-01: unauthenticated /teams → /login
 *   AUTH-redirect-02: unauthenticated /parent → /login
 *   AUTH-signup-01: Create Account disabled until terms agreed
 *   AUTH-signup-02: passwords don't match → validation error
 *   AUTH-signup-03: password < 6 characters → validation error
 *   AUTH-signup-04: first name missing → validation error
 *
 * Excluded:
 *   AUTH-login-happy — implicitly exercised by every pre-authed emu fixture.
 *   AUTH-session-timeout (×3) — needs page.clock + fresh login; same exclusion
 *     pattern as LM-10 / PARENT-ROLE-04.
 *
 * Uses unauthenticated `page` (no role fixture) for all tests.
 */
import { test, expect } from '@playwright/test';
import { EMU_USERS } from '../seed-emulator.js';

const admin = EMU_USERS.find(u => u.role === 'admin')!;

// ---------------------------------------------------------------------------
// Login error path — wrong password
// ---------------------------------------------------------------------------

test('@emu @auth shows "Incorrect email or password" when login fails with wrong password', async ({ page }) => {
  await page.goto('/login');

  await page.getByRole('textbox', { name: /email/i }).fill(admin.email);
  await page.getByRole('textbox', { name: /password/i }).fill('definitely-wrong-password!');
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page.getByText(/incorrect email or password/i)).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/login/);
});

// ---------------------------------------------------------------------------
// Redirect unauthenticated visitors to /login
// ---------------------------------------------------------------------------

test('@emu @auth redirects unauthenticated visitors from /teams to /login', async ({ page }) => {
  await page.goto('/teams');
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});

test('@emu @auth redirects unauthenticated visitors from /parent to /login', async ({ page }) => {
  await page.goto('/parent');
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Signup validation — terms gate
// ---------------------------------------------------------------------------

test('@emu @auth disables Create Account button until terms are agreed to', async ({ page }) => {
  await page.goto('/signup');
  await page.waitForLoadState('domcontentloaded');

  await page.getByLabel('First Name').fill('Test');
  await page.getByLabel('Last Name').fill('User');
  await page.getByLabel('Email').fill('newuser-emu@example.com');
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByLabel('Confirm Password').fill('password123');

  // No terms checkbox checked → Create Account stays disabled
  await expect(page.getByRole('button', { name: /create account/i })).toBeDisabled();
});

// ---------------------------------------------------------------------------
// Signup validation — passwords must match
// ---------------------------------------------------------------------------

test('@emu @auth shows validation error when passwords do not match', async ({ page }) => {
  await page.goto('/signup');
  await page.waitForLoadState('domcontentloaded');

  await page.getByLabel('First Name').fill('Test');
  await page.getByLabel('Last Name').fill('User');
  await page.getByLabel('Email').fill('newuser-emu@example.com');
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByLabel('Confirm Password').fill('different456');
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: /create account/i }).click();

  await expect(page.getByText(/passwords do not match/i)).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// Signup validation — minimum password length
// ---------------------------------------------------------------------------

test('@emu @auth shows validation error when password is fewer than 6 characters', async ({ page }) => {
  await page.goto('/signup');
  await page.waitForLoadState('domcontentloaded');

  await page.getByLabel('First Name').fill('Test');
  await page.getByLabel('Last Name').fill('User');
  await page.getByLabel('Email').fill('newuser-emu@example.com');
  await page.getByLabel('Password', { exact: true }).fill('12345');
  await page.getByLabel('Confirm Password').fill('12345');
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: /create account/i }).click();

  await expect(page.getByText(/at least 6 characters/i)).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// Signup validation — first name required
// ---------------------------------------------------------------------------

test('@emu @auth shows validation error when first name is missing', async ({ page }) => {
  await page.goto('/signup');
  await page.waitForLoadState('domcontentloaded');

  // Leave first name blank
  await page.getByLabel('Last Name').fill('User');
  await page.getByLabel('Email').fill('newuser-emu@example.com');
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByLabel('Confirm Password').fill('password123');
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: /create account/i }).click();

  await expect(page.getByText(/first name is required/i)).toBeVisible({ timeout: 5_000 });
});
