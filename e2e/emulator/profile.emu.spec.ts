/**
 * @emu @profile Profile page UAT (migrated from e2e/profile.spec.ts)
 *
 * Covers:
 *   PROF-01: Admin can navigate to /profile
 *   PROF-02: Profile page renders user's email
 *   PROF-03: Admin role badge visible
 *   PROF-04: First Name / Last Name inputs present
 *   PROF-05: Email field is read-only (disabled)
 *   PROF-06: Save Changes button present
 *   PROF-07: Admin can save updated first/last name (existing emu test)
 *   PROF-08: Validation error when First Name cleared
 *   PROF-09: My Roles section visible
 *   PROF-10: Sign Out button visible
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';

const ADMIN_EMAIL = 'admin@emu.test';

test('@emu @profile admin can navigate to /profile', async ({ adminPage }) => {
  await adminPage.goto('/profile');
  await expect(adminPage).not.toHaveURL(/\/login/);
  await expect(adminPage.locator('main')).toBeVisible({ timeout: 10_000 });
});

test('@emu @profile profile page shows the admin email', async ({ adminPage }) => {
  await adminPage.goto('/profile');
  await adminPage.waitForLoadState('domcontentloaded');
  await expect(adminPage.getByText(ADMIN_EMAIL, { exact: false }))
    .toBeVisible({ timeout: 10_000 });
});

test('@emu @profile profile page shows admin role badge', async ({ adminPage }) => {
  await adminPage.goto('/profile');
  await adminPage.waitForLoadState('domcontentloaded');
  await expect(adminPage.getByText('Admin', { exact: false }).first())
    .toBeVisible({ timeout: 10_000 });
});

test('@emu @profile first/last name inputs are present', async ({ adminPage }) => {
  await adminPage.goto('/profile');
  await adminPage.waitForLoadState('domcontentloaded');
  await expect(adminPage.getByLabel('First Name')).toBeVisible({ timeout: 10_000 });
  await expect(adminPage.getByLabel('Last Name')).toBeVisible({ timeout: 10_000 });
});

test('@emu @profile email field is disabled (read-only)', async ({ adminPage }) => {
  await adminPage.goto('/profile');
  await adminPage.waitForLoadState('domcontentloaded');
  const emailInput = adminPage.getByLabel('Email', { exact: true });
  await expect(emailInput).toBeVisible({ timeout: 10_000 });
  await expect(emailInput).toBeDisabled();
});

test('@emu @profile Save Changes button is present', async ({ adminPage }) => {
  await adminPage.goto('/profile');
  await adminPage.waitForLoadState('domcontentloaded');
  await expect(adminPage.getByRole('button', { name: /save changes/i }))
    .toBeVisible({ timeout: 10_000 });
});

// Existing test — preserved
test('@emu @profile admin can update first and last name and see the saved confirmation', async ({ adminPage }) => {
  const page = adminPage;

  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');

  const firstNameInput = page.getByLabel('First Name');
  const lastNameInput = page.getByLabel('Last Name');

  await expect(firstNameInput).toBeVisible({ timeout: 10_000 });

  const originalFirst = await firstNameInput.inputValue();
  const originalLast = await lastNameInput.inputValue();

  const stamp = Date.now();
  await firstNameInput.clear();
  await firstNameInput.fill(`Emu${stamp}`);
  await lastNameInput.clear();
  await lastNameInput.fill('TestUser');

  const saveBtn = page.getByRole('button', { name: /save changes/i });
  await saveBtn.click();

  await expect(page.getByRole('button', { name: /saved!/i })).toBeVisible({ timeout: 15_000 });

  await firstNameInput.clear();
  await firstNameInput.fill(originalFirst || 'Emu Admin');
  await lastNameInput.clear();
  await lastNameInput.fill(originalLast || 'Admin');
  await page.getByRole('button', { name: /save changes/i }).click();
  await expect(page.getByRole('button', { name: /saved!/i })).toBeVisible({ timeout: 15_000 });
});

test('@emu @profile clearing first name shows validation error', async ({ adminPage }) => {
  await adminPage.goto('/profile');
  await adminPage.waitForLoadState('domcontentloaded');

  const firstNameInput = adminPage.getByLabel('First Name');
  await expect(firstNameInput).toBeVisible({ timeout: 10_000 });
  await firstNameInput.clear();
  await firstNameInput.blur();

  // Validation message must render
  await expect(adminPage.getByText(/first name is required/i))
    .toBeVisible({ timeout: 10_000 });

  // Restore so subsequent tests don't see an empty first name
  await firstNameInput.fill('Emu Admin');
});

test('@emu @profile My Roles section visible for admin', async ({ adminPage }) => {
  await adminPage.goto('/profile');
  await adminPage.waitForLoadState('domcontentloaded');
  await expect(adminPage.getByText('My Roles', { exact: false }))
    .toBeVisible({ timeout: 10_000 });
});

test('@emu @profile Sign Out button is present in Account section', async ({ adminPage }) => {
  await adminPage.goto('/profile');
  await adminPage.waitForLoadState('domcontentloaded');
  // Sidebar + profile page both render Sign Out — at least one must be visible
  await expect(adminPage.getByRole('button', { name: /sign out/i }).first())
    .toBeVisible({ timeout: 10_000 });
});
