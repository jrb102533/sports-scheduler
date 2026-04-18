/**
 * @emu @profile — Admin profile update (Phase 3a)
 *
 * Ported from e2e/profile.spec.ts line 96:
 *   "admin can update first and last name and see the saved confirmation"
 *
 * NOTE: This test is currently FAILING on staging (Save Changes button stays
 * disabled after filling fields — tracked as a known bug). The emulator spec
 * may surface the same bug against emulator Firestore rules. A failure here is
 * a legitimate finding — it confirms the bug is rules-level or data-model-level,
 * not a staging environment artifact.
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
  //
  // NOTE: The Save Changes button remains disabled after a successful save when the
  // form is immediately re-filled — this is a known bug (confirmed on both staging
  // and emulator). We reload the page to reset the form's dirty-detection state
  // before performing the restore save, which is a workaround, not a fix.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(firstNameInput).toBeVisible({ timeout: 10_000 });
  await firstNameInput.clear();
  await firstNameInput.fill(originalFirst || 'Emu Admin');
  await lastNameInput.clear();
  await lastNameInput.fill(originalLast || 'Admin');
  await page.getByRole('button', { name: /save changes/i }).click();
  // Wait for the restore save to complete before the test tears down.
  await expect(page.getByRole('button', { name: /saved!/i })).toBeVisible({ timeout: 15_000 });
});
