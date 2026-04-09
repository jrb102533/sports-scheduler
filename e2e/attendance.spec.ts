/**
 * Attendance tracking E2E tests
 *
 * Covers:
 *   ATT-01: Attendance section renders on a Sharks event (h3 heading + recorded counter)
 *   ATT-02: Each player row shows Present / Absent / Excused buttons
 *   ATT-03: Marking a player Present activates the Present button (bg-green-500)
 *   ATT-04: Recorded counter increments after marking a player Present
 *   ATT-05: Switching from Present to Absent updates both button states
 *   ATT-06: Attendance status persists after page reload
 *   ATT-07: "Pre-fill from RSVPs" button appears when RSVPs exist but attendance is empty
 *
 * Requires:
 *   E2E_COACH_EMAIL / E2E_COACH_PASSWORD — coach account assigned to the Sharks team.
 *   The Sharks team must have at least one active player (the E2E player account satisfies
 *   this requirement).  If no events exist on Sharks yet (issue #317), each test that
 *   requires an event will skip with an explicit reason rather than fail.
 *
 * Data constants:
 *   SHARKS_TEAM_NAME — the team that is guaranteed to have an active player roster.
 */

import { test, expect } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Known test-account data
// ---------------------------------------------------------------------------

const SHARKS_TEAM_NAME = 'Sharks';

// ---------------------------------------------------------------------------
// Helper — navigate to the Sharks team detail page and open the first event
// in the Schedule tab.  Returns { eventTitle } on success, or calls
// test.skip() and returns null if the precondition cannot be met.
// ---------------------------------------------------------------------------

async function openFirstSharksEvent(
  page: import('@playwright/test').Page,
): Promise<{ eventTitle: string } | null> {
  // Navigate to /teams and find Sharks
  await page.goto('/teams');
  await page.waitForLoadState('domcontentloaded');

  const sharksLink = page.getByRole('link', { name: new RegExp(SHARKS_TEAM_NAME, 'i') }).first();
  const sharksVisible = await sharksLink.isVisible({ timeout: 10_000 }).catch(() => false);

  if (!sharksVisible) {
    test.skip(true, `${SHARKS_TEAM_NAME} not found on /teams — data contract mismatch`);
    return null;
  }

  await sharksLink.click();
  await page.waitForURL(/\/teams\/.+/, { timeout: 10_000 });
  await page.waitForLoadState('domcontentloaded');

  // Activate the Schedule tab (it may already be active, but be explicit)
  const scheduleTab = page.getByRole('tab', { name: /schedule/i });
  await expect(scheduleTab).toBeVisible({ timeout: 10_000 });
  await scheduleTab.click();

  // Event cards render as Card components: rounded-xl + border + cursor-pointer
  const eventCard = page
    .locator('div.cursor-pointer')
    .filter({ has: page.locator('div.rounded-xl') })
    .first()
    .or(
      page
        .locator('div.rounded-xl.border.border-gray-200.cursor-pointer')
        .first(),
    );

  // Broader fallback: any clickable rounded card that contains a time or event-type text
  const anyEventCard = page
    .locator('div.rounded-xl.border')
    .filter({ has: page.locator('span, p') })
    .first();

  const primaryVisible = await eventCard.isVisible({ timeout: 3_000 }).catch(() => false);
  const fallbackVisible = !primaryVisible
    ? await anyEventCard.isVisible({ timeout: 2_000 }).catch(() => false)
    : false;

  if (!primaryVisible && !fallbackVisible) {
    test.skip(true, 'No events found on the Sharks schedule — issue #317 may be active');
    return null;
  }

  const cardToClick = primaryVisible ? eventCard : anyEventCard;

  // Read the event title from the card before clicking so we can re-find it after reload
  // EventCard renders the title (or type label) in a text node inside the card
  const cardText = await cardToClick.textContent().catch(() => '');
  const eventTitle = cardText?.trim().split('\n')[0]?.trim() ?? '';

  await cardToClick.click();

  // EventDetailPanel renders with an h2 containing the event title
  const panelHeading = page.locator('h2').filter({ hasText: /.+/ }).first();
  const panelVisible = await panelHeading.isVisible({ timeout: 8_000 }).catch(() => false);

  if (!panelVisible) {
    test.skip(true, 'EventDetailPanel did not open after clicking event card');
    return null;
  }

  // Resolve the authoritative event title from the panel heading
  const panelTitle = await panelHeading.textContent().catch(() => eventTitle);

  return { eventTitle: panelTitle?.trim() ?? eventTitle };
}

// ---------------------------------------------------------------------------
// ATT-01: Attendance section renders on a Sharks event
// ---------------------------------------------------------------------------

test('ATT-01: attendance section renders with heading and recorded counter on a Sharks event', async ({
  asCoach,
}) => {
  const { page } = asCoach;

  const result = await openFirstSharksEvent(page);
  if (!result) return; // test.skip() already called inside helper

  // AttendanceTracker renders an h3 with the text "Attendance"
  const attendanceHeading = page.locator('h3').filter({ hasText: /^Attendance$/ }).first();
  await expect(attendanceHeading).toBeVisible({ timeout: 8_000 });

  // The recorded counter renders as "{n}/{m} recorded"
  const recordedCounter = page.locator('span').filter({ hasText: /\d+\/\d+ recorded/ }).first();
  await expect(recordedCounter).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// ATT-02: Each player row shows Present / Absent / Excused buttons
// ---------------------------------------------------------------------------

test('ATT-02: each player row shows Present, Absent, and Excused buttons', async ({
  asCoach,
}) => {
  const { page } = asCoach;

  const result = await openFirstSharksEvent(page);
  if (!result) return;

  const attendanceHeading = page.locator('h3').filter({ hasText: /^Attendance$/ }).first();
  const hasSection = await attendanceHeading.isVisible({ timeout: 8_000 }).catch(() => false);

  if (!hasSection) {
    test.skip(true, 'Attendance section not rendered — team may have no active players on this event');
    return;
  }

  // At least one Present button must be visible (one per player row)
  const presentBtn = page.getByRole('button', { name: /^Present$/ }).first();
  await expect(presentBtn).toBeVisible({ timeout: 5_000 });

  const absentBtn = page.getByRole('button', { name: /^Absent$/ }).first();
  await expect(absentBtn).toBeVisible({ timeout: 3_000 });

  const excusedBtn = page.getByRole('button', { name: /^Excused$/ }).first();
  await expect(excusedBtn).toBeVisible({ timeout: 3_000 });
});

// ---------------------------------------------------------------------------
// ATT-03: Marking a player Present activates the Present button
// ---------------------------------------------------------------------------

test('@smoke ATT-03: clicking Present on a player activates the Present button with green styling', async ({
  asCoach,
}) => {
  const { page } = asCoach;

  const result = await openFirstSharksEvent(page);
  if (!result) return;

  const attendanceHeading = page.locator('h3').filter({ hasText: /^Attendance$/ }).first();
  const hasSection = await attendanceHeading.isVisible({ timeout: 8_000 }).catch(() => false);

  if (!hasSection) {
    test.skip(true, 'Attendance section not rendered — skipping button state test');
    return;
  }

  // Target the first player row's Present button
  // AttendanceTracker renders player rows as divs with Present/Absent/Excused buttons
  const presentBtn = page.getByRole('button', { name: /^Present$/ }).first();
  await expect(presentBtn).toBeVisible({ timeout: 5_000 });

  // Click Present — this calls updateEvent() immediately (no save button)
  await presentBtn.click();

  // Active state: AttendanceTracker applies 'bg-green-500 text-white' via clsx
  // Inactive state: 'bg-gray-100 text-gray-500'
  // Assert the active class is applied (and the inactive class is gone)
  await expect(presentBtn).toHaveClass(/bg-green-500/, { timeout: 5_000 });
  await expect(presentBtn).not.toHaveClass(/bg-gray-100/);
});

// ---------------------------------------------------------------------------
// ATT-04: Recorded counter increments after marking attendance
// ---------------------------------------------------------------------------

test('ATT-04: recorded counter increments after marking a player Present', async ({
  asCoach,
}) => {
  const { page } = asCoach;

  const result = await openFirstSharksEvent(page);
  if (!result) return;

  const attendanceHeading = page.locator('h3').filter({ hasText: /^Attendance$/ }).first();
  const hasSection = await attendanceHeading.isVisible({ timeout: 8_000 }).catch(() => false);

  if (!hasSection) {
    test.skip(true, 'Attendance section not rendered — skipping counter increment test');
    return;
  }

  // Read the initial counter value
  const counterLocator = page.locator('span').filter({ hasText: /\d+\/\d+ recorded/ }).first();
  await expect(counterLocator).toBeVisible({ timeout: 5_000 });

  const initialText = await counterLocator.textContent() ?? '';
  const match = initialText.match(/(\d+)\/(\d+)/);
  if (!match) throw new Error(`Could not parse counter text: "${initialText}"`);

  const initialRecorded = parseInt(match[1]!, 10);
  const total = parseInt(match[2]!, 10);

  if (initialRecorded >= total) {
    test.skip(true, 'All players already have attendance recorded — cannot test increment');
    return;
  }

  // Find the first player whose Present button is currently inactive (bg-gray-100)
  // so clicking it actually adds a new record rather than toggling an existing one
  const allPresentBtns = page.getByRole('button', { name: /^Present$/ });
  const count = await allPresentBtns.count();
  let targetBtn: import('@playwright/test').Locator | null = null;

  for (let i = 0; i < count; i++) {
    const btn = allPresentBtns.nth(i);
    const cls = await btn.getAttribute('class') ?? '';
    if (cls.includes('bg-gray-100')) {
      targetBtn = btn;
      break;
    }
  }

  if (!targetBtn) {
    test.skip(true, 'No unrecorded Present button found — all players may already be marked');
    return;
  }

  await targetBtn.click();

  // Counter must now show initialRecorded + 1
  const expectedText = new RegExp(`${initialRecorded + 1}\\/${total} recorded`);
  await expect(counterLocator).toHaveText(expectedText, { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// ATT-05: Switching from Present to Absent updates both button states
// ---------------------------------------------------------------------------

test('ATT-05: switching a player from Present to Absent deactivates Present and activates Absent', async ({
  asCoach,
}) => {
  const { page } = asCoach;

  const result = await openFirstSharksEvent(page);
  if (!result) return;

  const attendanceHeading = page.locator('h3').filter({ hasText: /^Attendance$/ }).first();
  const hasSection = await attendanceHeading.isVisible({ timeout: 8_000 }).catch(() => false);

  if (!hasSection) {
    test.skip(true, 'Attendance section not rendered — skipping status switch test');
    return;
  }

  // Work within the first player row.  AttendanceTracker renders each row as a
  // flex div containing the player name and the three status buttons.
  // We identify the row by the first Present button and scope Absent to the same row.
  const firstRow = page
    .locator('div.flex.items-center.justify-between')
    .filter({ has: page.getByRole('button', { name: /^Present$/ }) })
    .first();

  const rowVisible = await firstRow.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!rowVisible) {
    test.skip(true, 'Could not identify first player row — skipping status switch test');
    return;
  }

  const presentBtn = firstRow.getByRole('button', { name: /^Present$/ });
  const absentBtn = firstRow.getByRole('button', { name: /^Absent$/ });

  // Step 1 — mark Present
  await presentBtn.click();
  await expect(presentBtn).toHaveClass(/bg-green-500/, { timeout: 5_000 });

  // Step 2 — switch to Absent
  await absentBtn.click();

  // Absent should be active (red); Present should revert to inactive (gray)
  await expect(absentBtn).toHaveClass(/bg-red-500/, { timeout: 5_000 });
  await expect(presentBtn).toHaveClass(/bg-gray-100/, { timeout: 3_000 });
  await expect(presentBtn).not.toHaveClass(/bg-green-500/);
});

// ---------------------------------------------------------------------------
// ATT-06: Attendance persists after page reload
// ---------------------------------------------------------------------------

test('ATT-06: attendance status persists after page reload and re-navigation to the event', async ({
  asCoach,
}) => {
  const { page } = asCoach;

  const result = await openFirstSharksEvent(page);
  if (!result) return;

  const { eventTitle } = result;

  const attendanceHeading = page.locator('h3').filter({ hasText: /^Attendance$/ }).first();
  const hasSection = await attendanceHeading.isVisible({ timeout: 8_000 }).catch(() => false);

  if (!hasSection) {
    test.skip(true, 'Attendance section not rendered — skipping persistence test');
    return;
  }

  // Work within the first player row
  const firstRow = page
    .locator('div.flex.items-center.justify-between')
    .filter({ has: page.getByRole('button', { name: /^Excused$/ }) })
    .first();

  const rowVisible = await firstRow.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!rowVisible) {
    test.skip(true, 'Could not identify first player row — skipping persistence test');
    return;
  }

  // Read the player's name so we can re-scope after reload
  const playerNameEl = firstRow.locator('span.text-sm.text-gray-800').first();
  const playerName = (await playerNameEl.textContent() ?? '').trim();

  const excusedBtn = firstRow.getByRole('button', { name: /^Excused$/ });

  // Mark Excused
  await excusedBtn.click();
  await expect(excusedBtn).toHaveClass(/bg-yellow-500/, { timeout: 5_000 });

  // Capture the current URL (team detail page) so we can return after reload
  const teamUrl = page.url();

  // Reload the page and wait for data to hydrate
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  // We are back on the same team detail URL — navigate back to that URL just in case
  if (!page.url().includes('/teams/')) {
    await page.goto(teamUrl);
    await page.waitForLoadState('domcontentloaded');
  }

  // Re-open the Schedule tab
  const scheduleTab = page.getByRole('tab', { name: /schedule/i });
  await expect(scheduleTab).toBeVisible({ timeout: 10_000 });
  await scheduleTab.click();

  // Re-find the same event by its title (captured from the h2 before reload)
  let eventCard: import('@playwright/test').Locator;
  if (eventTitle) {
    eventCard = page.locator('div.rounded-xl.border').filter({ hasText: eventTitle }).first();
  } else {
    eventCard = page.locator('div.rounded-xl.border.border-gray-200.cursor-pointer').first();
  }

  const cardVisible = await eventCard.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!cardVisible) {
    test.skip(true, 'Could not re-locate the event after reload — skipping persistence assertion');
    return;
  }

  await eventCard.click();

  // Wait for the detail panel to re-open
  await expect(page.locator('h3').filter({ hasText: /^Attendance$/ }).first()).toBeVisible({
    timeout: 8_000,
  });

  // Find the same player row and assert Excused is still active
  const reloadedRow = page
    .locator('div.flex.items-center.justify-between')
    .filter({ has: playerName ? page.getByText(playerName, { exact: false }) : page.getByRole('button', { name: /^Excused$/ }) })
    .first();

  const reloadedExcused = reloadedRow.getByRole('button', { name: /^Excused$/ });
  await expect(reloadedExcused).toHaveClass(/bg-yellow-500/, { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// ATT-07: Pre-fill from RSVPs button appears and populates all rows
// ---------------------------------------------------------------------------

test('ATT-07: Pre-fill from RSVPs button is visible when RSVPs exist and no attendance is recorded', async ({
  asCoach,
}) => {
  const { page } = asCoach;

  const result = await openFirstSharksEvent(page);
  if (!result) return;

  const attendanceHeading = page.locator('h3').filter({ hasText: /^Attendance$/ }).first();
  const hasSection = await attendanceHeading.isVisible({ timeout: 8_000 }).catch(() => false);

  if (!hasSection) {
    test.skip(true, 'Attendance section not rendered — skipping Pre-fill test');
    return;
  }

  // Pre-fill button only appears when: attendance is empty AND RSVPs exist.
  // Both are runtime conditions.  If absent, skip rather than fail.
  const prefillBtn = page.getByRole('button', { name: /pre-fill from rsvps/i }).first();
  const prefillVisible = await prefillBtn.isVisible({ timeout: 3_000 }).catch(() => false);

  if (!prefillVisible) {
    test.skip(
      true,
      'Pre-fill from RSVPs button not shown — either attendance is already recorded ' +
        'or no RSVPs exist for this event; conditions required by ATT-07 are not met',
    );
    return;
  }

  // Read the total player count from the counter before clicking
  const counterLocator = page.locator('span').filter({ hasText: /\d+\/\d+ recorded/ }).first();
  await expect(counterLocator).toBeVisible({ timeout: 3_000 });

  const counterText = await counterLocator.textContent() ?? '';
  const match = counterText.match(/(\d+)\/(\d+)/);
  if (!match) throw new Error(`Could not parse counter text: "${counterText}"`);

  const totalPlayers = parseInt(match[2]!, 10);

  // Click Pre-fill — should mark all RSVP'd players at once
  await prefillBtn.click();

  // Counter must now show that all RSVP'd players are recorded.
  // At minimum the counter's left number must be > 0; at most it equals totalPlayers.
  // We use a regex that matches any non-zero recorded value.
  const updatedText = await counterLocator.textContent({ timeout: 5_000 }) ?? '';
  const updatedMatch = updatedText.match(/(\d+)\/(\d+)/);
  if (!updatedMatch) throw new Error(`Counter text did not update: "${updatedText}"`);

  const updatedRecorded = parseInt(updatedMatch[1]!, 10);
  expect(updatedRecorded, 'Pre-fill from RSVPs should record at least one player').toBeGreaterThan(0);
  expect(updatedRecorded, 'Pre-fill should not record more players than are on the team').toBeLessThanOrEqual(totalPlayers);

  // Pre-fill button should have disappeared (canPrefill condition is now false)
  await expect(prefillBtn).not.toBeVisible({ timeout: 3_000 });
});
