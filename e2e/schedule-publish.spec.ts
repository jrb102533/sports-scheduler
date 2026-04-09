/**
 * Schedule publish flow UAT — SeasonDashboard states and navigation
 *
 * Covers:
 *   PUB-01: SeasonDashboard page loads for a league with seasons
 *   PUB-02: SeasonDashboard shows schedule status badge (Draft, Published, or No schedule)
 *   PUB-03: "Publish Now" button is present and enabled when a draft schedule exists
 *   PUB-04: "Schedule Published" state renders correctly — no Publish button when published
 *   PUB-05: SeasonDashboard shows feasibility panel (venues + teams required message or advisory)
 *   PUB-06: Back navigation from SeasonDashboard returns to league detail
 *
 * All tests authenticate as admin.
 *
 * These tests verify UI states and navigation only. They do NOT call publishSchedule —
 * that Cloud Function permanently mutates staging data. Tests that require a specific
 * schedule state (draft / published) skip gracefully when that state is not found in
 * staging.
 */

import { test, expect } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigates to /leagues, clicks the first league, opens the Seasons tab, and
 * clicks the first season.  Returns the leagueId and seasonId extracted from the
 * resulting URL, or null if no leagues or seasons exist in staging.
 */
async function navigateToFirstSeason(
  page: import('@playwright/test').Page,
): Promise<{ leagueId: string; seasonId: string } | null> {
  await page.goto('/leagues');
  await page.waitForLoadState('networkidle');

  // Pick the first league card / row
  const firstLeague = page.getByRole('link', { name: /.+/ }).filter({ hasText: /.+/ }).first();
  const leagueVisible = await firstLeague.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!leagueVisible) return null;

  await firstLeague.click();
  await page.waitForURL(/\/leagues\/.+/, { timeout: 10_000 });

  const leagueUrl = page.url();
  const leagueIdMatch = leagueUrl.match(/\/leagues\/([^/]+)/);
  if (!leagueIdMatch) return null;
  const leagueId = leagueIdMatch[1]!;

  // Open Seasons tab
  const seasonsTab = page.getByRole('tab', { name: /seasons/i });
  const tabVisible = await seasonsTab.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!tabVisible) return null;
  await seasonsTab.click();

  // Wait for the seasons list to settle
  await page.waitForLoadState('networkidle');

  // Click the first season
  const firstSeason = page.getByRole('link', { name: /.+/ }).filter({ hasText: /.+/ }).first();
  const seasonVisible = await firstSeason.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!seasonVisible) {
    // Seasons tab may show a "No seasons yet" empty state
    return null;
  }

  await firstSeason.click();
  await page.waitForURL(/\/leagues\/.+\/seasons\/.+/, { timeout: 10_000 });

  const seasonUrl = page.url();
  const seasonIdMatch = seasonUrl.match(/\/seasons\/([^/]+)/);
  if (!seasonIdMatch) return null;
  const seasonId = seasonIdMatch[1]!;

  await page.waitForLoadState('networkidle');
  return { leagueId, seasonId };
}

// ---------------------------------------------------------------------------
// PUB-01 — page loads
// ---------------------------------------------------------------------------

test('PUB-01: SeasonDashboard page loads for a league with seasons', async ({ asAdmin }) => {
  const { page } = asAdmin;

  const nav = await navigateToFirstSeason(page);
  if (!nav) {
    test.skip(true, 'No leagues or seasons found in staging — cannot run PUB-01');
    return;
  }

  // Heading should contain a non-empty season name
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeVisible({ timeout: 8_000 });
  await expect(heading).not.toBeEmpty();

  // A SeasonStatusBadge (Setup / Active / Archived) should be visible
  const statusBadge = page
    .getByText(/setup|active|archived/i)
    .first();
  await expect(statusBadge).toBeVisible({ timeout: 5_000 });

  // Page should not redirect to /login
  await expect(page).not.toHaveURL(/\/login/);
});

// ---------------------------------------------------------------------------
// PUB-02 — schedule status badge
// ---------------------------------------------------------------------------

test('PUB-02: SeasonDashboard shows schedule status badge', async ({ asAdmin }) => {
  const { page } = asAdmin;

  const nav = await navigateToFirstSeason(page);
  if (!nav) {
    test.skip(true, 'No leagues or seasons found in staging — cannot run PUB-02');
    return;
  }

  // One of the three DivisionStatusBadge labels should be visible somewhere on
  // the page — either in a division row or in the per-division publish CTA area.
  // The page also renders "Schedule Published" / "Draft Schedule Ready" / "Generate
  // Schedule" heading text that implicitly confirms the schedule state was read.
  const scheduleStateText = page.getByText(
    /draft|published|no schedule|schedule published|draft schedule ready|generate schedule/i,
  ).first();
  await expect(scheduleStateText).toBeVisible({ timeout: 8_000 });
});

// ---------------------------------------------------------------------------
// PUB-03 — "Publish Now" button present when draft exists
// ---------------------------------------------------------------------------

test('PUB-03: "Publish Now" button is present and enabled when a draft schedule exists', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;

  await page.goto('/leagues');
  await page.waitForLoadState('networkidle');

  // Iterate leagues looking for one that has a season with a draft schedule.
  // We rely on the "Draft Schedule Ready" section heading that SeasonDashboard
  // renders when hasDraftSchedule is true.
  const leagueLinks = await page.getByRole('link', { name: /.+/ }).all();
  if (leagueLinks.length === 0) {
    test.skip(true, 'No leagues found in staging — cannot run PUB-03');
    return;
  }

  let found = false;

  for (const link of leagueLinks) {
    const href = await link.getAttribute('href').catch(() => null);
    if (!href?.match(/\/leagues\/[^/]+$/)) continue;

    await page.goto(href);
    await page.waitForLoadState('networkidle');

    const seasonsTab = page.getByRole('tab', { name: /seasons/i });
    if (!(await seasonsTab.isVisible({ timeout: 3_000 }).catch(() => false))) continue;
    await seasonsTab.click();
    await page.waitForLoadState('networkidle');

    const seasonLinks = await page
      .getByRole('link', { name: /.+/ })
      .filter({ hasText: /.+/ })
      .all();

    for (const seasonLink of seasonLinks) {
      const seasonHref = await seasonLink.getAttribute('href').catch(() => null);
      if (!seasonHref?.match(/\/seasons\//)) continue;

      await page.goto(seasonHref);
      await page.waitForLoadState('networkidle');

      const publishBtn = page.getByRole('button', { name: /publish now/i });
      if (await publishBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await expect(publishBtn).toBeEnabled();
        found = true;
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    test.skip(true, 'No seasons with a draft schedule found in staging — cannot run PUB-03');
  }
});

// ---------------------------------------------------------------------------
// PUB-04 — "Schedule Published" state — no Publish button
// ---------------------------------------------------------------------------

test('PUB-04: "Schedule Published" state renders correctly — no Publish Now button', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;

  await page.goto('/leagues');
  await page.waitForLoadState('networkidle');

  const leagueLinks = await page.getByRole('link', { name: /.+/ }).all();
  if (leagueLinks.length === 0) {
    test.skip(true, 'No leagues found in staging — cannot run PUB-04');
    return;
  }

  let found = false;

  for (const link of leagueLinks) {
    const href = await link.getAttribute('href').catch(() => null);
    if (!href?.match(/\/leagues\/[^/]+$/)) continue;

    await page.goto(href);
    await page.waitForLoadState('networkidle');

    const seasonsTab = page.getByRole('tab', { name: /seasons/i });
    if (!(await seasonsTab.isVisible({ timeout: 3_000 }).catch(() => false))) continue;
    await seasonsTab.click();
    await page.waitForLoadState('networkidle');

    const seasonLinks = await page
      .getByRole('link', { name: /.+/ })
      .filter({ hasText: /.+/ })
      .all();

    for (const seasonLink of seasonLinks) {
      const seasonHref = await seasonLink.getAttribute('href').catch(() => null);
      if (!seasonHref?.match(/\/seasons\//)) continue;

      await page.goto(seasonHref);
      await page.waitForLoadState('networkidle');

      // SeasonDashboard renders "Schedule Published" heading text when hasFullyPublished
      const publishedHeading = page.getByText(/schedule published/i).first();
      if (await publishedHeading.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await expect(publishedHeading).toBeVisible();
        // "Publish Now" button must NOT appear in the published state
        await expect(page.getByRole('button', { name: /publish now/i })).not.toBeVisible();
        found = true;
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    test.skip(true, 'No fully-published seasons found in staging — cannot run PUB-04');
  }
});

// ---------------------------------------------------------------------------
// PUB-05 — feasibility panel visible
// ---------------------------------------------------------------------------

test('PUB-05: SeasonDashboard shows feasibility panel or "Add venues and teams" message', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;

  const nav = await navigateToFirstSeason(page);
  if (!nav) {
    test.skip(true, 'No leagues or seasons found in staging — cannot run PUB-05');
    return;
  }

  // FeasibilityPanel renders one of four states depending on data presence and ratio.
  // The lowest-data state says "Add venues and teams to see feasibility."
  // Higher-data states include "Enough slots", "Slot availability is tight", or
  // "Not enough venue slots".  Match any of these.
  const feasibilityText = page
    .getByText(
      /add venues and teams to see feasibility|enough slots available|slot availability is tight|not enough venue slots/i,
    )
    .first();
  await expect(feasibilityText).toBeVisible({ timeout: 8_000 });
});

// ---------------------------------------------------------------------------
// PUB-06 — back navigation
// ---------------------------------------------------------------------------

test('PUB-06: Back navigation from SeasonDashboard returns to league detail', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;

  const nav = await navigateToFirstSeason(page);
  if (!nav) {
    test.skip(true, 'No leagues or seasons found in staging — cannot run PUB-06');
    return;
  }

  const { leagueId } = nav;

  // SeasonDashboard renders a back button with text "Back to {league.name}"
  const backBtn = page
    .getByRole('button', { name: /back to/i })
    .or(page.locator('button').filter({ hasText: /back to/i }))
    .first();
  await expect(backBtn).toBeVisible({ timeout: 5_000 });
  await backBtn.click();

  await page.waitForURL(new RegExp(`/leagues/${leagueId}$`), { timeout: 10_000 });
  await expect(page).toHaveURL(new RegExp(`/leagues/${leagueId}$`));
});
