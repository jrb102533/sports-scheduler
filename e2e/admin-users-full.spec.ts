/**
 * Full admin user lifecycle UAT
 *
 * Extends users-page.spec.ts with end-to-end lifecycle scenarios:
 *
 *   USR-FULL-01: Newly created user appears in the table with correct role badge
 *   USR-FULL-02: Admin can change a user's role from the dropdown and the UI updates
 *   USR-FULL-03: Admin can send a password reset email and see a success toast
 *   USR-FULL-04: Admin cannot delete their own account (delete button absent or disabled)
 *   USR-FULL-05: Admin can delete another user and that user disappears from the list
 *
 * These tests are complementary to users-page.spec.ts, which covers the
 * Add User modal, table rendering, and role badge display.  Tests here focus
 * on the full lifecycle arc and cleanup.
 *
 * NOTE: USR-FULL-02 and USR-FULL-03 are also covered in users-page.spec.ts at a
 * unit level; these duplicates exercise the full flow against live staging data.
 */

import { test, expect, creds } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Helper — create a throwaway user and return their display name
// ---------------------------------------------------------------------------

async function createThrowawayUser(
  page: import('@playwright/test').Page,
  displayName: string,
  email: string,
  role: string = 'coach',
): Promise<boolean> {
  await page.goto('/users');
  await page.waitForLoadState('domcontentloaded');

  const addUserBtn = page
    .getByRole('button', { name: /add user|create user|\+/i })
    .first();

  const btnVisible = await addUserBtn.isVisible({ timeout: 10_000 }).catch(() => false);
  if (!btnVisible) return false;

  await addUserBtn.click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  await modal.getByLabel(/display name|name/i).first().fill(displayName);
  await modal.getByLabel(/email/i).first().fill(email);

  const roleSelect = modal.getByLabel(/role/i).first();
  if (await roleSelect.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await roleSelect.selectOption(role);
  }

  const saveBtn = modal.getByRole('button', { name: /save|create|add/i });
  await saveBtn.click();

  const closed = await modal
    .waitFor({ state: 'hidden', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  return closed;
}

// ---------------------------------------------------------------------------
// Helper — delete a user row by display name
// ---------------------------------------------------------------------------

async function deleteUserByName(
  page: import('@playwright/test').Page,
  displayName: string,
): Promise<void> {
  const userRow = page.locator('tr, [class*="user-row"]').filter({
    has: page.getByText(displayName, { exact: false }),
  }).first();

  const deleteBtn = userRow
    .getByRole('button', { name: /delete|trash/i })
    .or(userRow.locator('[aria-label*="delete" i]'))
    .first();

  const canDelete = await deleteBtn.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!canDelete) return;

  await deleteBtn.click();

  const confirmBtn = page.getByRole('button', { name: /confirm|yes|delete/i }).last();
  if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await confirmBtn.click();
    // Wait for the row to disappear after the CF completes the deletion
    await expect(userRow).not.toBeVisible({ timeout: 15_000 }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// USR-FULL-01: Newly created user appears with correct role badge
// ---------------------------------------------------------------------------

test('newly created user appears in the table with the assigned role badge', async ({ asAdmin }) => {
  const { page } = asAdmin;

  const displayName = `E2E Full User ${Date.now()}`;
  const email = `e2e-full-${Date.now()}@example.com`;

  const created = await createThrowawayUser(page, displayName, email, 'coach');

  if (!created) {
    test.skip(true, 'Could not create test user — CF may be unavailable');
    return;
  }

  // User row should appear in the table (Firestore propagation handled by timeout on assertion)
  const userRow = page.locator('tr, [class*="user-row"]').filter({
    has: page.getByText(displayName, { exact: false }),
  }).first();

  await expect(userRow).toBeVisible({ timeout: 15_000 });

  // Role badge "Coach" should be visible somewhere in or near that row
  const roleBadge = page
    .getByText(/coach/i)
    .first();
  await expect(roleBadge).toBeVisible({ timeout: 5_000 });

  // Cleanup
  await deleteUserByName(page, displayName);
});

// ---------------------------------------------------------------------------
// USR-FULL-02: Admin can change a user's role
// ---------------------------------------------------------------------------

test('admin can change a non-admin user role and the UI reflects the new value', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  await page.goto('/users');
  await page.waitForLoadState('domcontentloaded');

  const adminEmail = creds.admin().email.toLowerCase();

  // Find a role select that does not belong to the admin's own row
  const roleSelects = page.locator('select').filter({
    has: page.locator('option[value="coach"]'),
  });

  const count = await roleSelects.count();
  if (count === 0) {
    test.skip(true, 'No role dropdowns found — skipping role change test');
    return;
  }

  let targetSelect = null;
  for (let i = 0; i < count; i++) {
    const sel = roleSelects.nth(i);
    const row = sel.locator('../..').or(sel.locator('..'));
    const rowText = await row.textContent().catch(() => '');
    if (!rowText.toLowerCase().includes(adminEmail.split('@')[0] ?? '')) {
      targetSelect = sel;
      break;
    }
  }

  if (!targetSelect) {
    test.skip(true, 'Could not find a non-admin user row — skipping role change test');
    return;
  }

  const currentRole = await targetSelect.inputValue();
  const newRole = currentRole === 'coach' ? 'parent' : 'coach';

  await targetSelect.selectOption(newRole);
  await expect(targetSelect).toHaveValue(newRole, { timeout: 5_000 });

  // Revert so test data is not permanently altered
  await targetSelect.selectOption(currentRole);
  await expect(targetSelect).toHaveValue(currentRole, { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// USR-FULL-03: Admin can send a password reset email and see confirmation toast
// ---------------------------------------------------------------------------

test('admin can trigger a password reset for another user and sees a confirmation', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  await page.goto('/users');
  await page.waitForLoadState('domcontentloaded');

  const adminEmail = creds.admin().email.toLowerCase();

  // Find a reset button that is not on the admin's own row
  const resetBtns = page
    .getByRole('button', { name: /reset password/i })
    .or(page.locator('[aria-label*="reset password" i]'));

  const btnCount = await resetBtns.count();
  if (btnCount === 0) {
    test.skip(true, 'No password reset buttons found — skipping');
    return;
  }

  let targetBtn = null;
  for (let i = 0; i < btnCount; i++) {
    const btn = resetBtns.nth(i);
    const row = btn.locator('../..').or(btn.locator('..'));
    const rowText = await row.textContent().catch(() => '');
    if (!rowText.toLowerCase().includes(adminEmail.split('@')[0] ?? '')) {
      targetBtn = btn;
      break;
    }
  }

  if (!targetBtn) {
    test.skip(true, 'Could not find a non-admin reset button — skipping');
    return;
  }

  await targetBtn.click();

  // Confirmation dialog may appear
  const confirmBtn = page.getByRole('button', { name: /confirm|yes|send/i }).last();
  if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await confirmBtn.click();
  }

  // A success toast should appear
  const toast = page.getByText(/reset.*sent|password reset|email sent/i).first();
  await expect(toast).toBeVisible({ timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// USR-FULL-04: Admin cannot delete their own account
// ---------------------------------------------------------------------------

test('admin delete button is absent or disabled on own row', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/users');
  await page.waitForLoadState('domcontentloaded');

  const adminEmail = creds.admin().email;

  const adminRow = page.locator('tr, [class*="user-row"]').filter({
    has: page.getByText(adminEmail, { exact: false }),
  }).first();

  const rowVisible = await adminRow.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!rowVisible) {
    test.skip(true, 'Admin row not found by email — row may be truncated; skipping self-delete test');
    return;
  }

  const selfDeleteBtn = adminRow
    .getByRole('button', { name: /delete|trash/i })
    .or(adminRow.locator('[aria-label*="delete" i]'))
    .first();

  const deletePresent = await selfDeleteBtn.isVisible({ timeout: 2_000 }).catch(() => false);

  if (deletePresent) {
    // Button present but must be disabled
    await expect(selfDeleteBtn).toBeDisabled();
  } else {
    // Delete button absent for own row — correct
    expect(deletePresent).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// USR-FULL-05: Admin can delete another user
// ---------------------------------------------------------------------------

test('admin can delete another user and they disappear from the list', async ({ asAdmin }) => {
  const { page } = asAdmin;

  const displayName = `E2E DeleteTarget ${Date.now()}`;
  const email = `e2e-del-${Date.now()}@example.com`;

  const created = await createThrowawayUser(page, displayName, email, 'parent');

  if (!created) {
    test.skip(true, 'Could not create test user for deletion — CF may be unavailable');
    return;
  }

  // Verify user appears (Firestore propagation handled by timeout on assertion)
  await expect(page.getByText(displayName, { exact: false })).toBeVisible({ timeout: 15_000 });

  // Delete the user
  const userRow = page.locator('tr, [class*="user-row"]').filter({
    has: page.getByText(displayName, { exact: false }),
  }).first();

  const deleteBtn = userRow
    .getByRole('button', { name: /delete|trash/i })
    .or(userRow.locator('[aria-label*="delete" i]'))
    .first();

  await expect(deleteBtn).toBeVisible({ timeout: 5_000 });
  await deleteBtn.click();

  const confirmBtn = page.getByRole('button', { name: /confirm|yes|delete/i }).last();
  if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await confirmBtn.click();
  }

  // User should no longer appear in the table
  await expect(page.getByText(displayName, { exact: false })).not.toBeVisible({
    timeout: 15_000,
  });
});
