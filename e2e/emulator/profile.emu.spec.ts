/**
 * @emu @profile — Admin profile update (Phase 3a)
 *
 * Ported from e2e/profile.spec.ts line 96:
 *   "admin can update first and last name and see the saved confirmation"
 *
 * Issue #475 fix: ProfilePage now tracks savedDisplayName locally so the dirty
 * check no longer races the async profile.displayName refresh. The restore
 * save below works in-place without a page reload.
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';

test('@emu @profile admin can update first and last name and see the saved confirmation', async ({ adminPage }) => {
  const page = adminPage;

  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');

  const firstNameInput = page.getByLabel('First Name');
  const lastNameInput = page.getByLabel('Last Name');

  // Wait for the form to be populated from Firestore before reading values.
  await expect(firstNameInput).toBeVisible({ timeout: 10_000 });

  const originalFirst = await firstNameInput.inputValue();
  const originalLast = await lastNameInput.inputValue();

  // Update to a unique throwaway name.
  const stamp = Date.now();
  await firstNameInput.clear();
  await firstNameInput.fill(`Emu${stamp}`);
  await lastNameInput.clear();
  await lastNameInput.fill('TestUser');

  const saveBtn = page.getByRole('button', { name: /save changes/i });
  await saveBtn.click();

  // Button label transitions to "Saved!" on success.
  await expect(page.getByRole('button', { name: /saved!/i })).toBeVisible({ timeout: 15_000 });

  // Restore the original values so the seeded user stays deterministic for
  // subsequent test runs.
  await firstNameInput.clear();
  await firstNameInput.fill(originalFirst || 'Emu Admin');
  await lastNameInput.clear();
  await lastNameInput.fill(originalLast || 'Admin');
  await page.getByRole('button', { name: /save changes/i }).click();
  // Wait for the restore save to complete before the test tears down.
  await expect(page.getByRole('button', { name: /saved!/i })).toBeVisible({ timeout: 15_000 });
});
