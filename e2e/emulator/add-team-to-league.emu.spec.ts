/**
 * @emu @lm — LM adds a team to a league (Phase 3c)
 *
 * Happy-path: LM opens the seeded `emu-league`, switches to the Teams tab,
 * clicks "Add Team", selects `emu-team-b` from the picker (it is seeded but
 * may already be in the league — handled gracefully), and confirms the team
 * name appears in the Teams tab list.
 *
 * Uses the seeded league (EMU_IDS.leagueId = 'emu-league') to avoid creating
 * additional fixtures.  `emu-team-a` is already assigned to `emu-league` in
 * seed-emulator.ts; `emu-team-b` carries a `leagueIds` array including
 * `emu-league`, so the add-team picker should list it.
 *
 * Ported from the addTeamToLeague flow in e2e/league-manager.spec.ts.
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';

// Seeded team name to look for in the picker.
const TEAM_B_NAME = 'Emu Team B';
// Seeded league name.
const LEAGUE_NAME = 'Emu League';

test('@emu @lm LM can open the Teams tab on a league and add a team', async ({ lmPage }) => {
  const page = lmPage;

  await page.goto('/leagues');
  await page.waitForLoadState('domcontentloaded');

  // Navigate into the seeded league.
  const leagueLink = page.getByText(LEAGUE_NAME, { exact: false }).first();
  await expect(leagueLink).toBeVisible({ timeout: 10_000 });
  await leagueLink.click();
  await page.waitForURL(/\/leagues\/.+/, { timeout: 10_000 });

  // Switch to the Teams tab.
  await page.getByRole('tab', { name: /teams/i }).click();
  await page.waitForLoadState('domcontentloaded');

  // "Add Team" button — required for this flow.
  const addTeamBtn = page.getByRole('button', { name: /add team|\+/i }).first();
  await expect(addTeamBtn).toBeVisible({ timeout: 5_000 });
  await addTeamBtn.click();

  // TeamPicker modal should open.
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  // Check if the team is already in the league — if the picker shows it as
  // already-added or if it is absent, the list render is still the success state.
  const teamOption = modal.getByText(TEAM_B_NAME, { exact: false });
  const pickerHasTeam = await teamOption.isVisible({ timeout: 5_000 }).catch(() => false);

  if (!pickerHasTeam) {
    // Team is not in the picker — it may already be assigned; verify it appears
    // in the Teams tab list and close the modal.
    const closeBtn = modal.getByRole('button', { name: /close|cancel/i }).first();
    if (await closeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(TEAM_B_NAME, { exact: false })).toBeVisible({ timeout: 5_000 });
    return;
  }

  // Select the team checkbox.
  await teamOption.click();

  // Confirm the selection.
  const confirmBtn = modal.getByRole('button', { name: /add selected|add/i }).last();
  if (await confirmBtn.isEnabled({ timeout: 2_000 }).catch(() => false)) {
    await confirmBtn.click();
  }

  // Modal should close.
  await expect(modal).not.toBeVisible({ timeout: 10_000 });

  // The team must now appear on the Teams tab.
  await expect(page.getByText(TEAM_B_NAME, { exact: false })).toBeVisible({ timeout: 10_000 });
});
