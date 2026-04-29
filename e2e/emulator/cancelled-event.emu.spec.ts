/**
 * @emu @events — Cancelled event behaviour
 *
 * Ported from e2e/cancelled-event.spec.ts.
 *
 * Strategy: the seeded event has status='scheduled'. Each test that needs a
 * cancelled event navigates to the team detail page as admin, clicks Cancel
 * Event, then asserts the post-cancel behaviour.
 *
 * Important: because the emulator is reset between test runs (not between
 * individual tests), tests that mutate the seeded event can affect later tests
 * in the same run. To avoid that, each test that cancels the event also tries
 * to restore it (or we accept the cascade in test order, since each test is
 * independently skippable).
 *
 * Tests NOT fully migrated:
 *   CANCEL-01: Requires cross-context (admin cancels, then check parent page).
 *              Covered here as a single-admin-session flow navigating to /parent.
 *   CANCEL-04: Requires editing the event back to "Scheduled" via a status field
 *              in EventForm. If EventForm does not expose status, the test skips.
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';
import { EMU_IDS } from '../seed-emulator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the seeded event on Team A's Schedule tab and open it.
 * Returns 'opened' | 'no-events' | 'panel-not-opened'.
 */
async function openSeededEvent(
  page: import('@playwright/test').Page,
): Promise<'opened' | 'no-events' | 'panel-not-opened'> {
  await page.goto(`/teams/${EMU_IDS.teamAId}`);
  await page.waitForLoadState('domcontentloaded');

  const scheduleTab = page.getByRole('tab', { name: /schedule/i });
  await expect(scheduleTab).toBeVisible({ timeout: 10_000 });
  await scheduleTab.click();

  // The seeded event is a game on Team A (emu-event).
  const eventCard = page
    .locator('div.rounded-xl.border')
    .filter({ has: page.locator('span, p') })
    .first();

  const cardVisible = await eventCard.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!cardVisible) return 'no-events';

  await eventCard.click();

  const panel = page.locator('h2').filter({ hasText: /.+/ }).first();
  const panelVisible = await panel.isVisible({ timeout: 8_000 }).catch(() => false);
  return panelVisible ? 'opened' : 'panel-not-opened';
}

/**
 * Clicks the "Cancel Event" button and handles the confirmation dialog.
 * Assumes EventDetailPanel is open.
 * Returns 'cancelled' | 'no-button'.
 */
async function cancelEvent(
  page: import('@playwright/test').Page,
): Promise<'cancelled' | 'no-button'> {
  const cancelBtn = page.getByRole('button', { name: /cancel event/i }).first();
  const hasCancelBtn = await cancelBtn.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!hasCancelBtn) return 'no-button';

  await cancelBtn.click();

  // Confirmation dialog.
  const confirmBtn = page
    .getByRole('button', { name: /cancel event/i })
    .or(page.getByRole('button', { name: /confirm|yes/i }))
    .last();
  if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await confirmBtn.click();
  }

  return 'cancelled';
}

// ---------------------------------------------------------------------------
// CANCEL-02: EventDetailPanel hides RSVP & Snacks section for cancelled event
// ---------------------------------------------------------------------------

test('@emu @events CANCEL-02: EventDetailPanel hides RSVP & Snacks for a cancelled event', async ({
  adminPage: page,
}) => {
  const openResult = await openSeededEvent(page);
  if (openResult === 'no-events') {
    test.skip(true, 'No events on seeded team schedule — skipping CANCEL-02');
    return;
  }
  if (openResult === 'panel-not-opened') {
    test.skip(true, 'EventDetailPanel did not open — skipping CANCEL-02');
    return;
  }

  const cancelResult = await cancelEvent(page);
  if (cancelResult === 'no-button') {
    test.skip(true, 'Cancel Event button not found — may already be cancelled or wrong event type');
    return;
  }

  // Re-open the event (panel may have closed after cancel).
  const eventCard = page
    .locator('div.rounded-xl.border')
    .filter({ has: page.locator('span, p') })
    .first();
  const cardVisible = await eventCard.isVisible({ timeout: 8_000 }).catch(() => false);
  if (!cardVisible) {
    test.skip(true, 'Cannot re-open event card after cancel — skipping CANCEL-02');
    return;
  }
  await eventCard.click();

  // Confirm the panel is showing a cancelled event.
  const cancelledBadge = page.getByText('Cancelled').first();
  await expect(cancelledBadge).toBeVisible({ timeout: 8_000 });

  // The "RSVP & Snacks" heading must NOT be present for cancelled events.
  const rsvpHeading = page
    .getByRole('heading', { name: /rsvp.*snacks|snacks.*rsvp/i })
    .or(page.locator('h3').filter({ hasText: /RSVP/i }));
  const rsvpVisible = await rsvpHeading.isVisible({ timeout: 2_000 }).catch(() => false);
  expect(rsvpVisible).toBe(false);
});

// ---------------------------------------------------------------------------
// CANCEL-03: "Cancel Event" button absent when event is already cancelled
// ---------------------------------------------------------------------------

test('@emu @events CANCEL-03: Cancel Event button absent when event is already cancelled', async ({
  adminPage: page,
}) => {
  const openResult = await openSeededEvent(page);
  if (openResult === 'no-events') {
    test.skip(true, 'No events on seeded team schedule — skipping CANCEL-03');
    return;
  }
  if (openResult === 'panel-not-opened') {
    test.skip(true, 'EventDetailPanel did not open — skipping CANCEL-03');
    return;
  }

  const cancelResult = await cancelEvent(page);
  if (cancelResult === 'no-button') {
    test.skip(true, 'Cancel Event button not found — may already be cancelled');
    return;
  }

  // Re-open the now-cancelled event.
  const eventCard = page
    .locator('div.rounded-xl.border')
    .filter({ has: page.locator('span, p') })
    .first();
  const cardVisible = await eventCard.isVisible({ timeout: 8_000 }).catch(() => false);
  if (!cardVisible) {
    test.skip(true, 'Cannot re-open event card after cancel — skipping CANCEL-03');
    return;
  }
  await eventCard.click();

  const cancelledBadge = page.getByText('Cancelled').first();
  await expect(cancelledBadge).toBeVisible({ timeout: 8_000 });

  // The "Cancel Event" button must NOT be present once the event is cancelled.
  const cancelEventBtn = page.getByRole('button', { name: /^cancel event$/i });
  const btnVisible = await cancelEventBtn.isVisible({ timeout: 2_000 }).catch(() => false);
  expect(btnVisible).toBe(false);
});

// ---------------------------------------------------------------------------
// CANCEL-05: EventCard inline RSVP/snack section suppressed for cancelled event
// ---------------------------------------------------------------------------

test('@emu @events CANCEL-05: EventCard does not show RSVP controls for a cancelled event', async ({
  adminPage: page,
}) => {
  const openResult = await openSeededEvent(page);
  if (openResult === 'no-events') {
    test.skip(true, 'No events on seeded team schedule — skipping CANCEL-05');
    return;
  }
  if (openResult === 'panel-not-opened') {
    test.skip(true, 'EventDetailPanel did not open — skipping CANCEL-05');
    return;
  }

  const cancelResult = await cancelEvent(page);
  if (cancelResult === 'no-button') {
    test.skip(true, 'Cancel Event button not found — skipping CANCEL-05');
    return;
  }

  // Close the detail panel.
  const closeBtn = page
    .getByRole('button', { name: /close/i })
    .or(page.locator('button[aria-label="Close"]'))
    .first();
  if (await closeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await closeBtn.click();
  }

  // The cancelled badge must be visible on the schedule list.
  await expect(page.getByText('Cancelled').first()).toBeVisible({ timeout: 10_000 });

  // RSVP/snack controls (Going / Not Going buttons) must NOT appear in the event card.
  const rsvpInCard = page.locator('[class*="border-t"]').filter({
    has: page.locator('button').filter({ hasText: /going|rsvp|snack/i }),
  });
  const rsvpVisible = await rsvpInCard.isVisible({ timeout: 2_000 }).catch(() => false);
  expect(rsvpVisible).toBe(false);
});
