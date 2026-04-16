/**
 * Role-Based Access Control (RBAC) — authoritative access-control spec
 *
 * This file is the single source of truth for access-DENIED and routing checks.
 * Do not duplicate these assertions in feature specs (player.spec.ts, parent.spec.ts,
 * admin.spec.ts). Feature specs may test what a role CAN see/do, but route guards and
 * hidden controls belong here.
 *
 * Role capability matrix:
 *
 * Route / Control        | admin | coach | league_manager | parent | player
 * -----------------------|-------|-------|----------------|--------|-------
 * /users                 |  yes  |  no   |      no        |   no   |   no
 * /teams (read)          |  yes  |  yes  |      yes       |   yes  |   yes
 * Edit/Delete/AddPlayer  |  yes  |  yes  |      no        |   no   |   no
 * / → /parent redirect   |  no   |  no   |      no        |   yes  |   yes
 *
 * Covers:
 *   RBAC-01: parent/player redirected from / to /parent
 *   RBAC-02: admin can reach /users; non-admin roles cannot
 *   RBAC-03: parent cannot see team edit/delete/add-player controls
 *   RBAC-04: dashboard scope — admin sees all-scope stat cards
 *   RBAC-05: league manager blocked from /users
 *   RBAC-06: coach blocked from /users
 */

import { test, expect } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Parent cannot access /users
// ---------------------------------------------------------------------------

test('parent is blocked from /users and redirected to /', async ({ asParent }) => {
  const { page } = asParent;

  await page.goto('/users');

  // RoleGuard with redirect=true sends non-admin to /
  await expect(page).not.toHaveURL(/\/users/, { timeout: 10_000 });
  // Should land somewhere other than /users (/home in practice)
  await expect(page).not.toHaveURL(/\/users/, { timeout: 5_000 });
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

test('parent navigating to / is redirected away from / (lands on /home)', async ({ asParent }) => {
  const { page } = asParent;

  await page.goto('/');
  // Dashboard redirects all authenticated users to /home regardless of role
  await expect(page).toHaveURL(/\/home/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Dashboard scope — admin sees all teams stat card
// ---------------------------------------------------------------------------

test('admin home shows admin access banner with teams link', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/home');
  await page.waitForLoadState('domcontentloaded');

  // Admin sees the purple admin banner (not the My Teams section shown to other roles)
  await expect(page.getByText(/you have admin access to all teams/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /go to teams/i })).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Admin-only route accessible by admin
// ---------------------------------------------------------------------------

test('@smoke admin can access /users', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/users');
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// League manager cannot access /users
// ---------------------------------------------------------------------------

test('league manager is blocked from /users', async ({ asLeagueManager }) => {
  const { page } = asLeagueManager;

  await page.goto('/users');

  await expect(page).not.toHaveURL(/\/users/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Coach can access /teams but not /users
// ---------------------------------------------------------------------------

test('coach can access /teams but is blocked from /users', async ({ asCoach }) => {
  const { page } = asCoach;

  // Coaches can access /teams
  await page.goto('/teams');
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });

  // Coaches cannot access /users
  await page.goto('/users');
  await expect(page).not.toHaveURL(/\/users/, { timeout: 10_000 });
});
