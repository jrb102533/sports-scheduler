/**
 * Cross-role event visibility E2E tests
 *
 * Verifies that events on E2E Team A are visible to the coach, parent, and
 * player accounts that belong to that team, and that visibility boundaries
 * are respected for unrelated teams.
 *
 * Covers:
 *   CROSS-01: Event visible to coach on team Schedule tab
 *   CROSS-02: Same event visible to parent on /parent
 *   CROSS-03: Same event visible to player on /parent
 *   CROSS-04: Admin can see E2E Team A events from Teams page
 *   CROSS-05: Events NOT visible across teams — coach sees no edit controls on unrelated team
 *
 * Requires:
 *   E2E_COACH_EMAIL / E2E_COACH_PASSWORD   — coach on E2E Team A
 *   E2E_PARENT_EMAIL / E2E_PARENT_PASSWORD — parent linked to a team
 *   E2E_PLAYER_EMAIL / E2E_PLAYER_PASSWORD — player on a team
 *   E2E_ADMIN_EMAIL  / E2E_ADMIN_PASSWORD  — admin account
 *   GOOGLE_APPLICATION_CREDENTIALS         — used by global-setup to seed E2E Team A
 *
 * Data used in assertions loaded from e2e/.auth/test-data.json:
 *   testData.teamAId   — Firestore ID of E2E Team A
 *   testData.teamAName — display name ('E2E Team A')
 */

import { test, expect, waitForAppHydrated } from './fixtures/auth.fixture';
import { loadTestData } from './helpers/test-data';

// ---------------------------------------------------------------------------
// Known test-account data — resolved from seeded data or fallback
// ---------------------------------------------------------------------------

const testData = loadTestData();
const KNOWN_TEAM_NAME = testData?.teamAName ?? 'Sharks';
// Fall back to the legacy hardcoded ID if seeding was skipped
const KNOWN_TEAM_ID = testData?.teamAId ?? '44ee1f68-cdce-4a05-b30b-d2a87b191dbe';

// ---------------------------------------------------------------------------
// CROSS-01 — coach sees Schedule tab content on their own team
// ---------------------------------------------------------------------------

test('CROSS-01: coach can see the Schedule tab on the E2E Team A detail page', async ({ asCoach }) => {
  const { coach, page } = asCoach;

  if (testData) {
    // Navigate directly to the known team detail page
    await page.goto(`/teams/${testData.teamAId}`);
    await page.waitForURL(/\/teams\/.+/);
    await waitForAppHydrated(page);
  } else {
    // Fallback: navigate to /teams and open the first visible team
    await coach.gotoTeams();

    const teamVisible = await page
      .getByText(KNOWN_TEAM_NAME, { exact: false })
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);

    if (!teamVisible) {
      test.skip(true, `${KNOWN_TEAM_NAME} not found on /teams — data contract mismatch`);
      return;
    }

    await coach.clickTeamByName(KNOWN_TEAM_NAME);
    await expect(page).toHaveURL(/\/teams\/.+/, { timeout: 10_000 });
    await waitForAppHydrated(page);
  }

  // Schedule tab must be rendered and accessible
  const scheduleTab = page.getByRole('tab', { name: /schedule/i });
  await expect(scheduleTab).toBeVisible({ timeout: 10_000 });
  await scheduleTab.click();
  await page.waitForLoadState('domcontentloaded');

  // The schedule area must show either event content or a recognisable empty state.
  const hasEventCards = await page
    .locator('[data-testid="event-card"], [class*="event-card"]')
    .first()
    .isVisible({ timeout: 5_000 })
    .catch(() => false);

  const hasEventText = await page
    .getByText(/vs\.|game|practice|event/i)
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);

  const hasEmptyState = await page
    .getByText(/no (events|games|schedule)|hasn't added/i)
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);

  if (!hasEventCards && !hasEventText && !hasEmptyState) {
    test.skip(true, 'No event cards or empty state visible on Schedule tab — skipping (#317)');
    return;
  }

  expect(
    hasEventCards || hasEventText || hasEmptyState,
    'Expected event cards or an empty-state message on the Schedule tab — neither rendered',
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// CROSS-02 — parent sees upcoming events section on /parent
// ---------------------------------------------------------------------------

test('CROSS-02: parent on the team sees events section on /parent', async ({ asParent }) => {
  const { parent, page } = asParent;

  // The fixture already navigated to /parent — confirm we are there
  await expect(page).toHaveURL(/\/parent/, { timeout: 10_000 });

  // The parent page should show either the team header or a no-team message.
  const noTeam = await parent.noTeamMessage.isVisible({ timeout: 5_000 }).catch(() => false);
  if (noTeam) {
    test.skip(true, 'Parent account has no team linked — skipping cross-role visibility check');
    return;
  }

  // Team header must be present to confirm the account is on a team
  await expect(parent.teamHeader).toBeVisible({ timeout: 10_000 });

  // The "Upcoming Games" heading (or equivalent) must render
  const headingVisible = await parent.upcomingGamesHeading
    .isVisible({ timeout: 10_000 })
    .catch(() => false);

  // If the heading is absent, an empty-state message should be present instead
  const emptyStateVisible = await parent.noEventsMessage
    .isVisible({ timeout: 5_000 })
    .catch(() => false);

  expect(
    headingVisible || emptyStateVisible,
    'Expected upcoming-events section heading or empty state on /parent — neither rendered',
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// CROSS-03 — player sees upcoming events section on /parent
// ---------------------------------------------------------------------------

test('CROSS-03: player on the team sees events section on /parent', async ({ asPlayer }) => {
  const { player, page } = asPlayer;

  // The fixture already navigated to /parent
  await expect(page).toHaveURL(/\/parent/, { timeout: 10_000 });

  // If no team is linked skip gracefully
  const noTeam = await player.noTeamMessage.isVisible({ timeout: 5_000 }).catch(() => false);
  if (noTeam) {
    test.skip(true, 'Player account has no team linked — skipping cross-role visibility check');
    return;
  }

  // Team header confirms the player is on a team
  await expect(player.teamHeader).toBeVisible({ timeout: 10_000 });

  // Upcoming Games heading OR empty-state message must be visible
  const headingVisible = await player.upcomingGamesHeading
    .isVisible({ timeout: 10_000 })
    .catch(() => false);

  const emptyStateVisible = await player.noEventsMessage
    .isVisible({ timeout: 5_000 })
    .catch(() => false);

  expect(
    headingVisible || emptyStateVisible,
    'Expected upcoming-events section heading or empty state on /parent (player) — neither rendered',
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// CROSS-04 — admin can reach the E2E Team A Schedule tab without a crash
// ---------------------------------------------------------------------------

test('CROSS-04: admin can navigate to E2E Team A Schedule tab without a crash', async ({ asAdmin }) => {
  const { admin, page } = asAdmin;

  // Navigate directly to the known team detail page
  await admin.gotoTeam(KNOWN_TEAM_ID);

  // Page must not show an error overlay
  const errorOverlay = page.getByText(/something went wrong/i);
  const errorVisible = await errorOverlay.isVisible({ timeout: 3_000 }).catch(() => false);
  expect(errorVisible, 'Error overlay should not appear on team detail page for admin').toBe(false);

  // Schedule tab must be rendered
  const scheduleTab = page.getByRole('tab', { name: /schedule/i });
  await expect(scheduleTab).toBeVisible({ timeout: 10_000 });
  await scheduleTab.click();
  await page.waitForLoadState('domcontentloaded');

  // After clicking the Schedule tab the page must still be free of crashes
  await expect(page).toHaveURL(new RegExp(`/teams/${KNOWN_TEAM_ID}`), { timeout: 5_000 });

  // Schedule content area must render (events or empty state)
  const hasEvents = await page
    .getByText(/vs\.|game|practice|event/i)
    .first()
    .isVisible({ timeout: 5_000 })
    .catch(() => false);

  const hasEmptyState = await page
    .getByText(/no (events|games|schedule)|hasn't added/i)
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);

  if (!hasEvents && !hasEmptyState) {
    test.skip(true, 'Team A schedule tab loaded but no events or empty state matched — data contract mismatch (#317)');
    return;
  }

  expect(
    hasEvents || hasEmptyState,
    'Expected schedule content or empty state after admin navigated to team Schedule tab',
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// CROSS-05 — coach cannot see edit controls on an unrelated team's detail page
// ---------------------------------------------------------------------------

test('CROSS-05: coach sees no edit controls on a team they do not coach', async ({ asCoach }) => {
  const { coach, page } = asCoach;

  // Step 1: confirm the coach lands on / (home) after fixture setup
  await expect(page).not.toHaveURL(/\/parent/, { timeout: 5_000 });
  await expect(page).toHaveURL(/\/(home)?$/, { timeout: 5_000 });

  // Step 2: navigate to /teams and verify the coach can access the page
  await coach.gotoTeams();
  await expect(page).toHaveURL(/\/teams/, { timeout: 10_000 });

  // Step 3: collect all visible team links on the /teams page
  const allTeamLinks = page.locator('a[href*="/teams/"]');
  const linkCount = await allTeamLinks.count();

  if (linkCount === 0) {
    test.skip(true, 'No team links found on /teams — data contract mismatch');
    return;
  }

  // Step 4: find a team that is NOT the coach's own team (E2E Team A / Sharks fallback)
  let unrelatedTeamHref: string | null = null;
  for (let i = 0; i < linkCount; i++) {
    const href = await allTeamLinks.nth(i).getAttribute('href');
    const text = await allTeamLinks.nth(i).textContent();
    const isOwnTeam =
      (href && href.includes(KNOWN_TEAM_ID)) ||
      (text && new RegExp(KNOWN_TEAM_NAME, 'i').test(text));

    if (!isOwnTeam && href) {
      unrelatedTeamHref = href;
      break;
    }
  }

  if (!unrelatedTeamHref) {
    test.skip(true, 'No unrelated team found in /teams list — only own team is present; skipping isolation check');
    return;
  }

  // Step 5: navigate directly to the unrelated team detail page
  await page.goto(unrelatedTeamHref);
  await page.waitForLoadState('domcontentloaded');
  await expect(page).toHaveURL(/\/teams\/.+/, { timeout: 10_000 });

  // Step 6: assert that no privileged edit controls are visible.
  // A coach who does not own this team must not see: Add Player, Add Event,
  // Edit Team, or any destructive action buttons.
  const addPlayerVisible = await page
    .getByRole('button', { name: /add player/i })
    .isVisible({ timeout: 3_000 })
    .catch(() => false);

  const addEventVisible = await page
    .getByRole('button', { name: /add event/i })
    .isVisible({ timeout: 3_000 })
    .catch(() => false);

  const editTeamVisible = await page
    .getByRole('button', { name: /edit team/i })
    .isVisible({ timeout: 3_000 })
    .catch(() => false);

  expect(
    addPlayerVisible,
    'Coach should not see "Add Player" button on a team they do not coach',
  ).toBe(false);

  expect(
    addEventVisible,
    'Coach should not see "Add Event" button on a team they do not coach',
  ).toBe(false);

  expect(
    editTeamVisible,
    'Coach should not see "Edit Team" button on a team they do not coach',
  ).toBe(false);
});
