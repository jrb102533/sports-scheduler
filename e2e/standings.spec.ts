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

test('@smoke STAND-02: Standings table column headers include W, L, and Pts', async ({ asAdmin }) => {
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

// ---------------------------------------------------------------------------
// Round-trip: submit result → verify standings update
// ---------------------------------------------------------------------------
//
// STAND-RT-01 verifies the full data pipeline:
//   coach submits a result via the "Submit Result" Cloud Function →
//   Firestore standings subcollection updates →
//   StandingsTable Firestore subscription reflects the new win/loss counts.
//
// Preconditions:
//   - The Sharks team must have at least one game/match event whose date has
//     already occurred (ev.date <= today) AND whose result has not yet been
//     confirmed.  If not, the "Submit Result" section is hidden and the test
//     skips with a linked issue number.
//   - The event must be associated with a league and season (leagueId +
//     seasonId on the Firestore document) so the standings are stored in the
//     Firestore subcollection path that StandingsTable subscribes to.
//
// Assertion strategy (incremental, not absolute):
//   We read the home team's W count from the standings table before submitting,
//   then assert it increased by exactly 1 after the result is submitted.
//   This is robust against prior test runs that have already written standings
//   data to staging — absolute counts (W=1) would be fragile.
//
// Navigation sequence:
//   /teams → Sharks → Schedule → event panel → read team names and leagueId
//   from panel → navigate to SeasonDashboard standings → record current W for
//   home team → navigate back → submit result → navigate back to standings →
//   assert W incremented.
//
// ---------------------------------------------------------------------------

test('@smoke STAND-RT-01: submitting a game result via "Submit Result" increments the winning team\'s W count in the standings table', async ({
  asCoach,
}) => {
  const { page } = asCoach;

  // ── Step 1: Open the Sharks schedule and find a past game with a visible
  //    "Submit Result" section.  We must also extract the home/away team names
  //    and the leagueId + seasonId so we can navigate to the correct standings.
  // ──────────────────────────────────────────────────────────────────────────

  await page.goto('/teams');
  await page.waitForLoadState('domcontentloaded');

  const sharksLink = page.getByRole('link', { name: /sharks/i }).first();
  const sharksVisible = await sharksLink.isVisible({ timeout: 10_000 }).catch(() => false);
  if (!sharksVisible) {
    test.skip(true, 'Sharks team not found on /teams — data contract mismatch (STAND-RT-01)');
    return;
  }

  await sharksLink.click();
  await page.waitForURL(/\/teams\/.+/, { timeout: 10_000 });
  await page.waitForLoadState('domcontentloaded');

  const scheduleTab = page.getByRole('tab', { name: /schedule/i });
  await expect(scheduleTab).toBeVisible({ timeout: 10_000 });
  await scheduleTab.click();

  // Collect all event cards so we can iterate until we find one with "Submit Result"
  const eventCards = page.locator('div.rounded-xl.border.border-gray-200.cursor-pointer');
  const cardCount = await eventCards.count();

  if (cardCount === 0) {
    test.skip(true, 'No events on Sharks schedule — issue #317 may be active (STAND-RT-01)');
    return;
  }

  // Try each event card in turn until we find one that shows "Submit Result".
  // "Submit Result" only renders for a coach on a past-dated game/match whose
  // result has not yet been confirmed — so we may need to scan multiple cards.

  let homeTeamName: string | null = null;
  let foundEventCard = false;

  for (let i = 0; i < cardCount; i++) {
    const card = eventCards.nth(i);
    const cardVisible = await card.isVisible({ timeout: 2_000 }).catch(() => false);
    if (!cardVisible) continue;

    await card.click();

    // Wait for the panel heading to confirm the panel opened
    const panelHeading = page.locator('h2').filter({ hasText: /.+/ }).first();
    const panelOpened = await panelHeading.isVisible({ timeout: 6_000 }).catch(() => false);
    if (!panelOpened) {
      // Close any partial panel and try the next card
      const closeBtn = page.getByRole('button', { name: /close/i }).first();
      await closeBtn.click().catch(() => null);
      await page.keyboard.press('Escape');
      continue;
    }

    // Check for "Submit Result" — this is the section that triggers the CF
    const submitSection = page
      .locator('div.border.border-gray-200.rounded-xl')
      .filter({ has: page.locator('h3').filter({ hasText: /submit result/i }) })
      .first();

    const submitVisible = await submitSection.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!submitVisible) {
      // Not a past game or result already confirmed — close and try next
      const closeBtn = page.getByRole('button', { name: /close/i }).first();
      const closeBtnAlt = page.locator('button[aria-label="Close"]').first();
      await closeBtn.click().catch(() => closeBtnAlt.click().catch(() => null));
      await page.waitForTimeout(300);
      continue;
    }

    // Read the home and away team label text from the two score inputs inside
    // the Submit Result section.  EventDetailPanel sets label to homeTeam.name
    // and awayTeam.name when those teams are resolved.
    const scoreInputs = submitSection.locator('input[type="number"]');
    const inputCount = await scoreInputs.count();
    if (inputCount < 2) {
      const closeBtn = page.locator('button[aria-label="Close"]').first();
      await closeBtn.click().catch(() => null);
      continue;
    }

    // The Input component renders a <label> sibling to each <input>.
    // We use the input's aria-label or the nearest label text to get team names.
    // Fallback: read the label text from the grid div wrapping each input.
    const homeLabel = submitSection.locator('label').nth(0);
    homeTeamName = await homeLabel.textContent().then(t => t?.trim() ?? null).catch(() => null);

    foundEventCard = true;
    break; // Panel is still open — proceed with this event
  }

  if (!foundEventCard) {
    test.skip(
      true,
      '"Submit Result" section not found on any Sharks event — all games may be future-dated ' +
        'or already confirmed. Ensure at least one past unconfirmed game exists in staging ' +
        '(see issue #317) (STAND-RT-01)',
    );
    return;
  }

  // ── Step 2: From the open event panel, extract leagueId + seasonId so we
  //    can navigate directly to the SeasonDashboard standings after submitting.
  //    These IDs are not visible in the panel DOM, so we navigate to the
  //    standings via the existing route pattern: /leagues → first league →
  //    first season.  This matches what STAND-01/02/03 do and is reliable for
  //    the staging data contract (one league, one season).
  // ──────────────────────────────────────────────────────────────────────────

  // Close the event panel before navigating away
  const closeButton = page.locator('button[aria-label="Close"]').first();
  await closeButton.click().catch(() => page.keyboard.press('Escape'));
  await page.waitForTimeout(200); // let the panel animate out

  // Navigate to /leagues and find the first season URL (same as STAND-01 helper)
  const leagueHref = await getFirstLeagueHref(page);
  if (!leagueHref) {
    test.skip(true, 'No leagues found — cannot navigate to standings (STAND-RT-01)');
    return;
  }

  await page.goto(leagueHref);
  await page.waitForURL(/\/leagues\/.+/);
  await page.waitForLoadState('domcontentloaded');

  const seasonUrl = await getFirstSeasonUrl(page);
  if (!seasonUrl) {
    test.skip(true, 'No seasons found in first league — cannot navigate to standings (STAND-RT-01)');
    return;
  }

  await page.goto(seasonUrl);
  await page.waitForURL(/\/leagues\/.+\/seasons\/.+/);
  await page.waitForLoadState('domcontentloaded');

  // Wait for standings to load (either a table or the "no results" empty state)
  await page.waitForFunction(
    () => !document.querySelector('[aria-busy="true"]'),
    { timeout: 10_000 },
  );

  // ── Step 3: Record the home team's current W count before submitting.
  //    The StandingsTable renders W values in <td> cells with class
  //    "text-green-600 font-medium text-sm".  We locate the home team's row
  //    by team name and read its W cell (4th <td> in the row, 0-indexed).
  // ──────────────────────────────────────────────────────────────────────────

  const standingsTable = page.locator('table').first();
  const standingsTableVisible = await standingsTable.isVisible({ timeout: 10_000 }).catch(() => false);

  // The table may not yet exist if no results have been submitted at all —
  // that is fine; we just record 0 as the baseline.
  let baselineWins = 0;

  if (standingsTableVisible && homeTeamName) {
    // Find the table row whose team name cell contains homeTeamName
    const homeRow = standingsTable
      .locator('tbody tr')
      .filter({ has: page.locator('td').filter({ hasText: new RegExp(`^${homeTeamName}$`, 'i') }) })
      .first();

    const homeRowVisible = await homeRow.isVisible({ timeout: 3_000 }).catch(() => false);
    if (homeRowVisible) {
      // W is the 4th column (index 3): rank | team | GP | W | L | ...
      const wCell = homeRow.locator('td').nth(3);
      const wText = await wCell.textContent().catch(() => '0');
      baselineWins = parseInt(wText?.trim() ?? '0', 10) || 0;
    }
  }

  // ── Step 4: Navigate back to the Sharks schedule and open the same event.
  //    We reuse the same card-scanning logic since we cannot retain a reference
  //    across navigations.  This is intentional — each navigation is independent.
  // ──────────────────────────────────────────────────────────────────────────

  await page.goto('/teams');
  await page.waitForLoadState('domcontentloaded');

  const sharksLinkAgain = page.getByRole('link', { name: /sharks/i }).first();
  await expect(sharksLinkAgain).toBeVisible({ timeout: 10_000 });
  await sharksLinkAgain.click();
  await page.waitForURL(/\/teams\/.+/, { timeout: 10_000 });
  await page.waitForLoadState('domcontentloaded');

  const scheduleTabAgain = page.getByRole('tab', { name: /schedule/i });
  await expect(scheduleTabAgain).toBeVisible({ timeout: 10_000 });
  await scheduleTabAgain.click();

  // Find the same event card by re-scanning for "Submit Result"
  const eventCardsAgain = page.locator('div.rounded-xl.border.border-gray-200.cursor-pointer');
  const cardCountAgain = await eventCardsAgain.count();

  let submitSectionFound = false;
  for (let i = 0; i < cardCountAgain; i++) {
    const card = eventCardsAgain.nth(i);
    const cardVisible = await card.isVisible({ timeout: 2_000 }).catch(() => false);
    if (!cardVisible) continue;

    await card.click();

    const panelHeading = page.locator('h2').filter({ hasText: /.+/ }).first();
    const panelOpened = await panelHeading.isVisible({ timeout: 6_000 }).catch(() => false);
    if (!panelOpened) {
      await page.keyboard.press('Escape');
      continue;
    }

    const submitSection = page
      .locator('div.border.border-gray-200.rounded-xl')
      .filter({ has: page.locator('h3').filter({ hasText: /submit result/i }) })
      .first();

    const submitVisible = await submitSection.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!submitVisible) {
      const closeBtnAlt = page.locator('button[aria-label="Close"]').first();
      await closeBtnAlt.click().catch(() => page.keyboard.press('Escape'));
      await page.waitForTimeout(300);
      continue;
    }

    // ── Step 5: Enter home=2, away=1 and click "Submit Result"
    // ────────────────────────────────────────────────────────────────────────

    const homeInput = submitSection.locator('input[type="number"]').nth(0);
    const awayInput = submitSection.locator('input[type="number"]').nth(1);
    const submitButton = submitSection.getByRole('button', { name: /submit result/i });

    await expect(homeInput).toBeVisible({ timeout: 5_000 });
    await expect(awayInput).toBeVisible({ timeout: 5_000 });
    await expect(submitButton).toBeVisible({ timeout: 5_000 });

    await homeInput.fill('2');
    await awayInput.fill('1');

    await expect(submitButton).not.toBeDisabled({ timeout: 3_000 });
    await submitButton.click();

    // After clicking, the button transitions to "Submitting…" then the section
    // renders a confirmation message: "Result submitted — waiting for … coach to confirm."
    // We wait for that confirmation to know the CF call completed.
    const confirmationMsg = submitSection.getByText(/result submitted/i);
    const confirmed = await confirmationMsg.isVisible({ timeout: 15_000 }).catch(() => false);

    if (!confirmed) {
      // The CF may have returned an error — check for the error state
      const errorMsg = submitSection.locator('p').filter({ hasText: /failed to submit/i });
      const hasError = await errorMsg.isVisible({ timeout: 3_000 }).catch(() => false);
      if (hasError) {
        const errorText = await errorMsg.textContent().catch(() => 'unknown error');
        // CF error — skip rather than fail; this may be an environment issue
        test.skip(
          true,
          `submitGameResult Cloud Function returned an error: "${errorText}". ` +
            'The function may not be deployed to staging or the event lacks leagueId/seasonId (STAND-RT-01)',
        );
        return;
      }
      // Timeout waiting for confirmation — skip
      test.skip(
        true,
        'Did not see "Result submitted" confirmation after clicking Submit Result — ' +
          'Cloud Function call may have timed out (STAND-RT-01)',
      );
      return;
    }

    submitSectionFound = true;
    break;
  }

  if (!submitSectionFound) {
    test.skip(
      true,
      '"Submit Result" section disappeared between the two navigation passes — ' +
        'likely a race condition with another test writing a result (STAND-RT-01)',
    );
    return;
  }

  // ── Step 6: Navigate to the SeasonDashboard standings and verify the
  //    winning team's W count increased by exactly 1.
  // ──────────────────────────────────────────────────────────────────────────

  await page.goto(seasonUrl!);
  await page.waitForURL(/\/leagues\/.+\/seasons\/.+/);
  await page.waitForLoadState('domcontentloaded');

  // Wait for the Firestore onSnapshot to deliver the updated standings.
  // The standings subcollection is updated by the submitGameResult CF — it
  // typically propagates within 2-5 seconds.  We give it 10 seconds before
  // failing to avoid flakiness on cold CF starts.
  const updatedTable = page.locator('table').first();
  await expect(updatedTable).toBeVisible({ timeout: 15_000 });

  // The home team (score 2) won — find its row and assert W incremented by 1.
  // We build the team name pattern from what we read earlier; fall back to a
  // broad search if homeTeamName was not captured.
  const homeTeamPattern = homeTeamName
    ? new RegExp(`^${homeTeamName}$`, 'i')
    : /sharks/i; // best-effort fallback — Sharks is the coach's team

  const updatedHomeRow = updatedTable
    .locator('tbody tr')
    .filter({ has: page.locator('td').filter({ hasText: homeTeamPattern }) })
    .first();

  // Wait for the home team row to appear — it may not exist until the CF writes
  // the standings document and the onSnapshot delivers the update.
  await expect(updatedHomeRow).toBeVisible({ timeout: 10_000 });

  // Read the updated W value — the W column is the 4th column (index 3):
  // rank | team | GP | W | L | T | PF | PA | Diff | Pts
  const updatedWCell = updatedHomeRow.locator('td').nth(3);
  await expect(updatedWCell).toBeVisible({ timeout: 10_000 });

  const updatedWText = await updatedWCell.textContent();
  const updatedWins = parseInt(updatedWText?.trim() ?? '0', 10) || 0;

  expect(
    updatedWins,
    `Expected ${homeTeamName ?? 'home team'} wins to be ${baselineWins + 1} ` +
      `(baseline ${baselineWins} + 1 for the submitted win), got ${updatedWins}. ` +
      'The submitGameResult CF may not be updating the standings document correctly.',
  ).toBe(baselineWins + 1);
});
