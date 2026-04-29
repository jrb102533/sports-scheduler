/**
 * @emu @coach Coach role flows (migrated from e2e/coach-role.spec.ts)
 *
 * Covers:
 *   COACH-ROLE-01: coach lands on /home (not /parent) after login
 *   COACH-ROLE-02: home page renders without error (team card OR empty state)
 *   COACH-ROLE-03: coach can open their team detail page
 *   COACH-ROLE-04: Roster tab visible on team detail
 *   COACH-ROLE-05: Schedule tab visible on team detail
 *   COACH-ROLE-07: "Manage Users" not in sidebar
 *   COACH-ROLE-08: /teams page renders for coach
 *   COACH-ROLE-09: profile page shows Coach badge
 *
 * Excluded / consolidated:
 *   COACH-ROLE-06 (/users blocked) — already in rbac.emu.spec.ts
 *   COACH-ROLE-10 (session timeout) — same exclusion as LM-10 / PARENT-ROLE-04
 *
 * Seeded data used:
 *   - emu-coach (coach of emu-team-a, displayName 'Emu Coach')
 *   - Emu Team A (coachId = emu-coach)
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';
import { EMU_IDS } from '../seed-emulator.js';

const TEAM_NAME = 'Emu Team A';

// ---------------------------------------------------------------------------
// COACH-ROLE-01 — coach lands on /home (not /parent)
// ---------------------------------------------------------------------------

test('@emu @coach COACH-ROLE-01 coach navigating to / lands on /home (not /parent)', async ({ coachPage }) => {
  await coachPage.goto('/');
  await expect(coachPage).not.toHaveURL(/\/parent/, { timeout: 5_000 });
  await expect(coachPage).toHaveURL(/\/(home)?$/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// COACH-ROLE-02 — home page renders without error
// ---------------------------------------------------------------------------

test('@emu @coach COACH-ROLE-02 coach home page renders without an error overlay', async ({ coachPage }) => {
  await coachPage.goto('/home');
  await coachPage.waitForLoadState('domcontentloaded');

  await expect(coachPage).toHaveURL(/\/home/, { timeout: 10_000 });
  await expect(coachPage.locator('main')).toBeVisible({ timeout: 10_000 });

  const errorVisible = await coachPage.getByText(/something went wrong/i)
    .isVisible({ timeout: 2_000 }).catch(() => false);
  expect(errorVisible, 'Error overlay should not appear on coach home page').toBe(false);
});

// ---------------------------------------------------------------------------
// COACH-ROLE-03 — coach can open their team detail page
// ---------------------------------------------------------------------------

test('@emu @coach COACH-ROLE-03 coach can open their team detail page', async ({ coachPage }) => {
  await coachPage.goto(`/teams/${EMU_IDS.teamAId}`);
  await coachPage.waitForLoadState('domcontentloaded');
  await expect(coachPage).toHaveURL(/\/teams\/.+/, { timeout: 10_000 });
  await expect(coachPage.getByRole('heading').first()).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// COACH-ROLE-04 — Roster tab visible on team detail
// ---------------------------------------------------------------------------

test('@emu @coach COACH-ROLE-04 coach sees Roster tab on team detail page', async ({ coachPage }) => {
  await coachPage.goto(`/teams/${EMU_IDS.teamAId}`);
  await coachPage.waitForLoadState('domcontentloaded');
  await expect(coachPage.getByRole('tab', { name: /roster/i }))
    .toBeVisible({ timeout: 30_000 });
});

// ---------------------------------------------------------------------------
// COACH-ROLE-05 — Schedule tab visible on team detail
// ---------------------------------------------------------------------------

test('@emu @coach COACH-ROLE-05 coach sees Schedule tab on team detail page', async ({ coachPage }) => {
  await coachPage.goto(`/teams/${EMU_IDS.teamAId}`);
  await coachPage.waitForLoadState('domcontentloaded');
  await expect(coachPage.getByRole('tab', { name: /schedule/i }))
    .toBeVisible({ timeout: 30_000 });
});

// ---------------------------------------------------------------------------
// COACH-ROLE-07 — "Manage Users" not in sidebar
// ---------------------------------------------------------------------------

test('@emu @coach COACH-ROLE-07 coach does not see Manage Users in sidebar', async ({ coachPage }) => {
  await coachPage.goto('/home');
  await coachPage.waitForLoadState('domcontentloaded');

  const manageUsersVisible = await coachPage.getByRole('link', { name: /manage users/i })
    .or(coachPage.getByRole('button', { name: /manage users/i }))
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
  expect(manageUsersVisible, 'Manage Users nav link should not be visible to coach').toBe(false);
});

// ---------------------------------------------------------------------------
// COACH-ROLE-08 — /teams page renders for coach
// ---------------------------------------------------------------------------

test('@emu @coach COACH-ROLE-08 coach can access /teams page', async ({ coachPage }) => {
  await coachPage.goto('/teams');
  await coachPage.waitForLoadState('domcontentloaded');
  await expect(coachPage).not.toHaveURL(/\/login/);
  await expect(coachPage.locator('main')).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// COACH-ROLE-09 — profile page shows Coach badge
// ---------------------------------------------------------------------------

test('@emu @coach COACH-ROLE-09 profile page loads and shows Coach role badge', async ({ coachPage }) => {
  await coachPage.goto('/profile');
  await coachPage.waitForLoadState('domcontentloaded');

  await expect(coachPage.getByRole('heading', { name: /edit profile/i }))
    .toBeVisible({ timeout: 10_000 });
  await expect(coachPage.getByText(/coach/i).first())
    .toBeVisible({ timeout: 5_000 });

  // Reference to keep TEAM_NAME used (for grep-context of seeded data)
  void TEAM_NAME;
});
