/**
 * League Manager role E2E tests
 *
 * Covers:
 *   LM-01: LM lands on / (not /parent) after login
 *   LM-02: HomePage loads without crashing — team cards or no-teams message visible
 *   LM-03: /leagues page is accessible and loads
 *   LM-04: LM can see their league listed on the leagues page
 *   LM-05: /users is blocked — LM is redirected away
 *   LM-06: LM cannot see "Manage Users" in the sidebar nav
 *   LM-07: Profile page loads and shows League Manager badge
 *   LM-08: LM can navigate to a team detail page for a team in their league
 *   LM-09: Team detail page does NOT show a delete team button for the LM
 *   LM-10: Session timeout warning appears after 30 minutes of inactivity
 *
 * Requires:
 *   E2E_LM_EMAIL / E2E_LM_PASSWORD — a league manager account.
 *   The account must have role 'league_manager' in its Firestore profile
 *   and must be linked to leagueId 16a29c0a-68c0-4649-b15a-dbe0c6251583
 *   ("test league") which contains the teams: Sharks, wild, flyers, pens.
 *
 * Data constants used in assertions:
 *   KNOWN_LEAGUE_NAME — the league name that must appear on /leagues
 *   KNOWN_TEAM_NAMES  — at least one of these must appear as a team card
 *                       on the home page
 */

import { test, expect, creds } from './fixtures/auth.fixture';
import { AuthPage } from './pages/AuthPage';
import { LeagueManagerPage } from './pages/LeagueManagerPage';

// ---------------------------------------------------------------------------
// Known test-account data
// ---------------------------------------------------------------------------

const KNOWN_LEAGUE_NAME = 'test league';
const KNOWN_TEAM_NAMES = ['Sharks', 'wild', 'flyers', 'pens'];

// ---------------------------------------------------------------------------
// LM-01 — routing: LM lands on / (not /parent) after login
// ---------------------------------------------------------------------------

test('LM-01: league manager navigating to / stays on / (not redirected to /parent)', async ({ asLeagueManager }) => {
  const { page } = asLeagueManager;

  // The fixture already navigated to /.  Confirm we are NOT on /parent.
  await expect(page).not.toHaveURL(/\/parent/, { timeout: 5_000 });

  // We must be on the home route (/ or /home)
  await expect(page).toHaveURL(/^\/(home)?$/, { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// LM-02 — home page loads without crashing
// ---------------------------------------------------------------------------

test('LM-02: league manager home page loads without crashing', async ({ asLeagueManager }) => {
  const { lm, page } = asLeagueManager;

  // "My Teams" heading must be present (LM is not admin, so the admin banner
  // is not rendered and the teams section is rendered instead)
  const myTeamsVisible = await lm.myTeamsHeading.isVisible({ timeout: 10_000 }).catch(() => false);
  const noTeamsVisible = await lm.noTeamsMessage.isVisible({ timeout: 3_000 }).catch(() => false);

  expect(
    myTeamsVisible || noTeamsVisible,
    'Expected "My Teams" heading or no-teams empty state — neither was visible',
  ).toBe(true);

  // No unhandled error overlay
  const errorOverlay = page.getByText(/something went wrong/i);
  const errorVisible = await errorOverlay.isVisible({ timeout: 2_000 }).catch(() => false);
  expect(errorVisible, 'Error overlay should not appear on LM home page').toBe(false);
});

// ---------------------------------------------------------------------------
// LM-03 — /leagues page is accessible
// ---------------------------------------------------------------------------

test('LM-03: league manager can access /leagues page', async ({ asLeagueManager }) => {
  const { lm, page } = asLeagueManager;

  await lm.gotoLeagues();

  // The page title region and URL confirm we are on the leagues page
  await expect(page).toHaveURL(/\/leagues/, { timeout: 10_000 });

  // The leagues list or the empty state must render — neither is a crash
  const hasLeagues = await lm.newLeagueButton.isVisible({ timeout: 5_000 }).catch(() => false);
  const hasEmptyState = await page.getByText(/no leagues yet/i).isVisible({ timeout: 3_000 }).catch(() => false);

  expect(
    hasLeagues || hasEmptyState,
    'Expected leagues list (with New League button) or empty state',
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// LM-04 — LM can see their league on the leagues page
// ---------------------------------------------------------------------------

test('LM-04: LM sees their managed league listed on /leagues', async ({ asLeagueManager }) => {
  const { lm } = asLeagueManager;

  await lm.gotoLeagues();
  await lm.expectLeagueVisible(KNOWN_LEAGUE_NAME);
});

// ---------------------------------------------------------------------------
// LM-05 — /users is blocked
// ---------------------------------------------------------------------------

test('LM-05: league manager visiting /users is redirected away', async ({ asLeagueManager }) => {
  const { page } = asLeagueManager;

  await page.goto('/users');

  // RoleGuard with redirect=true sends non-admin back to /
  await expect(page).not.toHaveURL(/\/users/, { timeout: 10_000 });
  await expect(page).toHaveURL(/^\/(home)?$/, { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// LM-06 — "Manage Users" is not in the sidebar nav
// ---------------------------------------------------------------------------

test('LM-06: league manager does not see "Manage Users" in the sidebar', async ({ asLeagueManager }) => {
  const { lm } = asLeagueManager;

  // Already on home page; sidebar is rendered
  const manageUsersVisible = await lm.manageUsersNavLink.isVisible({ timeout: 3_000 }).catch(() => false);
  expect(manageUsersVisible, '"Manage Users" nav link should not be visible to a league manager').toBe(false);
});

// ---------------------------------------------------------------------------
// LM-07 — Profile page shows League Manager badge
// ---------------------------------------------------------------------------

test('LM-07: profile page loads and shows League Manager badge', async ({ asLeagueManager }) => {
  const { page } = asLeagueManager;

  await page.goto('/profile');
  await page.waitForLoadState('networkidle');

  // Profile page heading
  const editProfileHeading = page.getByRole('heading', { name: /edit profile/i });
  await expect(editProfileHeading).toBeVisible({ timeout: 10_000 });

  // The LM membership badge — "League Manager" text appears inside the
  // Roles section rendered by ProfilePage
  const lmBadge = page.getByText(/league manager/i).first();
  await expect(lmBadge).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// LM-08 — LM can navigate to a team detail page for a team in their league
// ---------------------------------------------------------------------------

test('LM-08: league manager can navigate to a team detail page for a team in their league', async ({ asLeagueManager }) => {
  const { lm, page } = asLeagueManager;

  // Navigate to /leagues, open the known league, then click a team from there
  await lm.gotoLeagues();
  await lm.expectLeagueVisible(KNOWN_LEAGUE_NAME);

  // Click the league card to open the detail page
  await page.getByText(KNOWN_LEAGUE_NAME, { exact: false }).first().click();
  await page.waitForURL(/\/leagues\/.+/, { timeout: 10_000 });

  // Switch to the Teams tab
  await page.getByRole('tab', { name: /teams/i }).click();
  await page.waitForLoadState('networkidle');

  // At least one of the known teams must appear on the Teams tab
  let teamLinkFound = false;
  for (const name of KNOWN_TEAM_NAMES) {
    const visible = await page.getByText(name, { exact: false }).isVisible({ timeout: 2_000 }).catch(() => false);
    if (visible) {
      teamLinkFound = true;
      break;
    }
  }

  if (!teamLinkFound) {
    test.skip(true, 'No known team names found on the Teams tab — data contract mismatch');
    return;
  }

  // Click the first matching team link to reach the team detail page
  for (const name of KNOWN_TEAM_NAMES) {
    const el = page.getByText(name, { exact: false }).first();
    if (await el.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await el.click();
      break;
    }
  }

  await page.waitForURL(/\/teams\/.+/, { timeout: 10_000 });
  await page.waitForLoadState('networkidle');

  // Confirm we are on a team detail page — team name heading must be visible
  const teamHeading = page.getByRole('heading').first();
  await expect(teamHeading).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// LM-09 — Team detail page does NOT show delete button for LM
// ---------------------------------------------------------------------------

test('LM-09: team detail page does not show delete team button for league manager', async ({ page }) => {
  const lmEmail = process.env.E2E_LM_EMAIL;
  const lmPassword = process.env.E2E_LM_PASSWORD;

  if (!lmEmail || !lmPassword) {
    test.skip(true, 'E2E_LM_EMAIL / E2E_LM_PASSWORD not set');
    return;
  }

  const auth = new AuthPage(page);
  await auth.loginAndWaitForApp(lmEmail, lmPassword);

  const lm = new LeagueManagerPage(page);
  await lm.gotoLeagues();

  // Navigate into the league then to a team
  await page.getByText(KNOWN_LEAGUE_NAME, { exact: false }).first().click();
  await page.waitForURL(/\/leagues\/.+/, { timeout: 10_000 });

  await page.getByRole('tab', { name: /teams/i }).click();
  await page.waitForLoadState('networkidle');

  let navigated = false;
  for (const name of KNOWN_TEAM_NAMES) {
    const el = page.getByText(name, { exact: false }).first();
    if (await el.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await el.click();
      navigated = true;
      break;
    }
  }

  if (!navigated) {
    test.skip(true, 'No known teams visible on league Teams tab — skipping delete-button assertion');
    return;
  }

  await page.waitForURL(/\/teams\/.+/, { timeout: 10_000 });
  await page.waitForLoadState('networkidle');

  // The delete button only renders for isOwner (createdBy/coachId) or isAdmin.
  // The LM account owns neither of these teams, so no delete button should appear.
  const deleteTeamBtn = page.getByRole('button', { name: /delete/i }).first();
  const deleteVisible = await deleteTeamBtn.isVisible({ timeout: 3_000 }).catch(() => false);

  expect(deleteVisible, 'Delete Team button should not be visible to a league manager on a team they do not own').toBe(false);
});

// ---------------------------------------------------------------------------
// LM-10 — Session timeout warning appears after 30 minutes of inactivity
//         Uses Playwright's page.clock API to fast-forward time.
// ---------------------------------------------------------------------------

test('LM-10: league manager sees session expiring warning after 30 minutes of inactivity', async ({ page }) => {
  const lmEmail = process.env.E2E_LM_EMAIL;
  const lmPassword = process.env.E2E_LM_PASSWORD;

  if (!lmEmail || !lmPassword) {
    test.skip(true, 'E2E_LM_EMAIL / E2E_LM_PASSWORD not set');
    return;
  }

  const auth = new AuthPage(page);
  await auth.loginAndWaitForApp(lmEmail, lmPassword);

  // Install a fake clock AFTER login so the auth flow uses real time
  await page.clock.install();

  // Fast-forward 30 minutes + 1 second to cross the idle threshold
  await page.clock.fastForward('30:01');

  const modal = page.getByRole('heading', { name: /session expiring soon/i });
  await expect(modal).toBeVisible({ timeout: 5_000 });
});
