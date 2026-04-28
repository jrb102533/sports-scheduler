/**
 * @emu @admin — Admin adds a player to emu-team-a roster (Phase 3c)
 *
 * Happy-path: admin navigates to the seeded `emu-team-a` detail page,
 * opens the Roster tab, clicks "Add Player", fills in a unique first/last
 * name, and confirms the player row appears in the roster list.
 *
 * No CF call is made — player creation writes directly to Firestore.
 *
 * Ported from the add-player flow in e2e/admin.spec.ts
 * (EVT-LC-05 roster setup + "admin can open the Add Player form" test).
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';
import { EMU_IDS } from '../seed-emulator.js';

test('@emu @admin admin can add a player to emu-team-a and the player appears in the roster', async ({ adminPage }) => {
  const page = adminPage;
  const stamp = Date.now();
  const firstName = `EmuPlayer${stamp}`;
  const lastName = 'Roster';

  // Navigate directly to the seeded team.
  await page.goto(`/teams/${EMU_IDS.teamAId}`);
  await page.waitForLoadState('domcontentloaded');

  // Switch to the Roster tab.
  const rosterTab = page.getByRole('tab', { name: /roster/i });
  await expect(rosterTab).toBeVisible({ timeout: 30_000 });
  await rosterTab.click();

  // Add Player button.
  const addBtn = page.getByRole('button', { name: /add player/i });
  await expect(addBtn).toBeVisible({ timeout: 5_000 });
  await addBtn.click();

  // PlayerForm modal.
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  await modal.getByLabel('First Name').fill(firstName);
  await modal.getByLabel('Last Name').fill(lastName);

  const saveBtn = modal.getByRole('button', { name: /save|add player/i });
  await saveBtn.click();

  // Modal closes on success.
  await expect(modal).not.toBeVisible({ timeout: 30_000 });

  // Player row must appear in the roster list.
  await expect(
    page.getByText(new RegExp(`${firstName}.*${lastName}|${lastName}.*${firstName}`, 'i')),
  ).toBeVisible({ timeout: 30_000 });
});
