/**
 * @emu @admin — /users page (admin user management)
 *
 * UsersPage renders a card list (not a table). Each card is a <button> that
 * opens a slide-out detail panel. The detail panel has display-name editing,
 * memberships, and danger-zone actions (reset password, delete).
 *
 * Covers:
 *   ADMIN-USR-01: Page renders with seeded users visible
 *   ADMIN-USR-02: Search by name filters the list
 *   ADMIN-USR-03: Role filter chips narrow the list
 *   ADMIN-USR-04: Clicking a user card opens the detail panel
 *   ADMIN-USR-05: Display name can be edited in the detail panel
 *   ADMIN-USR-06: "Add User" button opens the AddUserModal
 *   ADMIN-USR-07: Non-admin users have a Delete button in the detail panel
 *   ADMIN-USR-08: Admin's own row does not show a Delete button
 *
 * Tests NOT migrated (require live Cloud Functions):
 *   - ADMIN-USR-06 (full): createUserByAdmin CF — manual checklist
 *   - resetUserPassword CF — manual checklist
 *   - deleteUserByAdmin CF — manual checklist (destructive)
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';

async function gotoUsers(page: import('@playwright/test').Page) {
  await page.goto('/users');
  await page.waitForLoadState('domcontentloaded');
  // Wait for the user list to load (shows "N users" count)
  await expect(page.getByText(/\d+ users?/)).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// ADMIN-USR-01: Page renders with seeded users
// ---------------------------------------------------------------------------

test('@emu @admin ADMIN-USR-01: /users page renders with seeded users', async ({
  adminPage: page,
}) => {
  await gotoUsers(page);

  await expect(page).not.toHaveURL(/\/login/);

  // At least the seeded admin user card must appear
  await expect(page.getByText('Emu Admin', { exact: false })).toBeVisible({ timeout: 10_000 });

  // "Add User" button must be present (admin capability)
  await expect(page.getByRole('button', { name: /add user/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// ADMIN-USR-02: Search filters the list
// ---------------------------------------------------------------------------

test('@emu @admin ADMIN-USR-02: search by name filters user cards', async ({
  adminPage: page,
}) => {
  await gotoUsers(page);

  const searchInput = page.getByPlaceholder(/search by name or email/i);
  await expect(searchInput).toBeVisible();

  await searchInput.fill('Emu Coach');

  // Coach card must appear
  await expect(page.getByText('Emu Coach', { exact: false })).toBeVisible({ timeout: 5_000 });

  // Admin card must be hidden
  await expect(page.getByText('Emu Admin', { exact: false })).not.toBeVisible();

  // Clear search — admin reappears
  await searchInput.fill('');
  await expect(page.getByText('Emu Admin', { exact: false })).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// ADMIN-USR-03: Role filter chips narrow the list
// ---------------------------------------------------------------------------

test('@emu @admin ADMIN-USR-03: role filter chip narrows the user list', async ({
  adminPage: page,
}) => {
  await gotoUsers(page);

  // Click the "Coach" filter chip
  const coachChip = page.getByRole('button', { name: /^coach$/i });
  await expect(coachChip).toBeVisible();
  await coachChip.click();

  // Coach card visible, admin card hidden
  await expect(page.getByText('Emu Coach', { exact: false })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Emu Admin', { exact: false })).not.toBeVisible();

  // Reset to "All"
  const allChip = page.getByRole('button', { name: /^all$/i });
  await allChip.click();
  await expect(page.getByText('Emu Admin', { exact: false })).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// ADMIN-USR-04: Clicking a user card opens the detail panel
// ---------------------------------------------------------------------------

test('@emu @admin ADMIN-USR-04: clicking a user card opens the detail panel', async ({
  adminPage: page,
}) => {
  await gotoUsers(page);

  // Click the Emu Coach card
  const coachCard = page.getByRole('button', { name: /emu coach/i }).first();
  await expect(coachCard).toBeVisible({ timeout: 10_000 });
  await coachCard.click();

  // Detail panel must show the user's email and a display name input
  await expect(page.getByText('coach@emu.test', { exact: false })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('textbox', { name: /display name/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// ADMIN-USR-05: Display name edit in detail panel
// ---------------------------------------------------------------------------

test('@emu @admin ADMIN-USR-05: admin can edit display name in the detail panel', async ({
  adminPage: page,
}) => {
  await gotoUsers(page);

  const coachCard = page.getByRole('button', { name: /emu coach/i }).first();
  await coachCard.click();

  const nameInput = page.getByRole('textbox', { name: /display name/i });
  await expect(nameInput).toBeVisible({ timeout: 5_000 });

  // Edit the name
  await nameInput.fill('Emu Coach Edited');

  // Save button must appear (dirty state)
  const saveBtn = page.getByRole('button', { name: /save changes/i });
  await expect(saveBtn).toBeVisible({ timeout: 3_000 });

  // Revert — fill back to original
  await nameInput.fill('Emu Coach');
  // Save button should appear again (still dirty vs DB) or a Cancel button
  // Either way: the input reflects the value we typed
  await expect(nameInput).toHaveValue('Emu Coach');
});

// ---------------------------------------------------------------------------
// ADMIN-USR-06: "Add User" opens the modal
// ---------------------------------------------------------------------------

test('@emu @admin ADMIN-USR-06: "Add User" button opens the create user modal', async ({
  adminPage: page,
}) => {
  await gotoUsers(page);

  await page.getByRole('button', { name: /add user/i }).click();

  // Modal must open with the form fields
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByLabel(/display name/i)).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();

  // Close modal
  const closeBtn = page.getByRole('button', { name: /close|cancel/i }).first();
  if (await closeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await closeBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3_000 });
});

// ---------------------------------------------------------------------------
// ADMIN-USR-07: Non-admin user detail panel has Delete button
// ---------------------------------------------------------------------------

test('@emu @admin ADMIN-USR-07: non-admin user detail panel shows Delete User button', async ({
  adminPage: page,
}) => {
  await gotoUsers(page);

  const coachCard = page.getByRole('button', { name: /emu coach/i }).first();
  await coachCard.click();

  // Danger zone Delete button must be visible for non-self users
  await expect(page.getByRole('button', { name: /delete user/i })).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// ADMIN-USR-08: Admin's own detail panel does NOT have a Delete button
// ---------------------------------------------------------------------------

test('@emu @admin ADMIN-USR-08: admin own detail panel does not show Delete User button', async ({
  adminPage: page,
}) => {
  await gotoUsers(page);

  // The admin's own card is labelled "Emu Admin" and shows "(you)"
  const adminCard = page.getByRole('button', { name: /emu admin/i }).first();
  await adminCard.click();

  // Delete button must not exist for self
  const deleteBtn = page.getByRole('button', { name: /delete user/i });
  await expect(deleteBtn).not.toBeVisible({ timeout: 3_000 });
});
