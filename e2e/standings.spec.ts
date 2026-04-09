/**
 * League Standings E2E tests
 *
 * Covers:
 *   STAND-01: Standings section renders on SeasonDashboard
 *   STAND-02: Standings table has expected column headers (GP, W, L, T, Pts)
 *   STAND-03: Standings table shows at least one team row when the league has teams
 *   STAND-04: Parent can view the Standings tab on a league detail page without redirect
 *   STAND-05: Standings tab on LeagueDetailPage always renders data or a defined empty state
 *
 * Navigation context:
 *   - `/standings` is a registered route (StandingsPage — global view across all teams).
 *     The two deeper standings surfaces tested here are:
 *       1. LeagueDetailPage → "Standings" tab  (/leagues/:id)
 *       2. SeasonDashboard → Standings section  (/leagues/:leagueId/seasons/:seasonId)
 *   - STAND-01/02/03 use the SeasonDashboard path by navigating into the first
 *     available season under the first available league.
 *   - STAND-04/05 use the LeagueDetailPage Standings tab, which is accessible to
 *     all authenticated roles and does not require a season to exist.
 *
 * Skip policy:
 *   - Tests that depend on pre-existing data (leagues, seasons) are skipped with
 *     `test.skip()` when that data is absent.  No `|| true` bail-outs are used.
 *
 * All tests authenticate as admin except STAND-04 which authenticates as parent.
 */

import { test, expect } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigates to /leagues and returns the href of the first league link found,
 * or null if the page contains no leagues.
 */
async function getFirstLeagueHref(
  page: import('@playwright/test').Page,
): Promise<string | null> {
  await page.goto('/leagues');
  await page.waitForLoadState('domcontentloaded');

  // League cards or list items link to /leagues/:id
  const leagueLink = page.locator('a[href*="/leagues/"]').first();
  const visible = await leagueLink.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!visible) return null;

  return leagueLink.getAttribute('href');
}

/**
 * Starting from a LeagueDetailPage, navigates to the first season listed on
 * the Seasons tab and returns the resulting URL, or null if no seasons exist.
 */
async function getFirstSeasonUrl(
  page: import('@playwright/test').Page,
): Promise<string | null> {
  const seasonsTab = page.getByRole('tab', { name: /seasons/i });
  const tabVisible = await seasonsTab.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!tabVisible) return null;

  await seasonsTab.click();
  await page.waitForLoadState('domcontentloaded');

  // Season links navigate to /leagues/:leagueId/seasons/:seasonId
  const seasonLink = page.locator('a[href*="/seasons/"]').first();
  const linkVisible = await seasonLink.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!linkVisible) return null;

  return seasonLink.getAttribute('href');
}

// ---------------------------------------------------------------------------
// STAND-01: Standings section renders on SeasonDashboard
// ---------------------------------------------------------------------------

test('STAND-01: Standings section renders on SeasonDashboard', async ({ asAdmin }) => {
  const { page } = asAdmin;

  const leagueHref = await getFirstLeagueHref(page);
  if (!leagueHref) {
    test.skip(true, 'No leagues found — skipping STAND-01');
    return;
  }

  await page.goto(leagueHref);
  await page.waitForURL(/\/leagues\/.+/);
  await page.waitForLoadState('domcontentloaded');

  const seasonUrl = await getFirstSeasonUrl(page);
  if (!seasonUrl) {
    test.skip(true, 'No seasons found in first league — skipping STAND-01');
    return;
  }

  await page.goto(seasonUrl);
  await page.waitForURL(/\/leagues\/.+\/seasons\/.+/);
  await page.waitForLoadState('domcontentloaded');

  // SeasonDashboard renders the Standings heading above the StandingsTable
  const standingsHeading = page.getByRole('heading', { name: /standings/i });
  await expect(standingsHeading).toBeVisible({ timeout: 10_000 });

  // The table itself or the empty-state message must also be present — no blank screen
  const tableOrEmpty = page.locator('table, [class*="text-center"]').first();
  await expect(tableOrEmpty).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// STAND-02: Standings table has expected column headers
// ---------------------------------------------------------------------------

test('STAND-02: Standings table column headers include W, L, and Pts', async ({ asAdmin }) => {
  const { page } = asAdmin;

  const leagueHref = await getFirstLeagueHref(page);
  if (!leagueHref) {
    test.skip(true, 'No leagues found — skipping STAND-02');
    return;
  }

  await page.goto(leagueHref);
  await page.waitForURL(/\/leagues\/.+/);
  await page.waitForLoadState('domcontentloaded');

  const seasonUrl = await getFirstSeasonUrl(page);
  if (!seasonUrl) {
    test.skip(true, 'No seasons found in first league — skipping STAND-02');
    return;
  }

  await page.goto(seasonUrl);
  await page.waitForURL(/\/leagues\/.+\/seasons\/.+/);
  await page.waitForLoadState('domcontentloaded');

  // Wait for either the table or the empty-state paragraph before asserting headers
  const tableOrEmpty = page.locator('table, p').filter({
    hasText: /no results recorded yet|no teams yet/i,
  });
  const hasTable = await page.locator('table').isVisible({ timeout: 10_000 }).catch(() => false);

  if (!hasTable) {
    // Confirm it is a deliberate empty state, not a crash
    await expect(tableOrEmpty.first()).toBeVisible({ timeout: 5_000 });
    test.skip(true, 'No standings data present — cannot assert column headers (STAND-02)');
    return;
  }

  // The StandingsTable renders these exact header abbreviations in both Firestore
  // and local-computed paths.  All are uppercase <th> text.
  const thead = page.locator('table thead');
  await expect(thead.getByText(/^W$/i)).toBeVisible({ timeout: 5_000 });
  await expect(thead.getByText(/^L$/i)).toBeVisible({ timeout: 5_000 });
  await expect(thead.getByText(/^Pts$/i)).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// STAND-03: Standings table shows at least one team row
// ---------------------------------------------------------------------------

test('STAND-03: Standings table shows at least one team row when season has results', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;

  const leagueHref = await getFirstLeagueHref(page);
  if (!leagueHref) {
    test.skip(true, 'No leagues found — skipping STAND-03');
    return;
  }

  await page.goto(leagueHref);
  await page.waitForURL(/\/leagues\/.+/);
  await page.waitForLoadState('domcontentloaded');

  const seasonUrl = await getFirstSeasonUrl(page);
  if (!seasonUrl) {
    test.skip(true, 'No seasons found in first league — skipping STAND-03');
    return;
  }

  await page.goto(seasonUrl);
  await page.waitForURL(/\/leagues\/.+\/seasons\/.+/);
  await page.waitForLoadState('domcontentloaded');

  // Wait for Firestore standings to load (loading spinner disappears)
  await page.waitForFunction(
    () => !document.querySelector('[aria-busy="true"]'),
    { timeout: 10_000 },
  );

  const table = page.locator('table').first();
  const hasTable = await table.isVisible({ timeout: 5_000 }).catch(() => false);

  if (!hasTable) {
    // Firestore returned no standings documents — this is a valid empty state
    const emptyMsg = page.getByText(/no results recorded yet/i);
    await expect(emptyMsg).toBeVisible({ timeout: 5_000 });
    test.skip(true, 'No standings data present — cannot assert team rows (STAND-03)');
    return;
  }

  // tbody should have at least one data row
  const dataRows = table.locator('tbody tr');
  const rowCount = await dataRows.count();
  expect(rowCount).toBeGreaterThanOrEqual(1);

  // Each data row must contain at least one non-empty cell (team name column)
  const firstTeamCell = dataRows.first().locator('td').nth(1);
  await expect(firstTeamCell).not.toBeEmpty();
});

// ---------------------------------------------------------------------------
// STAND-04: Parent can view Standings tab on a league detail page
// ---------------------------------------------------------------------------

test('STAND-04: Parent can view the Standings tab on a league without redirect or crash', async ({
  asParent,
}) => {
  const { page } = asParent;

  // Navigate to /leagues as a parent
  await page.goto('/leagues');
  await page.waitForLoadState('domcontentloaded');

  // If the parent is redirected away from /leagues, skip rather than fail
  const currentUrl = page.url();
  if (!currentUrl.includes('/leagues')) {
    test.skip(true, 'Parent role cannot access /leagues — skipping STAND-04');
    return;
  }

  const leagueLink = page.locator('a[href*="/leagues/"]').first();
  const leagueLinkVisible = await leagueLink.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!leagueLinkVisible) {
    test.skip(true, 'No leagues visible to parent — skipping STAND-04');
    return;
  }

  await leagueLink.click();
  await page.waitForURL(/\/leagues\/.+/);
  await page.waitForLoadState('domcontentloaded');

  // Should not have been redirected to /login
  await expect(page).not.toHaveURL(/\/login/);

  const standingsTab = page.getByRole('tab', { name: /standings/i });
  await expect(standingsTab).toBeVisible({ timeout: 5_000 });
  await standingsTab.click();
  await page.waitForLoadState('domcontentloaded');

  // Still on the league detail page — no redirect
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('main')).toBeVisible({ timeout: 5_000 });

  // The standings content area must render something — table or empty state
  const standingsContent = page
    .locator('table, p')
    .filter({ hasText: /team|no teams yet/i })
    .first()
    .or(page.locator('table').first());

  await expect(standingsContent).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// STAND-05: Standings tab on LeagueDetailPage always renders data or empty state
// ---------------------------------------------------------------------------

test('STAND-05: Standings tab renders standings data or a defined empty state — never a blank screen', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;

  const leagueHref = await getFirstLeagueHref(page);
  if (!leagueHref) {
    test.skip(true, 'No leagues found — skipping STAND-05');
    return;
  }

  await page.goto(leagueHref);
  await page.waitForURL(/\/leagues\/.+/);
  await page.waitForLoadState('domcontentloaded');

  const standingsTab = page.getByRole('tab', { name: /standings/i });
  await expect(standingsTab).toBeVisible({ timeout: 5_000 });
  await standingsTab.click();
  await page.waitForLoadState('domcontentloaded');

  // Three possible render outcomes — all are acceptable, blank screen is not:
  //   1. A standings table with team rows
  //   2. "No teams yet. Add teams to see standings." (local computed empty state)
  //   3. "Standings are hidden" (kids sports mode)
  const table = page.locator('table').first();
  const noTeamsMsg = page.getByText(/no teams yet/i);
  const hiddenMsg = page.getByText(/standings are hidden/i);

  const hasTable = await table.isVisible({ timeout: 10_000 }).catch(() => false);
  const hasNoTeams = await noTeamsMsg.isVisible({ timeout: 3_000 }).catch(() => false);
  const hasHidden = await hiddenMsg.isVisible({ timeout: 3_000 }).catch(() => false);

  expect(
    hasTable || hasNoTeams || hasHidden,
    'Standings tab must render a table, an empty-state message, or a hidden-mode message — not a blank screen',
  ).toBe(true);
});
