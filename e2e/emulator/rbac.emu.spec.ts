/**
 * @emu RBAC — Role-Based Access Control (migrated from e2e/rbac.spec.ts)
 *
 * Authoritative access-control spec. Single source of truth for access-DENIED
 * and routing checks; do not duplicate these in feature specs.
 *
 * Role capability matrix:
 *
 * Route / Control        | admin | coach | league_manager | parent | player
 * -----------------------|-------|-------|----------------|--------|-------
 * /users                 |  yes  |  no   |      no        |   no   |   no
 * /teams (read)          |  yes  |  yes  |      yes       |   yes  |   yes
 * Edit/Delete/AddPlayer  |  yes  |  yes  |      no        |   no   |   no
 *
 * Seeded data used:
 *   - emu-admin (admin claim)
 *   - emu-coach (coach of emu-team-a)
 *   - emu-lm (league_manager of emu-league)
 *   - emu-parent (parent linked to emu-team-a)
 *   - emu-player (player linked to emu-team-a)
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';
import { EMU_IDS } from '../seed-emulator.js';

// ---------------------------------------------------------------------------
// Parent cannot access /users
// ---------------------------------------------------------------------------

test('@emu @rbac parent is blocked from /users', async ({ parentPage }) => {
  await parentPage.goto('/users');

  // RoleGuard sends non-admin away from /users
  await expect(parentPage).not.toHaveURL(/\/users/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Parent cannot see edit controls on team detail page
// ---------------------------------------------------------------------------

test('@emu @rbac parent on team detail page sees no edit/delete/add-player controls', async ({ parentPage }) => {
  // Navigate directly to the seeded team's detail page rather than relying on
  // the /teams listing — parent visibility into the team list is governed by
  // a different code path and tested elsewhere. This test isolates the
  // "no edit controls for parent on a team they DO have access to" assertion.
  await parentPage.goto(`/teams/${EMU_IDS.teamAId}`);
  await parentPage.waitForLoadState('domcontentloaded');
  await expect(parentPage).toHaveURL(/\/teams\/.+/, { timeout: 10_000 });

  // None of the admin/coach controls should render for a parent.
  const editTeamBtn = parentPage.getByRole('button', { name: /edit team|edit/i }).first();
  const deleteTeamBtn = parentPage.getByRole('button', { name: /delete team|delete/i }).first();
  const addPlayerBtn = parentPage.getByRole('button', { name: /add player/i }).first();

  const editVisible = await editTeamBtn.isVisible({ timeout: 2_000 }).catch(() => false);
  const deleteVisible = await deleteTeamBtn.isVisible({ timeout: 2_000 }).catch(() => false);
  const addPlayerVisible = await addPlayerBtn.isVisible({ timeout: 2_000 }).catch(() => false);

  expect(editVisible, 'Edit Team button should not be visible to parent').toBe(false);
  expect(deleteVisible, 'Delete Team button should not be visible to parent').toBe(false);
  expect(addPlayerVisible, 'Add Player button should not be visible to parent').toBe(false);
});

// ---------------------------------------------------------------------------
// Parent at / lands on /home (dashboard redirects all authenticated users)
// ---------------------------------------------------------------------------

test('@emu @rbac parent navigating to / lands on /home', async ({ parentPage }) => {
  await parentPage.goto('/');
  await expect(parentPage).toHaveURL(/\/home/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Admin home banner — confirms admin role gating on the home view
// ---------------------------------------------------------------------------

test('@emu @rbac admin home shows admin access banner with teams link', async ({ adminPage }) => {
  await adminPage.goto('/home');
  await adminPage.waitForLoadState('domcontentloaded');

  await expect(adminPage.getByText(/you have admin access to all teams/i)).toBeVisible({ timeout: 10_000 });
  await expect(adminPage.getByRole('button', { name: /go to teams/i })).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Admin can access /users (admin-only route)
// ---------------------------------------------------------------------------

test('@emu @rbac admin can access /users', async ({ adminPage }) => {
  await adminPage.goto('/users');
  await expect(adminPage).not.toHaveURL(/\/login/, { timeout: 10_000 });
  await expect(adminPage.locator('main')).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// League manager cannot access /users
// ---------------------------------------------------------------------------

test('@emu @rbac league manager is blocked from /users', async ({ lmPage }) => {
  await lmPage.goto('/users');
  await expect(lmPage).not.toHaveURL(/\/users/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Coach can access /teams but not /users
// ---------------------------------------------------------------------------

test('@emu @rbac coach can access /teams but is blocked from /users', async ({ coachPage }) => {
  // Coach can read /teams
  await coachPage.goto('/teams');
  await expect(coachPage).not.toHaveURL(/\/login/, { timeout: 10_000 });
  await expect(coachPage.locator('main')).toBeVisible({ timeout: 10_000 });

  // But not /users
  await coachPage.goto('/users');
  await expect(coachPage).not.toHaveURL(/\/users/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Player cannot access /users (added — completes the matrix)
// ---------------------------------------------------------------------------

test('@emu @rbac player is blocked from /users', async ({ playerPage }) => {
  await playerPage.goto('/users');
  await expect(playerPage).not.toHaveURL(/\/users/, { timeout: 10_000 });
});
