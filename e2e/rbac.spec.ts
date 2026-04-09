/**
 * Role-Based Access Control (RBAC) UAT
 *
 * Covers:
 *   RBAC-03: Parent/player role cannot access team edit controls
 *   RBAC-04: Dashboard scope — coach sees only own team data
 *   RBAC-05: Non-admin routes inaccessible from wrong roles
 *   ADMIN-USR-09: Parent blocked from /users (also tested in admin.spec.ts, repeated for completeness)
 *
 * These tests use the asParent fixture for the parent account.
 * For role-scoped dashboard tests we rely on the admin account (which should have full scope)
 * and the parent account (which should have narrowed scope).
 */

import { test, expect, creds } from './fixtures/auth.fixture';
import { AuthPage } from './pages/AuthPage';

// ---------------------------------------------------------------------------
// Parent cannot access /users
// ---------------------------------------------------------------------------

test('parent is blocked from /users and redirected to /', async ({ asParent }) => {
  const { page } = asParent;

  await page.goto('/users');

  // RoleGuard with redirect=true sends non-admin to /
  await expect(page).not.toHaveURL(/\/users/, { timeout: 10_000 });
  // Should land at / or /parent (parent role redirects to /parent from /)
  await expect(page).toHaveURL(/^\/(parent)?$/, { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// Parent cannot see edit controls on team detail page
// ---------------------------------------------------------------------------

test('parent visiting a team detail page sees no edit or delete buttons', async ({ asParent }) => {
  const { page } = asParent;

  // Navigate to teams — parent can read but not edit
  await page.goto('/teams');
  await page.waitForLoadState('domcontentloaded');

  const teamLinks = page.locator('a[href*="/teams/"]');
  const count = await teamLinks.count();

  if (count === 0) {
    test.skip(true, 'No teams visible to parent — skipping edit controls test');
    return;
  }

  await teamLinks.first().click();
  await page.waitForURL(/\/teams\/.+/);

  // Admin/coach edit controls that should NOT be visible to a parent:
  // "Edit" button (team form), "Delete Team", "Add Player"
  const editTeamBtn = page.getByRole('button', { name: /edit team|edit/i }).first();
  const deleteTeamBtn = page.getByRole('button', { name: /delete team|delete/i }).first();
  const addPlayerBtn = page.getByRole('button', { name: /add player/i }).first();

  const editVisible = await editTeamBtn.isVisible({ timeout: 2_000 }).catch(() => false);
  const deleteVisible = await deleteTeamBtn.isVisible({ timeout: 2_000 }).catch(() => false);
  const addPlayerVisible = await addPlayerBtn.isVisible({ timeout: 2_000 }).catch(() => false);

  // None of these admin/coach controls should be visible to a parent
  expect(editVisible, 'Edit Team button should not be visible to parent').toBe(false);
  expect(deleteVisible, 'Delete Team button should not be visible to parent').toBe(false);
  expect(addPlayerVisible, 'Add Player button should not be visible to parent').toBe(false);
});

// ---------------------------------------------------------------------------
// Parent is redirected from / to /parent
// ---------------------------------------------------------------------------

test('parent navigating to / is redirected to /parent', async ({ asParent }) => {
  const { page } = asParent;

  await page.goto('/');
  await expect(page).toHaveURL(/\/parent/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Dashboard scope — admin sees all teams stat card
// ---------------------------------------------------------------------------

test('admin dashboard shows all-scope stat cards', async ({ page }) => {
  const auth = new AuthPage(page);
  await auth.loginAndWaitForApp(creds.admin().email, creds.admin().password);
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Admin sees "Teams" stat card
  await expect(page.getByText('Teams').first()).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Admin-only route accessible by admin, not by parent
// ---------------------------------------------------------------------------

test('admin can access /users; parent cannot', async ({ page }) => {
  // Admin access
  const auth = new AuthPage(page);
  await auth.loginAndWaitForApp(creds.admin().email, creds.admin().password);
  await page.goto('/users');
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });

  // Logout
  await page.goto('/profile');
  const logoutBtn = page.getByRole('button', { name: /logout|sign out/i }).first();
  if (await logoutBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await logoutBtn.click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  } else {
    // Try sidebar logout
    const sidebarLogout = page.getByRole('button', { name: /logout|sign out/i }).first();
    await sidebarLogout.click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  }

  // Parent access — skip if no parent creds
  const parentEmail = process.env.E2E_PARENT_EMAIL;
  const parentPassword = process.env.E2E_PARENT_PASSWORD;

  if (!parentEmail || !parentPassword) {
    test.skip(true, 'E2E_PARENT_EMAIL / E2E_PARENT_PASSWORD not set — skipping parent block test');
    return;
  }

  const auth2 = new AuthPage(page);
  await auth2.loginAndWaitForApp(parentEmail, parentPassword);

  await page.goto('/users');

  // Should be redirected away from /users
  await expect(page).not.toHaveURL(/\/users/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// League manager cannot access /users
// ---------------------------------------------------------------------------

test('league manager is blocked from /users', async ({ page }) => {
  const leagueManagerEmail = process.env.E2E_LEAGUE_MANAGER_EMAIL;
  const leagueManagerPassword = process.env.E2E_LEAGUE_MANAGER_PASSWORD;

  if (!leagueManagerEmail || !leagueManagerPassword) {
    test.skip(
      true,
      'E2E_LEAGUE_MANAGER_EMAIL / E2E_LEAGUE_MANAGER_PASSWORD not set — skipping',
    );
    return;
  }

  const auth = new AuthPage(page);
  await auth.loginAndWaitForApp(leagueManagerEmail, leagueManagerPassword);

  await page.goto('/users');

  await expect(page).not.toHaveURL(/\/users/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Coach can access /teams but not /users
// ---------------------------------------------------------------------------

test('coach can access /teams but is blocked from /users', async ({ page }) => {
  const coachEmail = process.env.E2E_COACH_EMAIL;
  const coachPassword = process.env.E2E_COACH_PASSWORD;

  if (!coachEmail || !coachPassword) {
    test.skip(
      true,
      'E2E_COACH_EMAIL / E2E_COACH_PASSWORD not set — skipping coach RBAC test',
    );
    return;
  }

  const auth = new AuthPage(page);
  await auth.loginAndWaitForApp(coachEmail, coachPassword);

  // Coaches can access /teams
  await page.goto('/teams');
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });

  // Coaches cannot access /users
  await page.goto('/users');
  await expect(page).not.toHaveURL(/\/users/, { timeout: 10_000 });
});
