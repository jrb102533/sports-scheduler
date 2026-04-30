/**
 * @emu @schedule @admin — Schedule Wizard surface (slice 2/3 of league-manager.spec.ts migration)
 *
 * Covers the integration boundary between SeasonDashboard and ScheduleWizardModal.
 * The wizard's internal validation logic (date ranges, match duration, games per
 * team, venue config, blackout dates) is exhaustively unit-tested in
 * src/test/ScheduleWizardModal.test.tsx (103 cases) — we don't duplicate that here.
 *
 * Covers:
 *   WIZ-01: Generate Schedule button on SeasonDashboard opens the wizard
 *   WIZ-02: Mode picker shows Season / Practice / Playoff options
 *   WIZ-03: Cancel button closes the wizard cleanly
 *
 * Tests in this PR all use admin (which bypasses RequiresPro per useIsPro)
 * and only OPEN the wizard — they never click Generate Schedule, so no
 * events are created and the seed stays clean for other specs.
 *
 * Note: many staging wizard tests (`schedule wizard opens from league detail
 * page`, etc.) were written when the wizard button lived on LeagueDetailPage.
 * It has since moved to SeasonDashboard, so those tests don't translate 1:1
 * and aren't migrated here. The remaining staging coverage (LM-SEA-03,
 * LM-SEA-04) lands in slice 3 alongside the staging file deletion.
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';
import { EMU_IDS } from '../seed-emulator.js';

async function gotoSeasonDashboard(page: import('@playwright/test').Page) {
  await page.goto(`/leagues/${EMU_IDS.leagueId}/seasons/${EMU_IDS.seasonId}`);
  await page.waitForLoadState('domcontentloaded');
  // data-hydrated only covers team + event stores; SeasonDashboard fetches its
  // own season state lazily via useSeasonStore.fetchSeasons. Wait for the season
  // name heading to confirm season load completed before asserting on the page.
  await page.waitForSelector('body[data-hydrated="true"]', { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: /emu season/i }))
    .toBeVisible({ timeout: 30_000 });
}

async function openWizard(page: import('@playwright/test').Page) {
  await gotoSeasonDashboard(page);

  // The Generate Schedule button is gated by `canGenerate` (requires venues
  // + feasibility) and `leagueTeams.length >= 2`. The seed has emu-venue and
  // teams A + B, so both gates pass.
  const generateBtn = page.getByRole('button', { name: /^generate schedule$/i });
  await expect(generateBtn).toBeVisible({ timeout: 10_000 });
  await expect(generateBtn).toBeEnabled({ timeout: 5_000 });
  await generateBtn.click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });
  return modal;
}

// ---------------------------------------------------------------------------
// WIZ-01
// ---------------------------------------------------------------------------

test('@emu @schedule @admin WIZ-01: Generate Schedule opens the wizard modal', async ({
  adminPage: page,
}) => {
  const modal = await openWizard(page);
  // Modal is visible — the dialog role + a Cancel button is sufficient
  await expect(modal.getByRole('button', { name: /cancel/i })).toBeVisible({ timeout: 3_000 });
});

// ---------------------------------------------------------------------------
// WIZ-02
// ---------------------------------------------------------------------------

test('@emu @schedule @admin WIZ-02: mode picker shows Season / Practice / Playoff', async ({
  adminPage: page,
}) => {
  const modal = await openWizard(page);

  await expect(modal.getByRole('button', { name: /^season\b/i })).toBeVisible({ timeout: 5_000 });
  await expect(modal.getByRole('button', { name: /^practice\b/i })).toBeVisible({ timeout: 3_000 });
  await expect(modal.getByRole('button', { name: /playoff/i })).toBeVisible({ timeout: 3_000 });
});

// ---------------------------------------------------------------------------
// WIZ-03
// ---------------------------------------------------------------------------

test('@emu @schedule @admin WIZ-03: Cancel closes the wizard without crashing the page', async ({
  adminPage: page,
}) => {
  const modal = await openWizard(page);

  await modal.getByRole('button', { name: /cancel/i }).click();

  await expect(modal).not.toBeVisible({ timeout: 5_000 });
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('main')).toBeVisible();
});
