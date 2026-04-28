/**
 * @emu @lm — LM adds a team to a league (Phase 3c)
 *
 * Happy-path: LM opens the seeded `emu-league`, switches to the Teams tab,
 * clicks "Add Team", which opens the Edit League modal containing team
 * checkboxes. Selects `emu-team-b`, clicks Save, and confirms the team
 * appears in the Teams tab list.
 *
 * Note on UI: LeagueDetailPage's "Add Team" button opens `setEditOpen(true)`
 * — i.e. the Edit League modal with an "Assign Teams" checkbox section.
 * There is no separate TeamPicker.
 *
 * Uses the seeded league (EMU_IDS.leagueId = 'emu-league') to avoid creating
 * additional fixtures.
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';
import { EMU_IDS } from '../seed-emulator.js';

// Seeded team name to look for in the picker.
const TEAM_B_NAME = 'Emu Team B';

test('@emu @lm LM can open the Teams tab on a league and add a team', async ({ lmPage }) => {
  const page = lmPage;

  // Navigate directly to the seeded league detail page to avoid matching
  // "Emu League" text in the sidebar role badge (which is not a nav link).
  await page.goto(`/leagues/${EMU_IDS.leagueId}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForURL(/\/leagues\/.+/, { timeout: 10_000 });

  // Switch to the Teams tab. Wait explicitly for the tab to render —
  // LeagueDetailPage shows a "Loading league…" placeholder until the league
  // store hydrates, and the click would otherwise race the subscription.
  const teamsTab = page.getByRole('tab', { name: /teams/i });
  await expect(teamsTab).toBeVisible({ timeout: 30_000 });
  await teamsTab.click();
  await page.waitForLoadState('domcontentloaded');

  // "Add Team" — opens the Edit League modal (with the Assign Teams checkbox
  // section). Use the exact label to avoid matching "Add Co-Manager" etc.
  const addTeamBtn = page.getByRole('button', { name: /^add team$/i }).first();
  await expect(addTeamBtn).toBeVisible({ timeout: 5_000 });
  await addTeamBtn.click();

  // Edit League modal opens.
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  // Toggle the Team B checkbox if it isn't already checked.
  const teamBCheckbox = modal.getByRole('checkbox', { name: TEAM_B_NAME });
  await expect(teamBCheckbox).toBeVisible({ timeout: 5_000 });
  if (!(await teamBCheckbox.isChecked())) {
    await teamBCheckbox.click();
  }

  // Save closes the modal and persists the assignment.
  const saveBtn = modal.getByRole('button', { name: /^save$/i });
  await saveBtn.click();
  await expect(modal).not.toBeVisible({ timeout: 10_000 });

  // The team must appear on the Teams tab.
  await expect(page.getByText(TEAM_B_NAME, { exact: false })).toBeVisible({ timeout: 10_000 });
});
