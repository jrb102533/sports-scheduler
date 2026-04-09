/**
 * Parent flows UAT
 *
 * Covers:
 *   GO_LIVE_CHECKLIST: Parent sees team and schedule after signup
 *   GO_LIVE_CHECKLIST: Parent can RSVP to an event
 *   GO_LIVE_CHECKLIST: RSVP state persists after page refresh
 *   GO_LIVE_CHECKLIST: RSVP button appears on events and can be tapped
 *
 * Requires:
 *   E2E_PARENT_EMAIL / E2E_PARENT_PASSWORD — a parent account pre-linked to a team
 *   that has at least one upcoming event.
 */

import { test, expect } from './fixtures/auth.fixture';
import { ParentHomePage } from './pages/ParentHomePage';

// ---------------------------------------------------------------------------
// Parent routing — player/parent role redirects to /parent from /
// ---------------------------------------------------------------------------

test('@smoke parent user is redirected from / to /parent', async ({ asParent }) => {
  const { page } = asParent;

  await page.goto('/');

  // Dashboard redirects player/parent roles to /parent
  await expect(page).toHaveURL(/\/parent/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Team header
// ---------------------------------------------------------------------------

test('@smoke parent home page shows a team header', async ({ asParent }) => {
  const { parent, page } = asParent;

  // Either the team header or the "no team linked" message must be visible
  const teamVisible = await page
    .locator('[class*="rounded-xl"][class*="items-center"]')
    .filter({ has: page.locator('text=/[A-Z]/', { hasText: /./ }) })
    .isVisible()
    .catch(() => false);

  const noTeamVisible = await parent.noTeamMessage.isVisible().catch(() => false);

  expect(teamVisible || noTeamVisible).toBe(true);
});

test('parent home page shows the Upcoming Games heading', async ({ asParent }) => {
  const { parent } = asParent;
  await expect(parent.upcomingGamesHeading).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// RSVP
// ---------------------------------------------------------------------------

test('@smoke parent can RSVP Going on an event', async ({ asParent }) => {
  const { page } = asParent;

  const parentHome = new ParentHomePage(page);
  await parentHome.goto();

  const goingBtn = page.getByRole('button', { name: 'Going' }).first();
  const noEventsMsg = page.getByText(/hasn't added any games yet/i);

  // Skip gracefully if there are no upcoming events
  const hasEvents = await goingBtn.isVisible({ timeout: 5_000 }).catch(() => false);
  const isEmpty = await noEventsMsg.isVisible({ timeout: 1_000 }).catch(() => false);

  if (isEmpty || !hasEvents) {
    test.skip(true, 'No upcoming events for this parent account — skipping RSVP test');
    return;
  }

  // Click Going
  await goingBtn.click();

  // Button should become selected (aria-pressed="true")
  await expect(goingBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
});

test('@smoke RSVP state persists after page refresh', async ({ asParent }) => {
  const { page } = asParent;

  const parentHome = new ParentHomePage(page);
  await parentHome.goto();

  const goingBtn = page.getByRole('button', { name: 'Going' }).first();
  const hasEvents = await goingBtn.isVisible({ timeout: 5_000 }).catch(() => false);

  if (!hasEvents) {
    test.skip(true, 'No upcoming events — skipping RSVP persistence test');
    return;
  }

  // Set RSVP to Going
  await goingBtn.click();
  await expect(goingBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });

  // Reload and verify it persisted
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2_000); // Allow Firestore subscription to populate

  const goingBtnAfterReload = page.getByRole('button', { name: 'Going' }).first();
  await expect(goingBtnAfterReload).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
});

test('RSVP Not Going button is present and tappable', async ({ asParent }) => {
  const { page } = asParent;

  await page.goto('/parent');
  await page.waitForLoadState('domcontentloaded');

  const notGoingBtn = page.getByRole('button', { name: 'Not Going' }).first();
  const hasEvents = await notGoingBtn.isVisible({ timeout: 5_000 }).catch(() => false);

  if (!hasEvents) {
    test.skip(true, 'No upcoming events — skipping Not Going test');
    return;
  }

  await notGoingBtn.click();
  await expect(notGoingBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

test('parent home shows empty state message when no events are scheduled', async ({
  asParent,
}) => {
  const { page } = asParent;

  // This test passes regardless — it just verifies either events OR the empty state message
  // is shown (never a crash/blank screen).
  const goingBtn = page.getByRole('button', { name: 'Going' }).first();
  const emptyMsg = page.getByText(/hasn't added any games yet/i);

  const hasEvents = await goingBtn.isVisible({ timeout: 3_000 }).catch(() => false);
  const showsEmpty = await emptyMsg.isVisible({ timeout: 3_000 }).catch(() => false);

  // At least one of the two states should be visible — never a blank screen
  expect(hasEvents || showsEmpty).toBe(true);
});
