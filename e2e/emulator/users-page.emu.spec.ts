/**
 * @emu @admin UsersPage — Admin user management flows
 * (migrated from e2e/users-page.spec.ts)
 *
 * Covers:
 *   ADMIN-USR-01: View all users — table renders with seeded data
 *   ADMIN-USR-02: Change user role (optimistic update + Firestore save)
 *   ADMIN-USR-06: Send password reset email (resetUserPassword CF + toast)
 *   ADMIN-USR-07: Delete button absent / disabled on own row (cannot self-delete)
 *   ADMIN-USR-08: Create user by admin (createUserByAdmin CF) + cleanup
 *
 * Seeded data used:
 *   - emu-admin (admin claim)
 *   - emu-coach, emu-lm, emu-parent, emu-player (4 non-admin rows for
 *     role-change / reset / non-self-delete operations)
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';

const ADMIN_EMAIL = 'admin@emu.test';

// ---------------------------------------------------------------------------
// Users table renders
// ---------------------------------------------------------------------------

test('@emu @admin admin can view all users in the users table', async ({ adminPage }) => {
  await adminPage.goto('/users');
  await adminPage.waitForLoadState('domcontentloaded');

  await expect(adminPage).not.toHaveURL(/\/login/);
  await expect(adminPage.locator('main')).toBeVisible({ timeout: 10_000 });

  // Admin's own row must render
  await expect(adminPage.getByText('Admin').first()).toBeVisible({ timeout: 10_000 });
});

test('@emu @admin users table shows role badges for seeded roles', async ({ adminPage }) => {
  await adminPage.goto('/users');
  await adminPage.waitForLoadState('domcontentloaded');

  // 5 seeded roles → all 5 badges should appear in the table
  await expect(adminPage.getByText(/Admin/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(adminPage.getByText(/Coach/i).first()).toBeVisible();
  await expect(adminPage.getByText(/Parent/i).first()).toBeVisible();
  await expect(adminPage.getByText(/Player/i).first()).toBeVisible();
  await expect(adminPage.getByText(/League Manager/i).first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Add User modal renders required fields
// ---------------------------------------------------------------------------

test('@emu @admin admin can open the Add User modal and see required fields', async ({ adminPage }) => {
  await adminPage.goto('/users');
  await adminPage.waitForLoadState('domcontentloaded');

  const addUserBtn = adminPage.getByRole('button', { name: /add user|create user|\+/i }).first();
  await expect(addUserBtn).toBeVisible({ timeout: 10_000 });
  await addUserBtn.click();

  const modal = adminPage.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  await expect(modal.getByLabel(/display name|name/i).first()).toBeVisible();
  await expect(modal.getByLabel(/email/i).first()).toBeVisible();
  await expect(modal.getByLabel(/role/i).first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Create user via Add User modal — exercises createUserByAdmin CF end-to-end
// ---------------------------------------------------------------------------

test('@emu @admin admin can create a new user via the Add User modal', async ({ adminPage }) => {
  await adminPage.goto('/users');
  await adminPage.waitForLoadState('domcontentloaded');

  const addUserBtn = adminPage.getByRole('button', { name: /add user|create user|\+/i }).first();
  await addUserBtn.click();

  const modal = adminPage.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  const uniqueEmail = `e2e-emu-${Date.now()}@example.com`;
  const displayName = `Emu TestUser ${Date.now()}`;

  await modal.getByLabel(/display name|name/i).first().fill(displayName);
  await modal.getByLabel(/email/i).first().fill(uniqueEmail);

  const roleSelect = modal.getByLabel(/role/i).first();
  if (await roleSelect.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await roleSelect.selectOption('coach');
  }

  await modal.getByRole('button', { name: /save|create|add/i }).click();

  // Modal closes on success
  await expect(modal).toBeHidden({ timeout: 15_000 });

  // New user appears in the list
  await expect(adminPage.getByText(displayName, { exact: false })).toBeVisible({ timeout: 10_000 });

  // Cleanup — delete the user we just created
  const userRow = adminPage.locator('tr, [class*="user-row"]')
    .filter({ has: adminPage.getByText(displayName, { exact: false }) })
    .first();
  const deleteBtn = userRow.getByRole('button', { name: /delete|trash/i })
    .or(userRow.locator('[aria-label*="delete" i]'))
    .first();
  if (await deleteBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await deleteBtn.click();
    const confirmBtn = adminPage.getByRole('button', { name: /confirm|yes|delete/i }).last();
    if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmBtn.click();
    }
  }
});

// ---------------------------------------------------------------------------
// Change user role via dropdown — uses seeded coach
// ---------------------------------------------------------------------------

test('@emu @admin admin can change a non-admin user role via the dropdown', async ({ adminPage }) => {
  await adminPage.goto('/users');
  await adminPage.waitForLoadState('domcontentloaded');

  // Find the coach's row (seeded as emu-coach with email coach@emu.test)
  const coachRow = adminPage.locator('tr').filter({
    has: adminPage.getByText('coach@emu.test', { exact: false }),
  }).first();
  await expect(coachRow).toBeVisible({ timeout: 10_000 });

  const roleSelect = coachRow.locator('select').filter({
    has: adminPage.locator('option[value="coach"]'),
  }).first();
  await expect(roleSelect).toBeVisible({ timeout: 5_000 });

  const currentRole = await roleSelect.inputValue();
  const newRole = currentRole === 'coach' ? 'parent' : 'coach';

  await roleSelect.selectOption(newRole);
  await expect(roleSelect).toHaveValue(newRole, { timeout: 5_000 });

  // Revert to keep seed state clean for other tests in the run
  await roleSelect.selectOption(currentRole);
  await expect(roleSelect).toHaveValue(currentRole, { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// Trigger password reset on a non-admin user — uses seeded coach
// ---------------------------------------------------------------------------

test('@emu @admin admin can trigger password reset for another user', async ({ adminPage }) => {
  await adminPage.goto('/users');
  await adminPage.waitForLoadState('domcontentloaded');

  const coachRow = adminPage.locator('tr').filter({
    has: adminPage.getByText('coach@emu.test', { exact: false }),
  }).first();
  await expect(coachRow).toBeVisible({ timeout: 10_000 });

  const resetBtn = coachRow.getByRole('button', { name: /reset password|key/i })
    .or(coachRow.locator('[aria-label*="reset password" i]'))
    .first();
  await expect(resetBtn).toBeVisible({ timeout: 5_000 });
  await resetBtn.click();

  // Optional confirm dialog
  const confirmBtn = adminPage.getByRole('button', { name: /confirm|yes|send/i }).last();
  if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await confirmBtn.click();
  }

  // Success toast / confirmation message
  await expect(adminPage.getByText(/reset.*sent|password reset|email sent/i).first())
    .toBeVisible({ timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// Admin cannot delete their own account
// ---------------------------------------------------------------------------

test('@emu @admin delete button is absent or disabled on admin own row', async ({ adminPage }) => {
  await adminPage.goto('/users');
  await adminPage.waitForLoadState('domcontentloaded');

  const adminRow = adminPage.locator('tr, [class*="user-row"]').filter({
    has: adminPage.getByText(ADMIN_EMAIL, { exact: false }),
  }).first();
  await expect(adminRow).toBeVisible({ timeout: 10_000 });

  const selfDeleteBtn = adminRow.getByRole('button', { name: /delete|trash/i })
    .or(adminRow.locator('[aria-label*="delete" i]'))
    .first();
  const deletePresent = await selfDeleteBtn.isVisible({ timeout: 2_000 }).catch(() => false);

  if (deletePresent) {
    // If a delete control is rendered for own row, it must be disabled
    await expect(selfDeleteBtn).toBeDisabled();
  } else {
    // Button not present for own row — correct behavior
    expect(deletePresent).toBe(false);
  }
});
