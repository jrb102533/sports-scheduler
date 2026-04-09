/**
 * Auth gates — ForcePasswordChangeModal and ConsentUpdateModal
 *
 * Covers:
 *   AUTH-10: ForcePasswordChangeModal blocks app access until password set
 *   AUTH-11: ConsentUpdateModal blocks app access until consent re-confirmed
 *
 * These modals are rendered by App.tsx on top of the RouterProvider:
 *   {user && mustChangePassword && <ForcePasswordChangeModal />}
 *   {user && !mustChangePassword && consentOutdated && <ConsentUpdateModal />}
 *
 * Testing approach:
 *   - ForcePasswordChangeModal: requires a test account with `mustChangePassword: true`
 *     in their Firestore profile. Set via E2E_MUST_CHANGE_EMAIL / E2E_MUST_CHANGE_PASSWORD.
 *   - ConsentUpdateModal: requires a test account with consent version < current LEGAL_VERSIONS.
 *     Set via E2E_CONSENT_OUTDATED_EMAIL / E2E_CONSENT_OUTDATED_PASSWORD.
 *   - Both tests skip gracefully if the env vars are not set.
 *
 * NOTE: These tests MUTATE the test account state (clears mustChangePassword,
 *       records consent). The test accounts should be reset before the next run if
 *       you want to test the gate again. Document this in your test account setup.
 */

import { test, expect } from './fixtures/auth.fixture';
import { AuthPage } from './pages/AuthPage';

// ---------------------------------------------------------------------------
// ForcePasswordChangeModal — validation
// ---------------------------------------------------------------------------

test('ForcePasswordChangeModal shows validation error for password under 8 characters', async ({
  page,
}) => {
  const email = process.env.E2E_MUST_CHANGE_EMAIL;
  const password = process.env.E2E_MUST_CHANGE_PASSWORD;

  if (!email || !password) {
    test.skip(
      true,
      'E2E_MUST_CHANGE_EMAIL / E2E_MUST_CHANGE_PASSWORD not set — skipping ForcePasswordChange test',
    );
    return;
  }

  const auth = new AuthPage(page);
  await auth.login(email, password);

  // The ForcePasswordChangeModal should appear (it overlays the whole screen)
  const modal = page.locator('h2', { hasText: /set your password/i });
  await expect(modal).toBeVisible({ timeout: 15_000 });

  // Fill a too-short password
  await page.getByLabel('New Password').first().fill('short');
  await page.getByLabel('Confirm Password').first().fill('short');
  await page.getByRole('button', { name: /set password/i }).click();

  // Validation error: at least 8 characters
  const errorMsg = page.locator('.text-red-600');
  await expect(errorMsg).toBeVisible({ timeout: 5_000 });
  await expect(errorMsg).toContainText(/at least 8 characters/i);
});

test('ForcePasswordChangeModal shows validation error when passwords do not match', async ({
  page,
}) => {
  const email = process.env.E2E_MUST_CHANGE_EMAIL;
  const password = process.env.E2E_MUST_CHANGE_PASSWORD;

  if (!email || !password) {
    test.skip(true, 'E2E_MUST_CHANGE_EMAIL / E2E_MUST_CHANGE_PASSWORD not set');
    return;
  }

  const auth = new AuthPage(page);
  await auth.login(email, password);

  const modal = page.locator('h2', { hasText: /set your password/i });
  await expect(modal).toBeVisible({ timeout: 15_000 });

  await page.getByLabel('New Password').first().fill('NewPassword123');
  await page.getByLabel('Confirm Password').first().fill('DifferentPassword456');
  await page.getByRole('button', { name: /set password/i }).click();

  const errorMsg = page.locator('.text-red-600');
  await expect(errorMsg).toBeVisible({ timeout: 5_000 });
  await expect(errorMsg).toContainText(/do not match/i);
});

test('ForcePasswordChangeModal — app inaccessible until password set', async ({ page }) => {
  const email = process.env.E2E_MUST_CHANGE_EMAIL;
  const password = process.env.E2E_MUST_CHANGE_PASSWORD;

  if (!email || !password) {
    test.skip(true, 'E2E_MUST_CHANGE_EMAIL / E2E_MUST_CHANGE_PASSWORD not set');
    return;
  }

  const auth = new AuthPage(page);
  await auth.login(email, password);

  const modal = page.locator('h2', { hasText: /set your password/i });
  await expect(modal).toBeVisible({ timeout: 15_000 });

  // The modal is z-50 fixed overlay; the underlying app routes are inaccessible.
  // Attempting to navigate should not dismiss the modal.
  await page.goto('/teams');

  // Modal should still be visible (or user was redirected to login — either is acceptable)
  const stillBlocked =
    (await modal.isVisible({ timeout: 3_000 }).catch(() => false)) ||
    (await page.url().includes('/login'));

  expect(stillBlocked).toBe(true);
});

// ---------------------------------------------------------------------------
// ConsentUpdateModal — gate behavior
// ---------------------------------------------------------------------------

test('ConsentUpdateModal appears for user with outdated consent', async ({ page }) => {
  const email = process.env.E2E_CONSENT_OUTDATED_EMAIL;
  const password = process.env.E2E_CONSENT_OUTDATED_PASSWORD;

  if (!email || !password) {
    test.skip(
      true,
      'E2E_CONSENT_OUTDATED_EMAIL / E2E_CONSENT_OUTDATED_PASSWORD not set — skipping consent test',
    );
    return;
  }

  const auth = new AuthPage(page);
  await auth.login(email, password);

  // ConsentUpdateModal heading
  const modal = page.locator('h2', { hasText: /updated our policies/i });
  await expect(modal).toBeVisible({ timeout: 15_000 });

  // "Continue" button should be disabled until checkbox is checked
  const continueBtn = page.getByRole('button', { name: /continue/i });
  await expect(continueBtn).toBeDisabled();
});

test('ConsentUpdateModal Continue button remains disabled until agreement checked', async ({
  page,
}) => {
  const email = process.env.E2E_CONSENT_OUTDATED_EMAIL;
  const password = process.env.E2E_CONSENT_OUTDATED_PASSWORD;

  if (!email || !password) {
    test.skip(true, 'E2E_CONSENT_OUTDATED_EMAIL / E2E_CONSENT_OUTDATED_PASSWORD not set');
    return;
  }

  const auth = new AuthPage(page);
  await auth.login(email, password);

  await expect(page.locator('h2', { hasText: /updated our policies/i })).toBeVisible({
    timeout: 15_000,
  });

  const continueBtn = page.getByRole('button', { name: /continue/i });

  // Before checking the checkbox — disabled
  await expect(continueBtn).toBeDisabled();

  // Check the agreement
  const checkbox = page.getByRole('checkbox');
  await checkbox.check();

  // Now it should be enabled
  await expect(continueBtn).toBeEnabled({ timeout: 3_000 });
});

test('ConsentUpdateModal — policy links are present and open legal pages', async ({ page }) => {
  const email = process.env.E2E_CONSENT_OUTDATED_EMAIL;
  const password = process.env.E2E_CONSENT_OUTDATED_PASSWORD;

  if (!email || !password) {
    test.skip(true, 'E2E_CONSENT_OUTDATED_EMAIL / E2E_CONSENT_OUTDATED_PASSWORD not set');
    return;
  }

  const auth = new AuthPage(page);
  await auth.login(email, password);

  await expect(page.locator('h2', { hasText: /updated our policies/i })).toBeVisible({
    timeout: 15_000,
  });

  // Both legal links should be present
  const tosLink = page.getByRole('link', { name: /terms of service/i });
  const ppLink = page.getByRole('link', { name: /privacy policy/i });

  await expect(tosLink).toBeVisible();
  await expect(ppLink).toBeVisible();

  // Both should link to the correct routes
  await expect(tosLink).toHaveAttribute('href', /terms-of-service/);
  await expect(ppLink).toHaveAttribute('href', /privacy-policy/);
});
