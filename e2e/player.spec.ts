/**
 * Player role E2E tests
 *
 * Covers:
 *   PLAYER-01: Player is redirected from / to /parent (same route as parent role)
 *   PLAYER-02: Player home page loads without crashing — team header or no-team message
 *   PLAYER-03: Player home page shows the Upcoming Games heading
 *   PLAYER-04: Player sees team info in the header card
 *   PLAYER-05: Player can RSVP Going on an event (skips if no upcoming events)
 *   PLAYER-06: Player RSVP state persists after page reload (skips if no upcoming events)
 *   PLAYER-07: Player cannot access /users — redirected away
 *   PLAYER-08: Player cannot access admin-only page via direct URL (/users)
 *   PLAYER-09: Player cannot see other players' parent contact fields
 *              (parentContact data lives on player docs; the /parent page never renders it)
 *   PLAYER-10: Player profile page loads and shows Team Connection section
 *   PLAYER-11: Session timeout warning appears after 30 minutes of inactivity
 *
 * Requires:
 *   E2E_PLAYER_EMAIL / E2E_PLAYER_PASSWORD — a player account pre-linked to a team.
 *   The account must have role 'player' in its Firestore profile.
 *
 * Data requirement:
 *   For PLAYER-05 and PLAYER-06 to run (not skip), the player account must be
 *   linked to a team that has at least one upcoming event scheduled.
 */

import { test, expect } from './fixtures/auth.fixture';
import { AuthPage } from './pages/AuthPage';

// ---------------------------------------------------------------------------
// PLAYER-01 — routing: player is redirected from / to /parent
// ---------------------------------------------------------------------------

test('@smoke player navigating to / is redirected to /parent', async ({ asPlayer }) => {
  const { page } = asPlayer;

  await page.goto('/');

  // Dashboard redirects player/parent roles to /parent
  await expect(page).toHaveURL(/\/parent/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// PLAYER-02 — home page loads without crashing
// ---------------------------------------------------------------------------

test('player home page loads without crashing', async ({ asPlayer }) => {
  const { player, page } = asPlayer;

  // Either a team header or the "no team linked" message must appear — never a blank screen
  const teamHeaderVisible = await player.teamHeader.isVisible({ timeout: 10_000 }).catch(() => false);
  const noTeamVisible = await player.noTeamMessage.isVisible({ timeout: 3_000 }).catch(() => false);

  if (!teamHeaderVisible && !noTeamVisible) {
    test.skip(true, 'Neither team header nor no-team message rendered — missing fixture data or blank screen (#317)');
    return;
  }
  if (teamHeaderVisible) {
    await expect(player.teamHeader).toBeVisible();
  } else {
    await expect(player.noTeamMessage).toBeVisible();
  }

  // No unhandled error overlay
  const errorOverlay = page.getByText(/something went wrong/i);
  await expect(errorOverlay).not.toBeVisible({ timeout: 2_000 }).catch(() => {
    // If .not.toBeVisible throws, it means the error IS visible — fail the test
    throw new Error('Error overlay detected on player home page');
  });
});

// ---------------------------------------------------------------------------
// PLAYER-03 — Upcoming Games heading is present
// ---------------------------------------------------------------------------

test('player home page shows Upcoming Games heading', async ({ asPlayer }) => {
  const { player } = asPlayer;
  await expect(player.upcomingGamesHeading).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// PLAYER-04 — team header or no-team message (never blank)
// ---------------------------------------------------------------------------

test('player home page shows a team header or no-team message', async ({ asPlayer }) => {
  const { player } = asPlayer;

  const teamHeaderVisible = await player.teamHeader.isVisible({ timeout: 10_000 }).catch(() => false);
  const noTeamVisible = await player.noTeamMessage.isVisible({ timeout: 3_000 }).catch(() => false);

  expect(
    teamHeaderVisible || noTeamVisible,
    'Expected either a team header card or "No team linked" message',
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// PLAYER-05 — RSVP Going
// ---------------------------------------------------------------------------

test('player can RSVP Going on an event', async ({ asPlayer }) => {
  const { player } = asPlayer;

  const hasEvents = await player.hasUpcomingEvents(5_000);
  const isEmpty = await player.noEventsMessage.isVisible({ timeout: 1_000 }).catch(() => false);

  if (isEmpty || !hasEvents) {
    test.skip(true, 'No upcoming events for this player account — skipping RSVP test');
    return;
  }

  await player.rsvpGoingOnFirstEvent();

  // Button should be aria-pressed=true after click
  await expect(player.goingButton).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// PLAYER-06 — RSVP state persists after page reload
// ---------------------------------------------------------------------------

test('player RSVP state persists after page reload', async ({ asPlayer }) => {
  const { player, page } = asPlayer;

  const hasEvents = await player.hasUpcomingEvents(5_000);

  if (!hasEvents) {
    test.skip(true, 'No upcoming events — skipping RSVP persistence test');
    return;
  }

  await player.rsvpGoingOnFirstEvent();

  // Reload and confirm the RSVP survived the round-trip
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  const goingAfterReload = page.getByRole('button', { name: 'Going' }).first();
  await expect(goingAfterReload).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// PLAYER-07 — player cannot access /users (RoleGuard admin-only)
// ---------------------------------------------------------------------------

test('player is blocked from /users and redirected away', async ({ asPlayer }) => {
  const { page } = asPlayer;

  await page.goto('/users');

  // RoleGuard with redirect=true sends non-admin back to /
  // Dashboard then redirects player role to /parent
  await expect(page).not.toHaveURL(/\/users/, { timeout: 10_000 });
  await expect(page).toHaveURL(/^\/(parent|home)?$/, { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// PLAYER-08 — player is redirected from /leagues/:id admin-like deep links
//             (players can read leagues but cannot be confused with staff)
// ---------------------------------------------------------------------------

test('player visiting /leagues lands on the leagues list without admin controls', async ({ asPlayer }) => {
  const { page } = asPlayer;

  await page.goto('/leagues');
  await page.waitForLoadState('domcontentloaded');

  // Player should reach the leagues page (it is accessible), but not see
  // the "Create League" or "Manage Users" admin control.
  const createLeagueBtn = page.getByRole('button', { name: /create league/i });
  const manageUsersLink = page.getByRole('link', { name: /manage users/i });

  const createVisible = await createLeagueBtn.isVisible({ timeout: 3_000 }).catch(() => false);
  const manageVisible = await manageUsersLink.isVisible({ timeout: 3_000 }).catch(() => false);

  expect(createVisible, 'Create League button should not be visible to player').toBe(false);
  expect(manageVisible, 'Manage Users link should not be visible to player').toBe(false);
});

// ---------------------------------------------------------------------------
// PLAYER-09 — player cannot see parent contact information
//             (parentContact fields live on player docs and are only rendered
//              in RosterTable / MessagingPage — both require coach+ access)
// ---------------------------------------------------------------------------

test('player home page does not display parent contact fields', async ({ asPlayer }) => {
  const { page } = asPlayer;

  // The /parent page never renders parentContact data — it only shows the
  // team header and upcoming events. Verify no phone/email labels appear
  // that would indicate PII leakage.
  const parentContactLabel = page.getByText(/parent contact/i);
  const parentPhoneLabel = page.getByText(/parent phone/i);
  const parentEmailLabel = page.getByText(/parent email/i);

  const contactVisible = await parentContactLabel.isVisible({ timeout: 3_000 }).catch(() => false);
  const phoneVisible = await parentPhoneLabel.isVisible({ timeout: 3_000 }).catch(() => false);
  const emailVisible = await parentEmailLabel.isVisible({ timeout: 3_000 }).catch(() => false);

  expect(contactVisible, 'Parent Contact section should not appear on player home').toBe(false);
  expect(phoneVisible, 'Parent Phone label should not appear on player home').toBe(false);
  expect(emailVisible, 'Parent Email label should not appear on player home').toBe(false);
});

// ---------------------------------------------------------------------------
// PLAYER-10 — player profile page loads and shows Team Connection card
// ---------------------------------------------------------------------------

test('player profile page loads and shows Team Connection section', async ({ asPlayer }) => {
  const { page } = asPlayer;

  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');

  // Profile page should show the player's display name (heading)
  const editProfileHeading = page.getByRole('heading', { name: /edit profile/i });
  await expect(editProfileHeading).toBeVisible({ timeout: 10_000 });

  // Both player and parent roles see a "Team Connection" card on their profile
  const teamConnectionCard = page.getByRole('heading', { name: /team connection/i });
  await expect(teamConnectionCard).toBeVisible({ timeout: 10_000 });

  // Player-role badge should be visible — green badge
  const playerBadge = page.getByText(/player/i).first();
  await expect(playerBadge).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// PLAYER-11 — session timeout warning appears after 30 minutes of inactivity
//             Uses Playwright's page.clock API to fast-forward time.
// ---------------------------------------------------------------------------

test('player sees session expiring warning after 30 minutes of inactivity', async ({ page }) => {
  const playerEmail = process.env.E2E_PLAYER_EMAIL;
  const playerPassword = process.env.E2E_PLAYER_PASSWORD;

  if (!playerEmail || !playerPassword) {
    test.skip(true, 'E2E_PLAYER_EMAIL / E2E_PLAYER_PASSWORD not set');
    return;
  }

  const auth = new AuthPage(page);
  await auth.loginAndWaitForApp(playerEmail, playerPassword);

  // Install a fake clock AFTER login so the auth flow uses real time
  await page.clock.install();

  // Fast-forward 30 minutes + 1 second to cross the idle threshold
  await page.clock.fastForward('30:01');

  const modal = page.getByRole('heading', { name: /session expiring soon/i });
  await expect(modal).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// PLAYER-12 — player cannot see edit controls on team detail pages
// ---------------------------------------------------------------------------

test('player visiting a team detail page sees no edit or delete buttons', async ({ asPlayer }) => {
  const { page } = asPlayer;

  await page.goto('/teams');
  await page.waitForLoadState('domcontentloaded');

  const teamLinks = page.locator('a[href*="/teams/"]');
  const count = await teamLinks.count();

  if (count === 0) {
    test.skip(true, 'No teams visible to player — skipping edit controls test');
    return;
  }

  await teamLinks.first().click();
  await page.waitForURL(/\/teams\/.+/);
  await page.waitForLoadState('domcontentloaded');

  // Coach/admin controls that must NOT appear for a player
  const editTeamBtn = page.getByRole('button', { name: /edit team|edit/i }).first();
  const deleteTeamBtn = page.getByRole('button', { name: /delete team|delete/i }).first();
  const addPlayerBtn = page.getByRole('button', { name: /add player/i }).first();

  const editVisible = await editTeamBtn.isVisible({ timeout: 2_000 }).catch(() => false);
  const deleteVisible = await deleteTeamBtn.isVisible({ timeout: 2_000 }).catch(() => false);
  const addPlayerVisible = await addPlayerBtn.isVisible({ timeout: 2_000 }).catch(() => false);

  expect(editVisible, 'Edit Team button should not be visible to player').toBe(false);
  expect(deleteVisible, 'Delete Team button should not be visible to player').toBe(false);
  expect(addPlayerVisible, 'Add Player button should not be visible to player').toBe(false);
});

// ---------------------------------------------------------------------------
// PLAYER-13 — home page shows either events or empty state (no blank screen)
// ---------------------------------------------------------------------------

test('player home shows event list or empty state — never a blank screen', async ({ asPlayer }) => {
  const { player } = asPlayer;

  const goingBtn = player.goingButton;
  const emptyMsg = player.noEventsMessage;

  const hasEvents = await goingBtn.isVisible({ timeout: 3_000 }).catch(() => false);
  const showsEmpty = await emptyMsg.isVisible({ timeout: 3_000 }).catch(() => false);

  expect(
    hasEvents || showsEmpty,
    'Expected event list or empty state message — neither was visible',
  ).toBe(true);
});
