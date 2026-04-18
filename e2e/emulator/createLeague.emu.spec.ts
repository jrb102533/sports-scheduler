/**
 * @emu @lm — League Manager creates a league (Phase 3c)
 *
 * Happy-path: LM navigates to /leagues, clicks "New League", fills in a name,
 * and confirms the new league appears in the list.
 *
 * Ported from the create-league flow in e2e/league-manager.spec.ts
 * (`createLeague` helper + LM-LGE-01 acceptance criteria).
 *
 * No CF call is made — league creation writes directly to Firestore.
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';

test('@emu @lm LM can create a new league and it appears in the leagues list', async ({ lmPage }) => {
  const page = lmPage;
  const leagueName = `Emu League ${Date.now()}`;

  await page.goto('/leagues');
  await page.waitForLoadState('domcontentloaded');

  const newLeagueBtn = page.getByRole('button', { name: /new league|\+ league|\+/i }).first();
  await expect(newLeagueBtn).toBeVisible({ timeout: 10_000 });
  await newLeagueBtn.click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  const nameInput = modal.getByLabel(/league name|name/i).first();
  await expect(nameInput).toBeVisible({ timeout: 5_000 });
  await nameInput.fill(leagueName);

  const saveBtn = modal.getByRole('button', { name: /save|create/i });
  await saveBtn.click();

  // Modal closes on success.
  await expect(modal).not.toBeVisible({ timeout: 10_000 });

  // New league must appear in the list.
  await expect(page.getByText(leagueName, { exact: false })).toBeVisible({ timeout: 10_000 });
});
