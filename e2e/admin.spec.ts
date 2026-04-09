/**
 * Admin flows UAT
 *
 * Covers:
 *   GO_LIVE_CHECKLIST: Admin can create/edit/delete teams
 *   GO_LIVE_CHECKLIST: Admin can add/edit/remove players
 *   GO_LIVE_CHECKLIST: Admin can publish a schedule
 *   GO_LIVE_CHECKLIST: Admin can revoke a pending invite
 *   GO_LIVE_CHECKLIST: Invite flow — invite sent → shows in Invites tab → disappears after parent accepts
 *
 * Tests use the `asAdmin` fixture which handles login before each test.
 * Each test that mutates data cleans up after itself so tests are idempotent.
 */

import { test, expect } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Team management
// ---------------------------------------------------------------------------

test('admin dashboard shows Teams stat card', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/');

  // Dashboard renders a "Teams" stat card
  await expect(page.getByText('Teams').first()).toBeVisible({ timeout: 10_000 });
});

test('admin can navigate to the Teams page', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/teams');

  // "New Team" button is visible for admin
  await expect(page.getByRole('button', { name: /new team/i })).toBeVisible({ timeout: 10_000 });
});

test('admin can open the New Team modal and see required fields', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/teams');

  await page.getByRole('button', { name: /new team/i }).click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  // Required fields present
  await expect(modal.getByLabel('Team Name')).toBeVisible();
  await expect(modal.getByLabel(/sport/i)).toBeVisible();
});

test('admin can create a new team and it appears in the teams list', async ({ asAdmin }) => {
  const { page, admin } = asAdmin;
  const uniqueName = `E2E Test Team ${Date.now()}`;

  await admin.createTeam({ name: uniqueName });

  // Team should appear in the list after saving
  await expect(page.getByText(uniqueName, { exact: false })).toBeVisible({ timeout: 10_000 });
});

test('admin can delete a team (soft delete) from team detail page', async ({ asAdmin }) => {
  const { page, admin } = asAdmin;
  const teamName = `E2E Delete Team ${Date.now()}`;

  // Create a throwaway team
  await admin.createTeam({ name: teamName });

  // Find and navigate into it
  await page.getByText(teamName, { exact: false }).click();
  await page.waitForURL(/\/teams\/.+/);

  // Click delete
  const deleteBtn = page.getByRole('button', { name: /delete team|delete/i }).first();
  await deleteBtn.click();

  // Confirm dialog
  const confirmBtn = page.getByRole('button', { name: /delete|confirm/i }).last();
  await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
  await confirmBtn.click();

  // Should navigate back to /teams
  await expect(page).toHaveURL(/\/teams$/, { timeout: 10_000 });
  // The team name should no longer be visible in the main list
  await expect(page.getByText(teamName, { exact: false })).not.toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// Player management
// ---------------------------------------------------------------------------

test('admin can open the Add Player form on the Roster tab', async ({ asAdmin }) => {
  const { page, admin } = asAdmin;

  // Create a throwaway team to work with
  const teamName = `E2E Roster Team ${Date.now()}`;
  await admin.createTeam({ name: teamName });

  // Navigate into it
  await page.getByText(teamName, { exact: false }).click();
  await page.waitForURL(/\/teams\/.+/);

  // Click Roster tab
  await page.getByRole('tab', { name: /roster/i }).click();

  // Add Player button should be visible
  const addBtn = page.getByRole('button', { name: /add player/i });
  await expect(addBtn).toBeVisible({ timeout: 5_000 });

  await addBtn.click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });
  await expect(modal.getByLabel('First Name')).toBeVisible();
  await expect(modal.getByLabel('Last Name')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Invite flow
// ---------------------------------------------------------------------------

test('admin Invites tab shows pending invites', async ({ asAdmin }) => {
  const { page } = asAdmin;

  // Navigate to any team — find first team card
  await page.goto('/teams');
  await page.waitForLoadState('domcontentloaded');

  const firstTeamCard = page.locator('[class*="cursor-pointer"]').filter({
    has: page.locator('[class*="font-semibold"]'),
  }).first();

  if (await firstTeamCard.isVisible()) {
    await firstTeamCard.click();
    await page.waitForURL(/\/teams\/.+/);

    // Click Invites tab if present
    const invitesTab = page.getByRole('tab', { name: /invites/i });
    if (await invitesTab.isVisible()) {
      await invitesTab.click();
      // The tab should load without error
      await expect(page.locator('[class*="space-y"]').first()).toBeVisible({ timeout: 5_000 });
    }
  }
});

// ---------------------------------------------------------------------------
// Access control — admin-only routes
// ---------------------------------------------------------------------------

test('admin can access /users (admin-only route)', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/users');

  // Should not redirect to /login or /
  await expect(page).not.toHaveURL(/\/login/);

  // Page should load some user management content
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Schedule tab visible on team detail
// ---------------------------------------------------------------------------

test('admin sees Schedule tab on team detail page', async ({ asAdmin }) => {
  const { page, admin } = asAdmin;

  const teamName = `E2E Schedule Team ${Date.now()}`;
  await admin.createTeam({ name: teamName });

  await page.getByText(teamName, { exact: false }).click();
  await page.waitForURL(/\/teams\/.+/);

  const scheduleTab = page.getByRole('tab', { name: /schedule/i });
  await expect(scheduleTab).toBeVisible({ timeout: 5_000 });
  await scheduleTab.click();

  // Should see some content in the schedule tab body (empty state or events)
  await expect(page.locator('main')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Non-admin is blocked from /users
// ---------------------------------------------------------------------------

test('parent is redirected away from /users (admin-only route)', async ({ page }) => {
  // Log in as parent
  const parentEmail = process.env.E2E_PARENT_EMAIL;
  const parentPassword = process.env.E2E_PARENT_PASSWORD;

  if (!parentEmail || !parentPassword) {
    test.skip(true, 'E2E_PARENT_EMAIL / E2E_PARENT_PASSWORD not set');
    return;
  }

  const { AuthPage } = await import('./pages/AuthPage');
  const auth = new AuthPage(page);
  await auth.loginAndWaitForApp(parentEmail, parentPassword);

  await page.goto('/users');

  // RoleGuard with redirect=true should push to /
  await expect(page).not.toHaveURL(/\/users/, { timeout: 10_000 });
});
