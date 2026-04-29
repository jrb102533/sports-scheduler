/**
 * @emu @lm League Manager role flows (migrated from e2e/lm-role.spec.ts)
 *
 * Covers:
 *   LM-01: LM lands on / (not /parent) after login
 *   LM-02: HomePage loads without crashing
 *   LM-03: /leagues page is accessible
 *   LM-04: LM sees their managed league listed
 *   LM-05: /users is blocked
 *   LM-06: "Manage Users" not in sidebar
 *   LM-07: Profile page shows League Manager badge
 *   LM-08: LM can navigate into a team detail page for a team in their league
 *   LM-09: Team detail page does NOT show delete-team button for LM
 *
 * LM-10 (session timeout) is intentionally excluded — the page.clock pattern
 * needs a fresh login flow which doesn't compose with the pre-authed lmPage
 * fixture. Worth covering separately if/when we add a session-timeout emu spec.
 *
 * Seeded data used:
 *   - emu-lm (manager of Emu League, subscriptionTier=league_manager_pro)
 *   - Emu League (containing Emu Team A and Emu Team B)
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';
import { EMU_IDS } from '../seed-emulator.js';

const LEAGUE_NAME = 'Emu League';
const TEAM_NAMES = ['Emu Team A', 'Emu Team B'];

// ---------------------------------------------------------------------------
// LM-01 — routing: LM lands on / (not /parent) after login
// ---------------------------------------------------------------------------

test('@emu @lm LM-01 league manager navigating to / stays on /home (not /parent)', async ({ lmPage }) => {
  await lmPage.goto('/');
  await expect(lmPage).not.toHaveURL(/\/parent/, { timeout: 5_000 });
  await expect(lmPage).toHaveURL(/\/(home)?$/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// LM-02 — home page loads without crashing
// ---------------------------------------------------------------------------

test('@emu @lm LM-02 league manager home page renders without an error overlay', async ({ lmPage }) => {
  await lmPage.goto('/home');
  await lmPage.waitForLoadState('domcontentloaded');

  await expect(lmPage).toHaveURL(/\/home/, { timeout: 10_000 });
  await expect(lmPage.locator('main')).toBeVisible({ timeout: 10_000 });

  const errorVisible = await lmPage.getByText(/something went wrong/i)
    .isVisible({ timeout: 2_000 }).catch(() => false);
  expect(errorVisible, 'Error overlay should not appear on LM home page').toBe(false);
});

// ---------------------------------------------------------------------------
// LM-03 — /leagues page is accessible
// ---------------------------------------------------------------------------

test('@emu @lm LM-03 league manager can access /leagues page', async ({ lmPage }) => {
  await lmPage.goto('/leagues');
  await expect(lmPage).toHaveURL(/\/leagues/, { timeout: 10_000 });
  await expect(lmPage).not.toHaveURL(/\/login/);
  await expect(lmPage.locator('main')).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// LM-04 — LM sees their managed league listed
// ---------------------------------------------------------------------------

test('@emu @lm LM-04 LM sees their managed league listed on /leagues', async ({ lmPage }) => {
  await lmPage.goto('/leagues');
  await expect(lmPage.getByText(LEAGUE_NAME, { exact: false }).first())
    .toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// LM-05 — /users is blocked
// ---------------------------------------------------------------------------

test('@emu @lm LM-05 league manager visiting /users is redirected away', async ({ lmPage }) => {
  await lmPage.goto('/users');
  await expect(lmPage).not.toHaveURL(/\/users/, { timeout: 10_000 });
  await expect(lmPage).toHaveURL(/\/(home)?$/, { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// LM-06 — "Manage Users" is not in sidebar
// ---------------------------------------------------------------------------

test('@emu @lm LM-06 league manager does not see Manage Users in sidebar', async ({ lmPage }) => {
  await lmPage.goto('/home');
  await lmPage.waitForLoadState('domcontentloaded');

  const manageUsersVisible = await lmPage.getByRole('link', { name: /manage users/i })
    .or(lmPage.getByRole('button', { name: /manage users/i }))
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);

  expect(manageUsersVisible, 'Manage Users nav link should not be visible to LM').toBe(false);
});

// ---------------------------------------------------------------------------
// LM-07 — Profile page shows League Manager badge
// ---------------------------------------------------------------------------

test('@emu @lm LM-07 profile page loads and shows League Manager badge', async ({ lmPage }) => {
  await lmPage.goto('/profile');
  await lmPage.waitForLoadState('domcontentloaded');

  await expect(lmPage.getByRole('heading', { name: /edit profile/i }))
    .toBeVisible({ timeout: 10_000 });
  await expect(lmPage.getByText(/league manager/i).first())
    .toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// LM-08 — LM can navigate to a team detail page for a team in their league
// ---------------------------------------------------------------------------

test('@emu @lm LM-08 league manager can open a team detail page from their league', async ({ lmPage }) => {
  // Navigate directly to the league detail page — LeagueCard's onClick is
  // wrapped, and clicking the league-name text doesn't reliably bubble to it.
  await lmPage.goto(`/leagues/${EMU_IDS.leagueId}`);
  await lmPage.waitForLoadState('domcontentloaded');
  await expect(lmPage).toHaveURL(/\/leagues\/.+/, { timeout: 10_000 });

  await lmPage.getByRole('tab', { name: /teams/i }).click();
  await lmPage.waitForLoadState('domcontentloaded');

  // At least one of the seeded teams must be visible on the Teams tab
  await expect(lmPage.getByText(TEAM_NAMES[0]!, { exact: false }).first())
    .toBeVisible({ timeout: 10_000 });

  // Navigate directly to the team detail page (avoiding any card-click bubble issues)
  await lmPage.goto(`/teams/${EMU_IDS.teamAId}`);
  await lmPage.waitForURL(/\/teams\/.+/, { timeout: 10_000 });
  await expect(lmPage.getByRole('heading').first()).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// LM-09 — Team detail page does NOT show delete-team button for LM
// ---------------------------------------------------------------------------

test('@emu @lm LM-09 team detail page does not show delete-team button for LM', async ({ lmPage }) => {
  // Direct navigation — the LM is a manager of Emu League which contains Emu Team A
  await lmPage.goto(`/teams/${EMU_IDS.teamAId}`);
  await lmPage.waitForURL(/\/teams\/.+/, { timeout: 10_000 });
  await lmPage.waitForLoadState('domcontentloaded');
  await expect(lmPage.getByRole('heading').first()).toBeVisible({ timeout: 10_000 });

  // The Delete button only renders for team owner (createdBy/coachId) or admin.
  // The LM owns neither — no delete button should appear.
  const deleteVisible = await lmPage.getByRole('button', { name: /delete/i })
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
  expect(deleteVisible, 'Delete Team button should not be visible to LM on a team they do not own').toBe(false);
});
