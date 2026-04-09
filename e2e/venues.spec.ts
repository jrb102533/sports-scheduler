/**
 * Venues page UAT — CRUD flows for venue management
 *
 * Covers:
 *   VEN-01: Admin can navigate to /venues
 *   VEN-02: Admin can open the New Venue modal and see required fields (Name, Address)
 *   VEN-03: Admin can create a venue and it appears in the venues list
 *   VEN-04: Admin can edit a venue name and the change persists
 *   VEN-05: Admin can delete a venue and it disappears from the list
 *   VEN-06: Parent/player cannot see edit or delete controls on venue cards
 *           (venues route is accessible but edit/delete buttons are admin-only)
 *
 * Tests that mutate data create uniquely-named venues and clean up after themselves.
 * The VenuesPage uses soft-delete (`softDeleteVenue`) so the delete confirmation
 * label is "Remove" rather than "Delete".
 */

import { test, expect } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test('admin can navigate to /venues', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/venues');

  // Should not redirect to /login
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
});

test('venues page shows New Venue button for admin', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/venues');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByRole('button', { name: /new venue/i })).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Add Venue modal — required fields
// ---------------------------------------------------------------------------

test('admin can open the Add Venue modal and see Name and Address fields', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/venues');
  await page.waitForLoadState('domcontentloaded');

  await page.getByRole('button', { name: /new venue/i }).click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  // VenueFormModal renders a "Name" input and an "Address" input
  await expect(modal.getByLabel('Name')).toBeVisible();
  await expect(modal.getByLabel('Address')).toBeVisible();
});

test('venue form modal shows Surface Type toggle buttons', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/venues');
  await page.waitForLoadState('domcontentloaded');

  await page.getByRole('button', { name: /new venue/i }).click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  // Indoor / Outdoor toggle buttons are always rendered
  await expect(modal.getByRole('button', { name: 'Outdoor' })).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Indoor' })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Create venue
// ---------------------------------------------------------------------------

test('@smoke admin can create a venue and it appears in the list', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/venues');
  await page.waitForLoadState('domcontentloaded');

  const venueName = `E2E Venue ${Date.now()}`;

  await page.getByRole('button', { name: /new venue/i }).click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  await modal.getByLabel('Name').fill(venueName);
  await modal.getByLabel('Address').fill('123 Test Street, Testville, TS 00001');

  await modal.getByRole('button', { name: /create venue/i }).click();

  // Modal should close after save
  await expect(modal).not.toBeVisible({ timeout: 15_000 });

  // Venue card should appear in the list
  await expect(page.getByText(venueName, { exact: false })).toBeVisible({ timeout: 10_000 });

  // ---------------------------------------------------------------------------
  // Cleanup: delete the venue we just created
  // ---------------------------------------------------------------------------
  const venueCard = page.locator('[class*="rounded"]').filter({
    has: page.getByText(venueName, { exact: false }),
  }).first();

  const deleteBtn = venueCard
    .locator('button[title*="Delete venue" i]')
    .or(venueCard.locator('button[title*="delete" i]'))
    .first();

  const canDelete = await deleteBtn.isVisible({ timeout: 3_000 }).catch(() => false);
  if (canDelete) {
    await deleteBtn.click();
    // ConfirmDialog: confirm label is "Remove"
    const confirmBtn = page.getByRole('button', { name: /remove|confirm|yes/i }).last();
    if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    await page.waitForTimeout(2_000);
  }
});

// ---------------------------------------------------------------------------
// Edit venue
// ---------------------------------------------------------------------------

test('admin can edit a venue name and the update is reflected', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/venues');
  await page.waitForLoadState('domcontentloaded');

  const originalName = `E2E EditVenue ${Date.now()}`;
  const updatedName = `${originalName} UPDATED`;

  // Create a throwaway venue first
  await page.getByRole('button', { name: /new venue/i }).click();
  let modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });
  await modal.getByLabel('Name').fill(originalName);
  await modal.getByLabel('Address').fill('456 Edit Ave, Edittown, ET 00002');
  await modal.getByRole('button', { name: /create venue/i }).click();
  await expect(modal).not.toBeVisible({ timeout: 15_000 });

  // Find the venue card and click the Edit (Pencil) button
  const venueCard = page.locator('[class*="rounded"]').filter({
    has: page.getByText(originalName, { exact: false }),
  }).first();

  await expect(venueCard).toBeVisible({ timeout: 10_000 });

  const editBtn = venueCard
    .locator('button[title*="Edit venue" i]')
    .or(venueCard.locator('button[title*="edit" i]'))
    .first();

  await expect(editBtn).toBeVisible({ timeout: 5_000 });
  await editBtn.click();

  // Edit Venue modal opens
  modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  // Update the name
  const nameInput = modal.getByLabel('Name');
  await nameInput.clear();
  await nameInput.fill(updatedName);

  await modal.getByRole('button', { name: /save changes/i }).click();
  await expect(modal).not.toBeVisible({ timeout: 15_000 });

  // Updated name should appear in the list
  await expect(page.getByText(updatedName, { exact: false })).toBeVisible({ timeout: 10_000 });

  // Cleanup
  const updatedCard = page.locator('[class*="rounded"]').filter({
    has: page.getByText(updatedName, { exact: false }),
  }).first();
  const deleteBtn = updatedCard
    .locator('button[title*="Delete venue" i]')
    .or(updatedCard.locator('button[title*="delete" i]'))
    .first();
  if (await deleteBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await deleteBtn.click();
    const confirmBtn = page.getByRole('button', { name: /remove|confirm|yes/i }).last();
    if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    await page.waitForTimeout(1_500);
  }
});

// ---------------------------------------------------------------------------
// Delete venue
// ---------------------------------------------------------------------------

test('admin can delete a venue and it disappears from the list', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/venues');
  await page.waitForLoadState('domcontentloaded');

  const venueName = `E2E DeleteVenue ${Date.now()}`;

  // Create a throwaway venue
  await page.getByRole('button', { name: /new venue/i }).click();
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });
  await modal.getByLabel('Name').fill(venueName);
  await modal.getByLabel('Address').fill('789 Delete Blvd, Deleteville, DV 00003');
  await modal.getByRole('button', { name: /create venue/i }).click();
  await expect(modal).not.toBeVisible({ timeout: 15_000 });

  // Confirm it appears
  await expect(page.getByText(venueName, { exact: false })).toBeVisible({ timeout: 10_000 });

  // Find the venue card and click delete
  const venueCard = page.locator('[class*="rounded"]').filter({
    has: page.getByText(venueName, { exact: false }),
  }).first();

  const deleteBtn = venueCard
    .locator('button[title*="Delete venue" i]')
    .or(venueCard.locator('button[title*="delete" i]'))
    .first();

  await expect(deleteBtn).toBeVisible({ timeout: 5_000 });
  await deleteBtn.click();

  // ConfirmDialog with "Remove" label (soft delete)
  const confirmBtn = page.getByRole('button', { name: /remove/i }).last();
  await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
  await confirmBtn.click();

  // Venue should no longer appear in the list
  await expect(page.getByText(venueName, { exact: false })).not.toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Access control — parent/player should not see edit/delete controls
// ---------------------------------------------------------------------------

test('parent cannot see venue edit or delete buttons', async ({ asParent }) => {
  const { page } = asParent;

  await page.goto('/venues');
  await page.waitForLoadState('domcontentloaded');

  // Parent can reach the page (it is not guarded behind RoleGuard in the router)
  await expect(page).not.toHaveURL(/\/login/);

  // But edit and delete buttons on venue cards should not be present
  const editBtns = page.locator('button[title*="Edit venue" i]');
  const deleteBtns = page.locator('button[title*="Delete venue" i]');

  const editCount = await editBtns.count();
  const deleteCount = await deleteBtns.count();

  // If there are no venues at all, that is also acceptable (empty state)
  const emptyState = page.getByText(/no venues yet/i);
  const hasEmpty = await emptyState.isVisible({ timeout: 2_000 }).catch(() => false);

  if (!hasEmpty) {
    // Venues exist — parent should not see edit/delete controls
    expect(editCount).toBe(0);
    expect(deleteCount).toBe(0);
  } else {
    // No venues — nothing to assert; the page rendered without crashing
    expect(hasEmpty).toBe(true);
  }
});
