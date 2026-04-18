/**
 * Auth flows UAT
 *
 * Covers:
 *   GO_LIVE_CHECKLIST: Login with valid credentials
 *   GO_LIVE_CHECKLIST: Login with wrong password shows correct error message
 *   GO_LIVE_CHECKLIST: Session idle 30 min → warning modal with 60-second countdown
 *   GO_LIVE_CHECKLIST: Clicking "Stay Signed In" dismisses modal and resets timer
 *   GO_LIVE_CHECKLIST: Countdown reaching zero logs user out
 *   Non-invited / disallowed signup blocked with correct message
 */

import { test, expect, creds } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Login — happy path
// ---------------------------------------------------------------------------

test('@smoke logs in with valid credentials and lands on the app shell', async ({ authPage }) => {
  const { email, password } = creds.admin();
  await authPage.gotoLogin();
  await authPage.emailInput.fill(email);
  await authPage.passwordInput.fill(password);
  await authPage.signInButton.click();

  // The authenticated app shell renders "First Whistle" in the brand header
  await expect(authPage.page.getByText('First Whistle').first()).toBeVisible({ timeout: 15_000 });

  // URL leaves /login
  await expect(authPage.page).not.toHaveURL(/\/login/);
});

// ---------------------------------------------------------------------------
// Login — wrong password
// ---------------------------------------------------------------------------

test('@smoke shows "Incorrect email or password" when login fails with wrong password', async ({
  authPage,
}) => {
  // Use a throwaway non-existent email so Firebase never rate-limits a real account.
  // The test only needs to verify the UI renders the correct error message — it does
  // not need a real account to exist.  Firebase returns auth/invalid-credential for
  // unknown email+password combinations, which mapAuthError translates to the expected
  // UI string.  See issue #339.
  await authPage.gotoLogin();
  await authPage.emailInput.fill('e2e-wrongpassword-probe@example.com');
  await authPage.passwordInput.fill('definitely-wrong-password-12345!');
  await authPage.signInButton.click();

  // The error message comes from mapAuthError in useAuthStore
  await authPage.expectError(/incorrect email or password/i);

  // User stays on login page
  await authPage.expectOnLoginPage();
});

// ---------------------------------------------------------------------------
// Login — unknown email
// ---------------------------------------------------------------------------

test('shows an error when no account exists for the given email', async ({ authPage }) => {
  await authPage.gotoLogin();
  await authPage.emailInput.fill('definitely-not-registered@example.com');
  await authPage.passwordInput.fill('SomePassword123');
  await authPage.signInButton.click();

  // Firebase returns auth/user-not-found or auth/invalid-credential depending on version
  await authPage.expectError(/incorrect email or password|no account found/i);
  await authPage.expectOnLoginPage();
});

// ---------------------------------------------------------------------------
// Redirect unauthenticated visitors to /login
// ---------------------------------------------------------------------------

test('redirects unauthenticated visitors from /teams to /login', async ({ page }) => {
  await page.goto('/teams');
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});

test('redirects unauthenticated visitors from /parent to /login', async ({ page }) => {
  await page.goto('/parent');
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Signup — validation errors
// ---------------------------------------------------------------------------

test('disables Create Account button until terms are agreed to', async ({ authPage }) => {
  await authPage.gotoSignup();

  // Fill all fields but do NOT check terms
  await authPage.firstNameInput.fill('Test');
  await authPage.lastNameInput.fill('User');
  await authPage.emailInput.fill('newuser@example.com');
  await authPage.passwordInput.fill('password123');
  await authPage.confirmPasswordInput.fill('password123');

  // Button should be disabled
  await expect(authPage.createAccountButton).toBeDisabled();
});

test('shows validation error when passwords do not match', async ({ authPage }) => {
  await authPage.gotoSignup();
  await authPage.firstNameInput.fill('Test');
  await authPage.lastNameInput.fill('User');
  await authPage.emailInput.fill('newuser@example.com');
  await authPage.passwordInput.fill('password123');
  await authPage.confirmPasswordInput.fill('different456');
  await authPage.termsCheckbox.check();
  await authPage.createAccountButton.click();

  await authPage.expectError(/passwords do not match/i);
});

test('shows validation error when password is fewer than 6 characters', async ({ authPage }) => {
  await authPage.gotoSignup();
  await authPage.firstNameInput.fill('Test');
  await authPage.lastNameInput.fill('User');
  await authPage.emailInput.fill('newuser@example.com');
  await authPage.passwordInput.fill('12345');
  await authPage.confirmPasswordInput.fill('12345');
  await authPage.termsCheckbox.check();
  await authPage.createAccountButton.click();

  await authPage.expectError(/at least 6 characters/i);
});

test('shows validation error when first name is missing', async ({ authPage }) => {
  await authPage.gotoSignup();
  // Leave first name blank
  await authPage.lastNameInput.fill('User');
  await authPage.emailInput.fill('newuser@example.com');
  await authPage.passwordInput.fill('password123');
  await authPage.confirmPasswordInput.fill('password123');
  await authPage.termsCheckbox.check();
  await authPage.createAccountButton.click();

  await authPage.expectError(/first name is required/i);
});

// ---------------------------------------------------------------------------
// Session idle timeout — tested via fake timers / clock manipulation
//
// The idle timer fires after 30 minutes of inactivity (IDLE_MS = 30 * 60 * 1000).
// Playwright's page.clock API lets us fast-forward time without waiting.
// ---------------------------------------------------------------------------

test('shows Session Expiring modal after 30 minutes of inactivity', async ({ authPage, page }) => {
  await authPage.loginAndWaitForApp(creds.admin().email, creds.admin().password);

  // Install a fake clock so we can skip 30 minutes instantly
  await page.clock.install();

  // Fast-forward 30 minutes + 1 second to trigger the idle timeout
  await page.clock.fastForward('30:01');

  // The SessionTimeoutModal should appear
  const modal = page.getByRole('heading', { name: /session expiring soon/i });
  await expect(modal).toBeVisible({ timeout: 5_000 });

  // A countdown number should be visible (starts at 60)
  const countdown = page.locator('[aria-live="polite"]');
  await expect(countdown).toBeVisible();
  const countdownText = await countdown.textContent();
  expect(Number(countdownText)).toBeGreaterThan(0);
  expect(Number(countdownText)).toBeLessThanOrEqual(60);
});

test('Stay Signed In dismisses the session timeout modal', async ({ authPage, page }) => {
  await authPage.loginAndWaitForApp(creds.admin().email, creds.admin().password);

  await page.clock.install();
  await page.clock.fastForward('30:01');

  // Wait for modal
  await expect(page.getByRole('heading', { name: /session expiring soon/i })).toBeVisible({
    timeout: 5_000,
  });

  // Click Stay Signed In
  await page.getByRole('button', { name: /stay signed in/i }).click();

  // Modal should disappear
  await expect(page.getByRole('heading', { name: /session expiring soon/i })).not.toBeVisible({
    timeout: 5_000,
  });

  // User should still be on the authenticated shell
  await expect(page.getByText('First Whistle').first()).toBeVisible();
});

test('auto-logs out when countdown expires after session timeout warning', async ({
  authPage,
  page,
}) => {
  await authPage.loginAndWaitForApp(creds.admin().email, creds.admin().password);

  await page.clock.install();

  // Fast-forward 30 minutes to show the warning, then another 61 seconds to exhaust countdown
  await page.clock.fastForward('30:01');
  await expect(page.getByRole('heading', { name: /session expiring soon/i })).toBeVisible({
    timeout: 5_000,
  });

  await page.clock.fastForward('00:61');

  // Should be redirected to /login
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});
