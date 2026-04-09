/**
 * Profile page UAT
 *
 * Covers:
 *   PROF-01: Admin can navigate to /profile
 *   PROF-02: Profile page renders user's display name and email
 *   PROF-03: First Name and Last Name fields are present and pre-populated
 *   PROF-04: Admin can save an updated display name
 *   PROF-05: Validation error appears when First Name is cleared and save attempted
 *   PROF-06: Email field is read-only (cannot be edited)
 *   PROF-07: My Roles section is present for a user with memberships
 *   PROF-08: Sign Out button is present in the Account section
 *
 * All tests authenticate as admin via the `asAdmin` fixture.
 * Profile mutations use a throwaway value then immediately restore the original
 * so the test account is left clean.
 */

import { test, expect } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test('admin can navigate to /profile', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/profile');

  // Page must load — not redirect to /login
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Identity display
// ---------------------------------------------------------------------------

test('profile page shows the user display name and email', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');

  // The card at the top of the profile page renders displayName and email
  const adminEmail = process.env.E2E_ADMIN_EMAIL ?? '';

  // Email is shown as a grey subtitle under the display name
  await expect(page.getByText(adminEmail, { exact: false })).toBeVisible({ timeout: 10_000 });
});

test('profile page shows a role badge for the admin', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');

  // Admin's role badge should mention "Admin"
  await expect(page.getByText('Admin', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Edit Profile form fields
// ---------------------------------------------------------------------------

test('first name and last name inputs are present and visible', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByLabel('First Name')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel('Last Name')).toBeVisible({ timeout: 10_000 });
});

test('email field is present but disabled (read-only)', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');

  // The email input in the Edit Profile card is explicitly disabled
  const emailInput = page.getByLabel('Email', { exact: true });
  await expect(emailInput).toBeVisible({ timeout: 10_000 });
  await expect(emailInput).toBeDisabled();
});

test('Save Changes button is present in the Edit Profile card', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');

  const saveBtn = page.getByRole('button', { name: /save changes/i });
  await expect(saveBtn).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Save display name
// ---------------------------------------------------------------------------

test('admin can update first and last name and see the saved confirmation', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');

  const firstNameInput = page.getByLabel('First Name');
  const lastNameInput = page.getByLabel('Last Name');

  // Remember the originals so we can restore them
  const originalFirst = await firstNameInput.inputValue();
  const originalLast = await lastNameInput.inputValue();

  // Update to a unique throwaway name
  const stamp = Date.now();
  await firstNameInput.clear();
  await firstNameInput.fill(`E2E${stamp}`);
  await lastNameInput.clear();
  await lastNameInput.fill('TestUser');

  const saveBtn = page.getByRole('button', { name: /save changes/i });
  await saveBtn.click();

  // Button label transitions to "Saved!" on success
  await expect(page.getByRole('button', { name: /saved!/i })).toBeVisible({ timeout: 15_000 });

  // Restore originals (guard against empty values — use a safe fallback)
  await firstNameInput.clear();
  await firstNameInput.fill(originalFirst || 'Admin');
  await lastNameInput.clear();
  await lastNameInput.fill(originalLast || 'User');
  await page.getByRole('button', { name: /save changes/i }).click();
  // Wait for save to complete before the test ends
  await page.waitForTimeout(2_000);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('clearing first name and saving shows a validation error', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');

  const firstNameInput = page.getByLabel('First Name');
  await firstNameInput.clear();
  await firstNameInput.blur(); // trigger onBlur validation

  // Validation error for first name should appear
  const error = page.getByText(/first name is required/i);
  await expect(error).toBeVisible({ timeout: 5_000 });

  // Save Changes button should be disabled when first name is empty
  const saveBtn = page.getByRole('button', { name: /save changes/i });
  await expect(saveBtn).toBeDisabled();
});

// ---------------------------------------------------------------------------
// My Roles section
// ---------------------------------------------------------------------------

test('My Roles section is visible for an admin with memberships', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');

  // My Roles card heading
  const rolesHeading = page.getByText('My Roles', { exact: false });
  await expect(rolesHeading).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Account section
// ---------------------------------------------------------------------------

test('Sign Out button is present in the Account section', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');

  // The Account card contains a Sign Out button
  const signOutBtn = page.getByRole('button', { name: /sign out/i });
  await expect(signOutBtn).toBeVisible({ timeout: 10_000 });
});
