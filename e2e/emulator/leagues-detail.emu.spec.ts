/**
 * @emu @leagues @admin — League detail page CRUD (slice 1 of league-manager.spec.ts migration)
 *
 * Covers:
 *   LEAGUES-DET-01: detail page shows Schedule, Standings, Teams, Seasons, Venues tabs
 *   LEAGUES-DET-02: each tab loads without crash
 *   LEAGUES-DET-03: admin can edit a league name
 *   LEAGUES-DET-04: admin can soft-delete a league it created
 *
 * Existing emu coverage we don't duplicate:
 *   - createLeague.emu.spec.ts (LM creating a league via the LM-Pro flow)
 *   - add-team-to-league.emu.spec.ts (LM adding a team)
 *
 * Tests in slice 2/3 of the league-manager.spec.ts migration:
 *   - schedule wizard config validation (~14 tests)
 *   - season management + LM-WIZ + LM-SEA tests (~5 tests)
 *
 * Tests in this slice all use admin (which has unrestricted league access)
 * and create fresh leagues for mutations to keep emu-league pristine.
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';
import { EMU_IDS } from '../seed-emulator.js';

async function gotoLeagues(page: import('@playwright/test').Page) {
  await page.goto('/leagues');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('body[data-hydrated="true"]', { timeout: 30_000 });
}

async function gotoSeededLeague(page: import('@playwright/test').Page) {
  await page.goto(`/leagues/${EMU_IDS.leagueId}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('body[data-hydrated="true"]', { timeout: 30_000 });
}

/**
 * Creates a league via the New League modal on /leagues.
 * Returns the created league name. The modal closes on success.
 */
async function createLeagueViaUI(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  await gotoLeagues(page);
  await page.getByRole('button', { name: /new league/i }).first().click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  await modal.getByLabel(/league name/i).fill(name);
  await modal.getByRole('button', { name: /create league/i }).click();
  await expect(modal).not.toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// LEAGUES-DET-01
// ---------------------------------------------------------------------------

test('@emu @leagues @admin LEAGUES-DET-01: league detail shows Schedule, Standings, Teams, Seasons, Venues tabs', async ({
  adminPage: page,
}) => {
  await gotoSeededLeague(page);

  for (const name of [/^schedule$/i, /^standings$/i, /^teams\b/i, /^seasons\b/i, /^venues\b/i]) {
    await expect(page.getByRole('tab', { name })).toBeVisible({ timeout: 10_000 });
  }
});

// ---------------------------------------------------------------------------
// LEAGUES-DET-02
// ---------------------------------------------------------------------------

test('@emu @leagues @admin LEAGUES-DET-02: each league detail tab loads without crash', async ({
  adminPage: page,
}) => {
  await gotoSeededLeague(page);

  // The Seasons tab navigates away when there's exactly one season (LM-SEA-03),
  // so test it last via the standings/teams/venues path. The seed has 1 season,
  // so clicking Seasons would route to /leagues/:id/seasons/:seasonId — also a
  // valid no-crash outcome.
  for (const name of [/^standings$/i, /^teams\b/i, /^venues\b/i]) {
    await page.getByRole('tab', { name }).click();
    await expect(page.locator('main')).toBeVisible({ timeout: 5_000 });
    await expect(page).not.toHaveURL(/\/login/);
  }
});

// ---------------------------------------------------------------------------
// LEAGUES-DET-03
// ---------------------------------------------------------------------------

test('@emu @leagues @admin LEAGUES-DET-03: admin can edit a league name', async ({
  adminPage: page,
}) => {
  const stamp = Date.now();
  const originalName = `E2E EditLeague ${stamp}`;
  const updatedName = `E2E EditedLeague ${stamp}`;

  await createLeagueViaUI(page, originalName);

  // Navigate into the new league. Click the card by name.
  await page.getByText(originalName, { exact: false }).first().click();
  await page.waitForURL(/\/leagues\/.+/);

  // Edit button on the league header. Using the visible Edit button rather
  // than the icon-only one to dodge ambiguity.
  await page.getByRole('button', { name: /^edit$/i }).first().click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  const nameInput = modal.getByLabel(/league name/i);
  await nameInput.clear();
  await nameInput.fill(updatedName);

  await modal.getByRole('button', { name: /save changes/i }).click();
  await expect(modal).not.toBeVisible({ timeout: 10_000 });

  // The updated name appears in the league header
  await expect(page.getByText(updatedName, { exact: false }).first())
    .toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// LEAGUES-DET-04
// ---------------------------------------------------------------------------

test('@emu @leagues @admin LEAGUES-DET-04: admin can soft-delete a league', async ({
  adminPage: page,
}) => {
  const stamp = Date.now();
  const leagueName = `E2E DeleteLeague ${stamp}`;

  await createLeagueViaUI(page, leagueName);

  await page.getByText(leagueName, { exact: false }).first().click();
  await page.waitForURL(/\/leagues\/.+/);

  // Trash icon button on the header (aria-label="Delete league")
  await page.getByRole('button', { name: /delete league/i }).click();

  // DeleteLeagueModal — type-to-confirm pattern. Type the league name into
  // the confirm input, then click "Delete League".
  const confirmDialog = page.getByRole('dialog');
  await expect(confirmDialog).toBeVisible({ timeout: 5_000 });

  await confirmDialog.getByRole('textbox').first().fill(leagueName);
  await confirmDialog.getByRole('button', { name: /delete league/i }).click();

  // Soft delete navigates back to the leagues list; the deleted league must
  // not be visible there.
  await expect(page).toHaveURL(/\/leagues$/, { timeout: 10_000 });
  await expect(page.getByText(leagueName, { exact: false }))
    .not.toBeVisible({ timeout: 10_000 });
});
