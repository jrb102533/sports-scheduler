/**
 * Multi-Division Schedule Wizard — Phase 1 E2E specs
 *
 * Tests the Phase 1 expansion of the schedule wizard and season dashboard:
 *
 *   MDW-01: Division setup card visibility (LM sees, coach/parent do not)
 *   MDW-02: Division setup card saves values to Firestore
 *   MDW-03: Wizard entry guard — Generate disabled when division config missing
 *   MDW-04: Named surfaces in venues step (no pitch count, add/remove pills)
 *   MDW-05: Venues step — 0 surfaces produces validation error
 *   MDW-06: Advanced options expander present and functional
 *   MDW-07: Division preferences section only shown with 2+ divisions
 *   MDW-08: Backward compat — single-division season wizard flow (no division tabs)
 *   MDW-09: Multi-division preview tabs (skipped — requires multi-division staging data)
 *
 * Auth strategy:
 *   - All mutable operations run as admin (uses asAdmin fixture which is the
 *     same role as league_manager for league-scoped tests in this project).
 *   - Role-access tests for coach/parent run as asCoach / asParent.
 *
 * Test data strategy:
 *   - Each test creates its own throwaway league + season with Date.now() suffix.
 *   - No shared mutable state between tests.
 *   - Multi-division preview tests are skipped pending staging seed data (#497).
 *
 * Hard rules observed:
 *   - No sleep / fixed-time waits.
 *   - Never call publishSchedule or other irreversible CF mutations.
 *   - test.skip requires an issue number in the reason string.
 */

import { test, expect } from './fixtures/auth.fixture';
import { waitForAppHydrated } from './fixtures/auth.fixture';
import { ScheduleWizardPage, dateOffset } from './pages/ScheduleWizardPage';
import { SeasonDashboardPage } from './pages/SeasonDashboardPage';

// ─── Shared setup helpers ─────────────────────────────────────────────────────

/**
 * Creates a league with two teams and navigates to the league detail page.
 * Returns the league name.
 */
async function setupLeagueWithTwoTeams(
  page: import('@playwright/test').Page,
  suffix: string,
): Promise<{ leagueName: string }> {
  const { AdminPage } = await import('./pages/AdminPage');
  const admin = new AdminPage(page);

  const leagueName = `E2E MDW League ${suffix}`;
  const team1 = `E2E MDW Team A ${suffix}`;
  const team2 = `E2E MDW Team B ${suffix}`;

  await admin.createTeam({ name: team1 });
  await admin.createTeam({ name: team2 });

  await createLeagueAndNavigate(page, leagueName);

  // Add both teams via the Teams tab
  await page.getByRole('tab', { name: /teams/i }).click();
  await addTeamToLeague(page, team1);
  await addTeamToLeague(page, team2);

  // Return to Schedule tab
  await page.getByRole('tab', { name: /schedule/i }).click();

  return { leagueName };
}

/**
 * Creates a league, navigates to it, then creates a season.
 * Returns both the league URL and season URL so tests can navigate directly.
 */
async function setupLeagueAndSeason(
  page: import('@playwright/test').Page,
  suffix: string,
): Promise<{ leagueUrl: string; seasonUrl: string }> {
  const leagueName = `E2E MDW LeagueSea ${suffix}`;

  await createLeagueAndNavigate(page, leagueName);
  const leagueUrl = page.url();

  // Create a season via the Seasons tab
  await page.getByRole('tab', { name: /seasons/i }).click();
  const newSeasonBtn = page
    .getByRole('button', { name: /create first season|new season/i })
    .first();
  await expect(newSeasonBtn).toBeVisible({ timeout: 5_000 });
  await newSeasonBtn.click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  const nameInput = modal.getByLabel(/season name|name/i).first();
  if (await nameInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await nameInput.fill(`Season ${suffix}`);
  }

  const dateInputs = modal.locator('input[type="date"]');
  const today = new Date().toISOString().split('T')[0]!;
  const inTwoMonths = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]!;
  if (await dateInputs.first().isVisible({ timeout: 1_000 }).catch(() => false)) {
    await dateInputs.first().fill(today);
  }
  if (await dateInputs.last().isVisible({ timeout: 1_000 }).catch(() => false)) {
    await dateInputs.last().fill(inTwoMonths);
  }

  await modal.getByRole('button', { name: /save|create/i }).click();
  await expect(modal).not.toBeVisible({ timeout: 10_000 });

  // Navigate to the season dashboard.  The UI may either:
  // (a) show a seasons list with an <a href="/seasons/…"> link to click, or
  // (b) auto-navigate when there is exactly one season (LM-SEA-03 behaviour).
  // We try (a) first with a generous timeout; if not visible we re-click the
  // Seasons tab which triggers the single-season direct-navigate behaviour.
  const seasonLink = page.locator('a[href*="/seasons/"]').first();
  const hasSeasonLink = await seasonLink
    .isVisible({ timeout: 10_000 })
    .catch(() => false);

  if (hasSeasonLink) {
    await seasonLink.click();
  } else {
    // Re-click Seasons tab — triggers direct navigation for single-season leagues
    await page.getByRole('tab', { name: /seasons/i }).click();
  }

  // Wait until we are on the season dashboard regardless of which path was taken
  await page.waitForURL(/\/leagues\/.+\/seasons\/.+/, { timeout: 15_000 });

  const seasonUrl = page.url();
  return { leagueUrl, seasonUrl };
}

/**
 * Creates a league, adds a season and a division via the season dashboard.
 * Returns the season URL so the test can navigate to it.
 */
async function setupLeagueSeasionWithDivision(
  page: import('@playwright/test').Page,
  suffix: string,
  divisionName: string,
): Promise<{ seasonUrl: string }> {
  const { seasonUrl } = await setupLeagueAndSeason(page, suffix);

  // Navigate to season dashboard (may already be there)
  if (!page.url().includes('/seasons/')) {
    await page.goto(seasonUrl);
    await page.waitForLoadState('domcontentloaded');
  }

  await waitForAppHydrated(page);

  // Click "Add Division"
  const addDivBtn = page.getByRole('button', { name: /add division/i });
  await expect(addDivBtn).toBeVisible({ timeout: 8_000 });
  await addDivBtn.click();

  const divModal = page.getByRole('dialog');
  await expect(divModal).toBeVisible({ timeout: 5_000 });

  const divNameInput = divModal.getByLabel(/division name/i).first();
  await expect(divNameInput).toBeVisible({ timeout: 3_000 });
  await divNameInput.fill(divisionName);

  await divModal.getByRole('button', { name: /create division/i }).click();
  await expect(divModal).not.toBeVisible({ timeout: 10_000 });

  return { seasonUrl };
}

/**
 * Creates a league with two teams, a season, and one division.
 * Use this for any test that needs to open the Schedule Wizard from the
 * Season Dashboard (which requires ≥2 league teams for the button to be enabled).
 */
async function setupLeagueSeasonWithDivisionAndTeams(
  page: import('@playwright/test').Page,
  suffix: string,
  divisionName: string,
): Promise<{ seasonUrl: string }> {
  const { AdminPage } = await import('./pages/AdminPage');
  const admin = new AdminPage(page);

  const leagueName = `E2E MDW LeagueDiv ${suffix}`;
  const team1 = `E2E MDW T1 ${suffix}`;
  const team2 = `E2E MDW T2 ${suffix}`;

  // Create teams first (navigates to /teams each time)
  await admin.createTeam({ name: team1 });
  await admin.createTeam({ name: team2 });

  // Create league and navigate to its detail page
  await createLeagueAndNavigate(page, leagueName);

  // Add both teams via the Teams tab
  await page.getByRole('tab', { name: /teams/i }).click();
  await addTeamToLeague(page, team1);
  await addTeamToLeague(page, team2);

  // Switch to Seasons tab and create a season
  await page.getByRole('tab', { name: /seasons/i }).click();
  const newSeasonBtn = page
    .getByRole('button', { name: /create first season|new season/i })
    .first();
  await expect(newSeasonBtn).toBeVisible({ timeout: 8_000 });
  await newSeasonBtn.click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  const nameInput = modal.getByLabel(/season name|name/i).first();
  if (await nameInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await nameInput.fill(`Season ${suffix}`);
  }

  const dateInputs = modal.locator('input[type="date"]');
  const today = new Date().toISOString().split('T')[0]!;
  const inTwoMonths = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]!;
  if (await dateInputs.first().isVisible({ timeout: 1_000 }).catch(() => false)) {
    await dateInputs.first().fill(today);
  }
  if (await dateInputs.last().isVisible({ timeout: 1_000 }).catch(() => false)) {
    await dateInputs.last().fill(inTwoMonths);
  }

  await modal.getByRole('button', { name: /save|create/i }).click();
  await expect(modal).not.toBeVisible({ timeout: 10_000 });

  // Navigate to the season dashboard (same reliable pattern as setupLeagueAndSeason)
  const seasonLink = page.locator('a[href*="/seasons/"]').first();
  const hasSeasonLink = await seasonLink
    .isVisible({ timeout: 10_000 })
    .catch(() => false);

  if (hasSeasonLink) {
    await seasonLink.click();
  } else {
    await page.getByRole('tab', { name: /seasons/i }).click();
  }

  await page.waitForURL(/\/leagues\/.+\/seasons\/.+/, { timeout: 15_000 });
  await waitForAppHydrated(page);

  // Add the division
  const addDivBtn = page.getByRole('button', { name: /add division/i });
  await expect(addDivBtn).toBeVisible({ timeout: 8_000 });
  await addDivBtn.click();

  const divModal = page.getByRole('dialog');
  await expect(divModal).toBeVisible({ timeout: 5_000 });

  const divNameInput = divModal.getByLabel(/division name/i).first();
  await expect(divNameInput).toBeVisible({ timeout: 3_000 });
  await divNameInput.fill(divisionName);

  await divModal.getByRole('button', { name: /create division/i }).click();
  await expect(divModal).not.toBeVisible({ timeout: 10_000 });

  return { seasonUrl: page.url() };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function createLeagueAndNavigate(
  page: import('@playwright/test').Page,
  leagueName: string,
): Promise<void> {
  await page.goto('/leagues');
  await page.waitForLoadState('domcontentloaded');

  const newLeagueBtn = page
    .getByRole('button', { name: /new league|\+ league|\+/i })
    .first();
  await expect(newLeagueBtn).toBeVisible({ timeout: 10_000 });
  await newLeagueBtn.click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  const nameInput = modal.getByLabel(/league name|name/i).first();
  await expect(nameInput).toBeVisible({ timeout: 5_000 });
  await nameInput.fill(leagueName);

  await modal.getByRole('button', { name: /save|create/i }).click();
  await expect(modal).not.toBeVisible({ timeout: 10_000 });

  // Navigate into the newly created league
  await page.getByText(leagueName, { exact: false }).click();
  await page.waitForURL(/\/leagues\/.+/);
}

async function addTeamToLeague(
  page: import('@playwright/test').Page,
  teamName: string,
): Promise<void> {
  const addBtn = page
    .getByRole('button', { name: /add team|\+/i })
    .first();
  if (!(await addBtn.isVisible({ timeout: 3_000 }).catch(() => false))) return;

  await addBtn.click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  const teamText = modal.getByText(teamName, { exact: false });
  if (await teamText.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await teamText.click();
  }

  const confirmBtn = modal
    .getByRole('button', { name: /add selected|add/i })
    .last();
  if (await confirmBtn.isEnabled({ timeout: 2_000 }).catch(() => false)) {
    await confirmBtn.click();
  }
  await expect(modal).not.toBeVisible({ timeout: 10_000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// MDW-01: Division setup card visibility
// ─────────────────────────────────────────────────────────────────────────────

test('MDW-01a: LM sees DivisionScheduleSetupCard on Season dashboard when divisions exist', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  const ts = String(Date.now());

  const { seasonUrl } = await setupLeagueSeasionWithDivision(page, ts, `U10 ${ts}`);

  await page.goto(seasonUrl);
  await page.waitForLoadState('domcontentloaded');
  await waitForAppHydrated(page);

  // The "Schedule Configuration" subsection heading is only rendered for
  // managers (canManage = true) when divisions exist.
  await expect(
    page.getByText(/schedule configuration/i).first()
  ).toBeVisible({ timeout: 10_000 });

  // At least one DivisionScheduleSetupCard must be visible.
  // Cards are identified by their division-scoped aria-labels.
  await expect(
    page.locator(`[aria-label*="Format for"]`).first()
  ).toBeVisible({ timeout: 5_000 });
});

test('MDW-01b: coach does NOT see DivisionScheduleSetupCard on Season dashboard', async ({
  asCoach,
  page,
}) => {
  // The coach fixture provides an authenticated coach session.
  // We need to navigate to a season dashboard that has divisions.
  // Since we cannot guarantee staging has such a season, use a skip guard.
  const testData = await (async () => {
    try {
      const { loadTestData } = await import('./helpers/test-data');
      return loadTestData();
    } catch {
      return null;
    }
  })();

  if (!testData) {
    test.skip(true, 'E2E seed data not available — set GOOGLE_APPLICATION_CREDENTIALS (#497)');
    return;
  }

  // Navigate to the seeded season dashboard as coach
  const { page: coachPage } = asCoach;
  await coachPage.goto(`/leagues/${testData.leagueId}/seasons/${testData.seasonId}`);
  await coachPage.waitForLoadState('domcontentloaded');
  await waitForAppHydrated(coachPage);

  // Coach should NOT see division schedule setup cards
  await expect(
    coachPage.getByText(/schedule configuration/i)
  ).not.toBeVisible({ timeout: 5_000 });

  void page; // fixture required but page belongs to coachPage context
});

test('MDW-01c: parent does NOT see DivisionScheduleSetupCard on Season dashboard', async ({
  asParent,
  page,
}) => {
  const testData = await (async () => {
    try {
      const { loadTestData } = await import('./helpers/test-data');
      return loadTestData();
    } catch {
      return null;
    }
  })();

  if (!testData) {
    test.skip(true, 'E2E seed data not available — set GOOGLE_APPLICATION_CREDENTIALS (#497)');
    return;
  }

  const { page: parentPage } = asParent;
  await parentPage.goto(`/leagues/${testData.leagueId}/seasons/${testData.seasonId}`);
  await parentPage.waitForLoadState('domcontentloaded');
  await waitForAppHydrated(parentPage);

  // Parent must not see division schedule configuration
  await expect(
    parentPage.getByText(/schedule configuration/i)
  ).not.toBeVisible({ timeout: 5_000 });

  void page;
});

// ─────────────────────────────────────────────────────────────────────────────
// MDW-02: Division setup card saves values
// ─────────────────────────────────────────────────────────────────────────────

test('MDW-02: LM sets format, games per team, and match duration on a division and values persist after reload', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  const ts = String(Date.now());
  const divName = `U12 ${ts}`;

  const { seasonUrl } = await setupLeagueSeasionWithDivision(page, ts, divName);

  await page.goto(seasonUrl);
  await page.waitForLoadState('domcontentloaded');
  await waitForAppHydrated(page);

  // Locate inputs for this division
  const formatSelect = page.locator(`[aria-label="Format for ${divName}"]`);
  const gamesInput = page.locator(`[aria-label="Games per team for ${divName}"]`);
  const durationInput = page.locator(`[aria-label="Match duration in minutes for ${divName}"]`);

  await expect(formatSelect).toBeVisible({ timeout: 10_000 });

  // Set format to Double Round Robin
  await formatSelect.selectOption({ value: 'double_round_robin' });

  // Set games per team (blur triggers save)
  await gamesInput.fill('8');
  await gamesInput.blur();

  // Wait for "Saved" indicator — confirms Firestore write completed
  await expect(
    page.getByText(/^saved$/i).first()
  ).toBeVisible({ timeout: 8_000 });

  // Set match duration
  await durationInput.fill('75');
  await durationInput.blur();
  await expect(
    page.getByText(/^saved$/i).first()
  ).toBeVisible({ timeout: 8_000 });

  // Reload the page — values must persist from Firestore
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await waitForAppHydrated(page);

  await expect(
    page.locator(`[aria-label="Format for ${divName}"]`)
  ).toHaveValue('double_round_robin', { timeout: 10_000 });
  await expect(
    page.locator(`[aria-label="Games per team for ${divName}"]`)
  ).toHaveValue('8', { timeout: 5_000 });
  await expect(
    page.locator(`[aria-label="Match duration in minutes for ${divName}"]`)
  ).toHaveValue('75', { timeout: 5_000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// MDW-03: Wizard entry guard — Generate disabled when division config missing
// ─────────────────────────────────────────────────────────────────────────────

test('MDW-03: Generate Schedule button is disabled when a division is missing format or gamesPerTeam', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  const ts = String(Date.now());
  const divName = `U14 ${ts}`;

  // Create a season with a division and 2 teams so the wizard button is enabled.
  // Deliberately leave format/gamesPerTeam unset on the division.
  const { seasonUrl } = await setupLeagueSeasonWithDivisionAndTeams(page, ts, divName);

  await page.goto(seasonUrl);
  await page.waitForLoadState('domcontentloaded');
  await waitForAppHydrated(page);

  // Open the wizard from the season dashboard "Open Wizard" CTA
  const wizard = new ScheduleWizardPage(page);
  await wizard.open();

  // Select Season mode and advance to generate step
  await wizard.selectSeasonMode();
  await wizard.fillConfigAndNext();

  // Fill venue name + add a surface to pass venue validation
  await wizard.fillVenueName('Guard Test Park');
  await wizard.addSurface(0, 'Field 1');
  await wizard.clickVenueNext();

  // Skip preferences step
  const prefNext = wizard.modal.getByRole('button', { name: /^next$/i });
  if (await prefNext.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await prefNext.click();
  }

  // Skip availability step
  const availNext = wizard.modal.getByRole('button', { name: /^next$/i });
  if (await availNext.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await availNext.click();
  }

  // Skip blackouts step
  const blackoutsNext = wizard.modal.getByRole('button', { name: /^next$/i });
  if (await blackoutsNext.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await blackoutsNext.click();
  }

  // Should now be on the generate-configure step
  await expect(wizard.generateButton).toBeVisible({ timeout: 5_000 });

  // Division has no format set — Generate must be disabled
  await expect(wizard.generateButton).toBeDisabled({ timeout: 3_000 });

  // Warning text must be visible
  await expect(
    wizard.modal
      .getByText(
        /missing schedule configuration|set format and games per team|some divisions are missing/i
      )
      .first()
  ).toBeVisible({ timeout: 5_000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// MDW-04: Named surfaces in venues step
// ─────────────────────────────────────────────────────────────────────────────

test('MDW-04a: venues step does not show a "Concurrent Pitches" or "Pitch Count" numeric input', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  const ts = String(Date.now());

  await setupLeagueWithTwoTeams(page, ts);

  const wizard = new ScheduleWizardPage(page);
  await wizard.open();
  await wizard.selectSeasonMode();
  await wizard.fillConfigAndNext();

  // Should now be on venues step — Venue Name input is visible
  await expect(wizard.modal.getByLabel('Venue Name').first()).toBeVisible({
    timeout: 5_000,
  });

  await wizard.expectNoPitchCountInput();
});

test('MDW-04b: LM can add a surface by typing a name and clicking "Add surface"', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  const ts = String(Date.now());

  await setupLeagueWithTwoTeams(page, ts);

  const wizard = new ScheduleWizardPage(page);
  await wizard.open();
  await wizard.selectSeasonMode();
  await wizard.fillConfigAndNext();

  await wizard.fillVenueName('Surface Test Park');
  await wizard.addSurface(0, 'Pitch A');

  // The surface pill must appear
  await expect(wizard.modal.getByText('Pitch A').first()).toBeVisible({
    timeout: 5_000,
  });

  // The remove button for the pill must be present
  await expect(
    wizard.modal.locator('button[aria-label="Remove Pitch A"]')
  ).toBeVisible({ timeout: 3_000 });
});

test('MDW-04c: LM can remove a surface pill with the × button', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  const ts = String(Date.now());

  await setupLeagueWithTwoTeams(page, ts);

  const wizard = new ScheduleWizardPage(page);
  await wizard.open();
  await wizard.selectSeasonMode();
  await wizard.fillConfigAndNext();

  await wizard.fillVenueName('Remove Surface Park');
  await wizard.addSurface(0, 'Pitch To Remove');

  // Confirm the pill is there
  await expect(
    wizard.modal.getByText('Pitch To Remove').first()
  ).toBeVisible({ timeout: 5_000 });

  // Remove it
  await wizard.removeSurface('Pitch To Remove');

  // Pill must be gone
  await expect(
    wizard.modal.getByText('Pitch To Remove')
  ).not.toBeVisible({ timeout: 5_000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// MDW-05: Venues step — 0 surfaces triggers validation error
// ─────────────────────────────────────────────────────────────────────────────

test('MDW-05: venues step blocks Next when no surfaces have been added', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  const ts = String(Date.now());

  await setupLeagueWithTwoTeams(page, ts);

  const wizard = new ScheduleWizardPage(page);
  await wizard.open();
  await wizard.selectSeasonMode();
  await wizard.fillConfigAndNext();

  // Fill venue name but add NO surfaces
  await wizard.fillVenueName('No Surfaces Park');

  // Attempt to proceed
  await wizard.clickVenueNext();

  // Validation error must appear
  await wizard.expectSurfaceRequiredError();

  // Still on venues step — Venue Name input must still be visible
  await expect(wizard.modal.getByLabel('Venue Name').first()).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// MDW-06: Advanced options expander
// ─────────────────────────────────────────────────────────────────────────────

test('MDW-06a: "Advanced options" toggle is present on a venue card after adding a surface', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  const ts = String(Date.now());

  await setupLeagueWithTwoTeams(page, ts);

  const wizard = new ScheduleWizardPage(page);
  await wizard.open();
  await wizard.selectSeasonMode();
  await wizard.fillConfigAndNext();

  await wizard.fillVenueName('Advanced Opts Park');

  // Before adding a surface the advanced toggle may not exist (surfaces.length < 1
  // in the component condition).  Add one surface to reveal it.
  await wizard.addSurface(0, 'Pitch 1');

  // Toggle must now be visible
  await expect(
    wizard.modal.getByRole('button', { name: /advanced options/i }).first()
  ).toBeVisible({ timeout: 5_000 });
});

test('MDW-06b: clicking "Advanced options" expands the per-surface section', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  const ts = String(Date.now());

  await setupLeagueWithTwoTeams(page, ts);

  const wizard = new ScheduleWizardPage(page);
  await wizard.open();
  await wizard.selectSeasonMode();
  await wizard.fillConfigAndNext();

  await wizard.fillVenueName('Advanced Expand Park');
  await wizard.addSurface(0, 'Surface A');

  // Expand advanced options
  await wizard.expandAdvancedOptions(0);

  // "Surface availability overrides" heading must now be visible
  await expect(
    wizard.modal.getByText(/surface availability overrides/i).first()
  ).toBeVisible({ timeout: 5_000 });

  // The surface name appears inside the expanded section
  await expect(
    wizard.modal.getByText('Surface A').first()
  ).toBeVisible({ timeout: 3_000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// MDW-07: Division preferences section — only shown with 2+ divisions
// ─────────────────────────────────────────────────────────────────────────────

test('MDW-07a: division preferences section is NOT shown in Advanced options when season has only 1 division', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  const ts = String(Date.now());

  // Season with exactly one division and 2 teams (needed to open the wizard)
  const { seasonUrl } = await setupLeagueSeasonWithDivisionAndTeams(
    page,
    ts,
    `SingleDiv ${ts}`
  );

  await page.goto(seasonUrl);
  await page.waitForLoadState('domcontentloaded');
  await waitForAppHydrated(page);

  const wizard = new ScheduleWizardPage(page);
  await wizard.open();
  await wizard.selectSeasonMode();
  await wizard.fillConfigAndNext();

  await wizard.fillVenueName('Single Div Park');
  await wizard.addSurface(0, 'Field 1');

  await wizard.expandAdvancedOptions(0);

  // "Division preferences" section must NOT appear (< 2 divisions)
  const isDivPrefsVisible = await wizard.isDivisionPreferencesSectionVisible();
  expect(isDivPrefsVisible).toBe(false);
});

test('MDW-07b: division preferences section IS shown in Advanced options when season has 2+ divisions', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  const ts = String(Date.now());

  // Create a season with one division and 2 teams (needed to open wizard), then add a second division
  const { seasonUrl } = await setupLeagueSeasonWithDivisionAndTeams(
    page,
    ts,
    `DivA ${ts}`
  );

  await page.goto(seasonUrl);
  await page.waitForLoadState('domcontentloaded');
  await waitForAppHydrated(page);

  // Add a second division
  const addDivBtn = page.getByRole('button', { name: /add division/i });
  await expect(addDivBtn).toBeVisible({ timeout: 8_000 });
  await addDivBtn.click();

  const divModal = page.getByRole('dialog');
  await expect(divModal).toBeVisible({ timeout: 5_000 });
  await divModal.getByLabel(/division name/i).first().fill(`DivB ${ts}`);
  await divModal.getByRole('button', { name: /create division/i }).click();
  await expect(divModal).not.toBeVisible({ timeout: 10_000 });

  // Now open the wizard
  const wizard = new ScheduleWizardPage(page);
  await wizard.open();
  await wizard.selectSeasonMode();
  await wizard.fillConfigAndNext();

  await wizard.fillVenueName('Two Div Park');
  await wizard.addSurface(0, 'Field 1');

  await wizard.expandAdvancedOptions(0);

  // "Division preferences" heading must appear
  await expect(
    wizard.modal.getByText(/division preferences/i).first()
  ).toBeVisible({ timeout: 5_000 });

  // Both division names must appear inside the advanced section
  await expect(
    wizard.modal.getByText(`DivA ${ts}`, { exact: false }).first()
  ).toBeVisible({ timeout: 3_000 });
  await expect(
    wizard.modal.getByText(`DivB ${ts}`, { exact: false }).first()
  ).toBeVisible({ timeout: 3_000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// MDW-08: Backward compat — single division (or no divisions) wizard
// ─────────────────────────────────────────────────────────────────────────────

test('MDW-08a: a season with no divisions shows NO division setup cards on the dashboard', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  const ts = String(Date.now());

  // Create league + season only — no divisions
  const { seasonUrl } = await setupLeagueAndSeason(page, ts);

  await page.goto(seasonUrl);
  await page.waitForLoadState('domcontentloaded');
  await waitForAppHydrated(page);

  // "Schedule Configuration" subsection must not appear (no divisions)
  await expect(
    page.getByText(/schedule configuration/i)
  ).not.toBeVisible({ timeout: 5_000 });
});

test('MDW-08b: wizard opens without errors on a season with no divisions', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  const ts = String(Date.now());

  await setupLeagueWithTwoTeams(page, ts);

  const wizard = new ScheduleWizardPage(page);
  await wizard.open();
  await wizard.selectSeasonMode();

  // Config step must render — page has not crashed, modal is still open
  await expect(wizard.modal.locator('input[type="date"]').first()).toBeVisible({
    timeout: 5_000,
  });

  // Advance to venues step — confirm no division-specific UI
  await wizard.fillConfigAndNext();

  await expect(wizard.modal.getByLabel('Venue Name').first()).toBeVisible({
    timeout: 5_000,
  });

  // No "Add at least one division" or division-preference UI should appear
  await expect(
    wizard.modal.getByText(/division preferences/i)
  ).not.toBeVisible({ timeout: 3_000 });

  await wizard.cancel();
});

test('MDW-08c: wizard generate step is NOT disabled on a no-division season with valid dates', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  const ts = String(Date.now());

  await setupLeagueWithTwoTeams(page, ts);

  const wizard = new ScheduleWizardPage(page);
  await wizard.open();
  await wizard.selectSeasonMode();
  await wizard.fillConfigAndNext();

  await wizard.fillVenueName('No Division Park');
  await wizard.addSurface(0, 'Field 1');
  await wizard.clickVenueNext();

  // Skip preferences
  const prefNext = wizard.modal.getByRole('button', { name: /^next$/i });
  if (await prefNext.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await prefNext.click();
  }

  // Skip availability
  const availNext = wizard.modal.getByRole('button', { name: /^next$/i });
  if (await availNext.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await availNext.click();
  }

  // Skip blackouts
  const blackoutsNext = wizard.modal.getByRole('button', { name: /^next$/i });
  if (await blackoutsNext.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await blackoutsNext.click();
  }

  // On generate step: "Generate Schedule" must be ENABLED (no divisions = no guard)
  await expect(wizard.generateButton).toBeVisible({ timeout: 5_000 });
  await expect(wizard.generateButton).toBeEnabled({ timeout: 3_000 });
});

test('MDW-08d: preview shows no division tab bar when single-division season generates results', async ({
  asAdmin,
}) => {
  // This test can only run against staging when the generateSchedule CF is
  // available.  Skip until a stable staging fixture exists.
  test.skip(
    true,
    'Requires generateSchedule Cloud Function to return results — enable when staging CF is stable (#497)',
  );
  const { page } = asAdmin;
  void page;
});

// ─────────────────────────────────────────────────────────────────────────────
// MDW-09: Multi-division preview tabs
// (Skipped — requires multi-division staging data and a CF-generated response)
// ─────────────────────────────────────────────────────────────────────────────

test.skip(
  'MDW-09a: after generation with 2+ divisions, preview shows one tab per division plus "All"',
  async ({ asAdmin }) => {
    // To enable: seed a league/season with 2+ configured divisions on staging,
    // run the wizard to generate, and verify tab bar contains each division name
    // plus an "All" tab. Blocked on multi-division staging seed data (#497).
    const { page } = asAdmin;
    void page;
  },
);

test.skip(
  'MDW-09b: switching between division tabs in preview filters the fixture table',
  async ({ asAdmin }) => {
    // Depends on MDW-09a preconditions. Blocked on #497.
    const { page } = asAdmin;
    void page;
  },
);
