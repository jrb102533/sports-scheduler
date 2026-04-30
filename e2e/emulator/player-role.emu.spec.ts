/**
 * @emu @player Player role flows (migrated from e2e/player.spec.ts)
 *
 * Covers:
 *   PLAYER-ROLE-01: Player navigating to / lands on /home
 *   PLAYER-ROLE-02: Player home renders without crash (heading + event list or empty state)
 *   PLAYER-ROLE-03: Player home does not display parent-contact PII
 *   PLAYER-ROLE-04: Player profile page shows Team Connection card + Player badge
 *
 * Excluded / consolidated:
 *   - PLAYER-05/06 (RSVP toggle + persistence) — old Going/Not Going button model
 *     no longer rendered; RSVP moved into EventDetailPanel via the 3-way segmented
 *     control. Same gap noted for parent in #719; will be covered together when
 *     EventDetailPanel parent/player coverage lands.
 *   - PLAYER-07 (player blocked from /users) — already in rbac.emu.spec.ts.
 *   - PLAYER-08 (player on /leagues sees no admin controls) — low-value; the
 *     route is also gated upstream and other RBAC tests cover the negative case.
 *   - PLAYER-11 (session timeout) — needs page.clock + fresh login, doesn't
 *     compose with the pre-authed playerPage fixture (same exclusion as LM-10).
 *   - PLAYER-12 (no edit controls on team detail) — already covered for parent
 *     in rbac.emu.spec.ts; player route gating is the same.
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';

async function gotoPlayerHome(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('body[data-hydrated="true"]', { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// PLAYER-ROLE-01
// ---------------------------------------------------------------------------

test('@emu @player PLAYER-ROLE-01: player navigating to / lands on /home', async ({
  playerPage: page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/home/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// PLAYER-ROLE-02
// ---------------------------------------------------------------------------

test('@emu @player PLAYER-ROLE-02: player home renders without crash', async ({
  playerPage: page,
}) => {
  await gotoPlayerHome(page);

  // The Upcoming Events heading is anchored on the section regardless of
  // event count, so it's the cleanest "not blank" check.
  await expect(page.getByRole('heading', { name: /upcoming events/i }))
    .toBeVisible({ timeout: 10_000 });

  // No unhandled error overlay
  await expect(page.getByText(/something went wrong/i))
    .not.toBeVisible({ timeout: 2_000 });
});

// ---------------------------------------------------------------------------
// PLAYER-ROLE-03
// ---------------------------------------------------------------------------

test('@emu @player PLAYER-ROLE-03: player home does not display parent-contact PII', async ({
  playerPage: page,
}) => {
  await gotoPlayerHome(page);

  // parentContact data lives on player docs and is only rendered in
  // RosterTable / MessagingPage — both require coach+ access. Player home
  // must never surface it.
  await expect(page.getByText(/parent contact/i)).not.toBeVisible({ timeout: 3_000 });
  await expect(page.getByText(/parent phone/i)).not.toBeVisible({ timeout: 3_000 });
  await expect(page.getByText(/parent email/i)).not.toBeVisible({ timeout: 3_000 });
});

// ---------------------------------------------------------------------------
// PLAYER-ROLE-04
// ---------------------------------------------------------------------------

test('@emu @player PLAYER-ROLE-04: player profile page shows Team Connection + role badge', async ({
  playerPage: page,
}) => {
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('body[data-hydrated="true"]', { timeout: 30_000 });

  await expect(page.getByRole('heading', { name: /edit profile/i }))
    .toBeVisible({ timeout: 10_000 });

  // Team Connection card renders for player + parent roles
  await expect(page.getByRole('heading', { name: /team connection/i }))
    .toBeVisible({ timeout: 10_000 });

  // "Player" badge text appears somewhere in the role surface area
  await expect(page.getByText(/player/i).first())
    .toBeVisible({ timeout: 10_000 });
});
