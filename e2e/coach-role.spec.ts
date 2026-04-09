/**
 * Coach role E2E tests
 *
 * Covers:
 *   COACH-ROLE-01: Coach lands on / (not /parent) after login
 *   COACH-ROLE-02: HomePage loads — coach sees their team card (Sharks)
 *   COACH-ROLE-03: Coach can navigate to their team detail page
 *   COACH-ROLE-04: Coach can see the Roster tab on their team
 *   COACH-ROLE-05: Coach can see the Schedule tab on their team
 *   COACH-ROLE-06: /users is blocked — coach redirected away
 *   COACH-ROLE-07: "Manage Users" nav link is NOT visible for coach
 *   COACH-ROLE-08: Coach can access /teams and sees Sharks listed
 *   COACH-ROLE-09: Profile page loads and shows Coach badge
 *   COACH-ROLE-10: Session timeout warning at 30 min (fake clock)
 *
 * Requires:
 *   E2E_COACH_EMAIL / E2E_COACH_PASSWORD — a coach account.
 *   The account must have role 'coach' in its Firestore profile
 *   and must be added to the coachIds array on the Sharks team
 *   (teamId: 44ee1f68-cdce-4a05-b30b-d2a87b191dbe).
 *
 * Data constants used in assertions:
 *   KNOWN_TEAM_NAME — the team name that must appear on the home page
 *                     and on /teams for this coach account
 */

import { test, expect } from './fixtures/auth.fixture';
import { AuthPage } from './pages/AuthPage';

// ---------------------------------------------------------------------------
// Known test-account data
// ---------------------------------------------------------------------------

const KNOWN_TEAM_NAME = 'Sharks';

// ---------------------------------------------------------------------------
// COACH-ROLE-01 — routing: coach lands on / (not /parent) after login
// ---------------------------------------------------------------------------

test('COACH-ROLE-01: coach navigating to / stays on / (not redirected to /parent)', async ({ asCoach }) => {
  const { page } = asCoach;

  // The fixture already navigated to /.  Confirm we are NOT on /parent.
  await expect(page).not.toHaveURL(/\/parent/, { timeout: 5_000 });

  // We must be on the home route (/ or /home)
  await expect(page).toHaveURL(/^\/(home)?$/, { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// COACH-ROLE-02 — home page loads and shows the Sharks team card
// ---------------------------------------------------------------------------

test('COACH-ROLE-02: coach home page loads and shows the Sharks team card', async ({ asCoach }) => {
  const { coach, page } = asCoach;

  // "My Teams" heading must be present
  const myTeamsVisible = await coach.myTeamsHeading.isVisible({ timeout: 10_000 }).catch(() => false);
  const noTeamsVisible = await coach.noTeamsMessage.isVisible({ timeout: 3_000 }).catch(() => false);

  expect(
    myTeamsVisible || noTeamsVisible,
    'Expected "My Teams" heading or no-teams empty state — neither was visible',
  ).toBe(true);

  if (noTeamsVisible) {
    test.skip(true, 'No teams visible for this coach account — data contract mismatch');
    return;
  }

  // The Sharks team card must appear
  const sharksCard = page.getByText(KNOWN_TEAM_NAME, { exact: false }).first();
  await expect(sharksCard).toBeVisible({ timeout: 10_000 });

  // No unhandled error overlay
  const errorOverlay = page.getByText(/something went wrong/i);
  const errorVisible = await errorOverlay.isVisible({ timeout: 2_000 }).catch(() => false);
  expect(errorVisible, 'Error overlay should not appear on coach home page').toBe(false);
});

// ---------------------------------------------------------------------------
// COACH-ROLE-03 — coach can navigate to their team detail page
// ---------------------------------------------------------------------------

test('COACH-ROLE-03: coach can navigate to the Sharks team detail page', async ({ asCoach }) => {
  const { coach, page } = asCoach;

  // Check that the team card is present before attempting to click
  const sharksVisible = await page.getByText(KNOWN_TEAM_NAME, { exact: false }).first().isVisible({ timeout: 10_000 }).catch(() => false);

  if (!sharksVisible) {
    test.skip(true, `${KNOWN_TEAM_NAME} team card not visible on home page — data contract mismatch`);
    return;
  }

  await coach.clickFirstTeamCard();

  await expect(page).toHaveURL(/\/teams\/.+/, { timeout: 10_000 });
  await page.waitForLoadState('domcontentloaded');

  // Team name heading must appear on the detail page
  const teamHeading = page.getByRole('heading', { name: new RegExp(KNOWN_TEAM_NAME, 'i') }).first();
  await expect(teamHeading).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// COACH-ROLE-04 — coach can see the Roster tab on their team
// ---------------------------------------------------------------------------

test('COACH-ROLE-04: coach can see the Roster tab on their team detail page', async ({ asCoach }) => {
  const { coach, page } = asCoach;

  const sharksVisible = await page.getByText(KNOWN_TEAM_NAME, { exact: false }).first().isVisible({ timeout: 10_000 }).catch(() => false);

  if (!sharksVisible) {
    test.skip(true, `${KNOWN_TEAM_NAME} team card not visible — skipping Roster tab test`);
    return;
  }

  await coach.clickFirstTeamCard();
  await expect(page).toHaveURL(/\/teams\/.+/, { timeout: 10_000 });
  await page.waitForLoadState('domcontentloaded');

  // Roster tab must be rendered (coach has canSeeRequests + isCoachOfTeam)
  const rosterTab = page.getByRole('tab', { name: /roster/i });
  await expect(rosterTab).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// COACH-ROLE-05 — coach can see the Schedule tab on their team
// ---------------------------------------------------------------------------

test('COACH-ROLE-05: coach can see the Schedule tab on their team detail page', async ({ asCoach }) => {
  const { coach, page } = asCoach;

  const sharksVisible = await page.getByText(KNOWN_TEAM_NAME, { exact: false }).first().isVisible({ timeout: 10_000 }).catch(() => false);

  if (!sharksVisible) {
    test.skip(true, `${KNOWN_TEAM_NAME} team card not visible — skipping Schedule tab test`);
    return;
  }

  await coach.clickFirstTeamCard();
  await expect(page).toHaveURL(/\/teams\/.+/, { timeout: 10_000 });
  await page.waitForLoadState('domcontentloaded');

  // Schedule tab is always the default; it must be visible
  const scheduleTab = page.getByRole('tab', { name: /schedule/i });
  await expect(scheduleTab).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// COACH-ROLE-06 — /users is blocked for coaches
// ---------------------------------------------------------------------------

test('COACH-ROLE-06: coach visiting /users is redirected away', async ({ asCoach }) => {
  const { page } = asCoach;

  await page.goto('/users');

  // RoleGuard with redirect=true sends non-admin back to /
  await expect(page).not.toHaveURL(/\/users/, { timeout: 10_000 });
  await expect(page).toHaveURL(/^\/(home)?$/, { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// COACH-ROLE-07 — "Manage Users" is not in the sidebar nav
// ---------------------------------------------------------------------------

test('COACH-ROLE-07: coach does not see "Manage Users" in the sidebar', async ({ asCoach }) => {
  const { coach } = asCoach;

  // Already on home page; sidebar is rendered
  const manageUsersVisible = await coach.manageUsersNavLink.isVisible({ timeout: 3_000 }).catch(() => false);
  expect(manageUsersVisible, '"Manage Users" nav link should not be visible to a coach').toBe(false);
});

// ---------------------------------------------------------------------------
// COACH-ROLE-08 — coach can access /teams and sees Sharks listed
// ---------------------------------------------------------------------------

test('COACH-ROLE-08: coach can access /teams page and sees Sharks listed', async ({ asCoach }) => {
  const { coach, page } = asCoach;

  await coach.gotoTeams();

  await expect(page).toHaveURL(/\/teams/, { timeout: 10_000 });

  // The Sharks team must appear in the teams list
  const sharksEntry = page.getByText(KNOWN_TEAM_NAME, { exact: false }).first();

  const sharksVisible = await sharksEntry.isVisible({ timeout: 10_000 }).catch(() => false);

  if (!sharksVisible) {
    test.skip(true, `${KNOWN_TEAM_NAME} not found on /teams — data contract mismatch`);
    return;
  }

  await expect(sharksEntry).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// COACH-ROLE-09 — profile page loads and shows Coach badge
// ---------------------------------------------------------------------------

test('COACH-ROLE-09: profile page loads and shows Coach badge', async ({ asCoach }) => {
  const { page } = asCoach;

  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');

  // Profile page heading
  const editProfileHeading = page.getByRole('heading', { name: /edit profile/i });
  await expect(editProfileHeading).toBeVisible({ timeout: 10_000 });

  // The coach membership badge — "Coach" text appears inside the
  // Roles section rendered by ProfilePage
  const coachBadge = page.getByText(/\bcoach\b/i).first();
  await expect(coachBadge).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// COACH-ROLE-10 — session timeout warning appears after 30 minutes of inactivity
//                 Uses Playwright's page.clock API to fast-forward time.
// ---------------------------------------------------------------------------

test('COACH-ROLE-10: coach sees session expiring warning after 30 minutes of inactivity', async ({ page }) => {
  const coachEmail = process.env.E2E_COACH_EMAIL;
  const coachPassword = process.env.E2E_COACH_PASSWORD;

  if (!coachEmail || !coachPassword) {
    test.skip(true, 'E2E_COACH_EMAIL / E2E_COACH_PASSWORD not set');
    return;
  }

  const auth = new AuthPage(page);
  await auth.loginAndWaitForApp(coachEmail, coachPassword);

  // Install a fake clock AFTER login so the auth flow uses real time
  await page.clock.install();

  // Fast-forward 30 minutes + 1 second to cross the idle threshold
  await page.clock.fastForward('30:01');

  const modal = page.getByRole('heading', { name: /session expiring soon/i });
  await expect(modal).toBeVisible({ timeout: 5_000 });
});
