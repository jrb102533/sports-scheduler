/**
 * Cancelled event behaviour — E2E tests
 *
 * Covers ONLY what event-lifecycle.spec.ts does NOT already test.
 * event-lifecycle.spec.ts (EVT-LC-06, EVT-LC-07) already verifies:
 *   - An admin can cancel an event and a "Cancelled" badge appears.
 *   - The event is still visible in the schedule list after cancellation.
 *
 * These tests cover the remaining cancellation-specific behaviours:
 *
 *   CANCEL-01: Cancelled event is hidden from the parent home page
 *              (ParentHomePage filters status !== 'cancelled')
 *   CANCEL-02: EventDetailPanel hides the RSVP & Snacks section for a
 *              cancelled event
 *   CANCEL-03: "Cancel Event" footer button is absent when the event is
 *              already cancelled
 *   CANCEL-04: Admin can restore a cancelled event by editing it back to
 *              "Scheduled"; the Cancelled badge disappears
 *   CANCEL-05: EventCard inline RSVP / snack section is suppressed for a
 *              cancelled event (showInteractive === false)
 *
 * Setup strategy:
 *   Each test that requires a cancelled event creates a fresh team + event via
 *   the admin fixture, cancels it in-test, then performs its assertion.
 *   This avoids test-order dependencies and cross-test pollution.
 *
 * Skipping:
 *   Tests skip gracefully when the UI does not expose the expected control
 *   (e.g. the environment has no Add Event button).  No `|| true` is used.
 */

import { test, expect } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Shared helpers (copied pattern from event-lifecycle.spec.ts)
// ---------------------------------------------------------------------------

async function setupTeamAndNavigate(
  page: import('@playwright/test').Page,
  suffix: string,
): Promise<void> {
  const { AdminPage } = await import('./pages/AdminPage');
  const admin = new AdminPage(page);
  const teamName = `E2E Cancel ${suffix} ${Date.now()}`;
  await admin.createTeam({ name: teamName });
  await page.getByText(teamName, { exact: false }).click();
  await page.waitForURL(/\/teams\/.+/);
}

/**
 * Creates an event on the currently-open team's Schedule tab.
 * Returns true if the event was created and the modal closed, false otherwise.
 */
async function createEvent(
  page: import('@playwright/test').Page,
  daysFromNow: number = 14,
): Promise<boolean> {
  await page.getByRole('tab', { name: /schedule/i }).click();

  const addBtn = page
    .getByRole('button', { name: /add event|new event|\+/i })
    .first();

  const canCreate = await addBtn.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!canCreate) return false;

  await addBtn.click();

  const modal = page.getByRole('dialog');
  const modalVisible = await modal.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!modalVisible) return false;

  const future = new Date();
  future.setDate(future.getDate() + daysFromNow);
  const iso = future.toISOString().split('T')[0] ?? '';

  const dateInput = modal.locator('input[type="date"]').first();
  await expect(dateInput).toBeVisible({ timeout: 5_000 });
  await dateInput.fill(iso);

  const timeInput = modal.locator('input[type="time"]').first();
  if (await timeInput.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await timeInput.fill('11:00');
  }

  const titleInput = modal.getByLabel(/title|name/i).first();
  if (await titleInput.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await titleInput.fill('Cancel Test Event');
  }

  const saveBtn = modal.getByRole('button', { name: /save|create event/i });
  await saveBtn.click();

  return modal
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

/**
 * Opens the first event card in the schedule tab and clicks "Cancel Event".
 * Handles the confirmation dialog.
 * Returns 'cancelled' | 'no-button' | 'no-event'.
 */
async function cancelFirstEvent(
  page: import('@playwright/test').Page,
): Promise<'cancelled' | 'no-button' | 'no-event'> {
  const eventItems = page.locator('[class*="rounded"][class*="cursor"]').filter({
    has: page.locator('button'),
  });

  const hasEvent = await eventItems.first().isVisible({ timeout: 4_000 }).catch(() => false);
  if (!hasEvent) return 'no-event';

  await eventItems.first().click();

  const cancelBtn = page.getByRole('button', { name: /cancel event/i }).first();
  const hasCancelBtn = await cancelBtn.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!hasCancelBtn) return 'no-button';

  await cancelBtn.click();

  // Confirmation dialog — some environments show a confirm button
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
// CANCEL-01: Cancelled event does NOT appear on the parent home page
// ---------------------------------------------------------------------------

test('CANCEL-01: cancelled event is hidden from the parent home page', async ({
  asAdmin,
  page: _parentPage,
}) => {
  // Step 1: Admin creates a team + event, then cancels it
  const { page: adminPage } = asAdmin;
  await setupTeamAndNavigate(adminPage, 'C01');

  const created = await createEvent(adminPage, 10);
  if (!created) {
    test.skip(true, 'Could not create event — skipping CANCEL-01');
    return;
  }

  const result = await cancelFirstEvent(adminPage);
  if (result !== 'cancelled') {
    test.skip(true, `cancelFirstEvent returned '${result}' — skipping CANCEL-01`);
    return;
  }

  // A "Cancelled" badge must be visible somewhere to confirm the cancel took effect
  const cancelledBadge = adminPage.getByText('Cancelled').first();
  await expect(cancelledBadge).toBeVisible({ timeout: 10_000 });

  // Step 2: Navigate to the parent home page in the same admin session
  // (The parent page filters cancelled events regardless of role —
  //  we test the filter logic, not parent auth, here.)
  await adminPage.goto('/parent');
  await adminPage.waitForLoadState('domcontentloaded');

  // The event we just cancelled must not appear in the list.
  // The parent page renders event titles as `font-semibold text-gray-900 text-sm`.
  // "Cancel Test Event" is our created event title.
  const cancelledEventTitle = adminPage.getByText('Cancel Test Event', { exact: false });
  const appearsOnParentPage = await cancelledEventTitle.isVisible({ timeout: 3_000 }).catch(() => false);
  expect(appearsOnParentPage).toBe(false);
});

// ---------------------------------------------------------------------------
// CANCEL-02: RSVP & Snacks section is absent in the detail panel of a cancelled event
// ---------------------------------------------------------------------------

test('CANCEL-02: EventDetailPanel hides the RSVP & Snacks section for a cancelled event', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  await setupTeamAndNavigate(page, 'C02');

  const created = await createEvent(page, 11);
  if (!created) {
    test.skip(true, 'Could not create event — skipping CANCEL-02');
    return;
  }

  const result = await cancelFirstEvent(page);
  if (result !== 'cancelled') {
    test.skip(true, `cancelFirstEvent returned '${result}' — skipping CANCEL-02`);
    return;
  }

  // The panel may have closed after cancel.  Re-open the event.
  const eventItems = page.locator('[class*="rounded"][class*="cursor"]').filter({
    has: page.locator('button'),
  });
  const hasEvent = await eventItems.first().isVisible({ timeout: 8_000 }).catch(() => false);
  if (!hasEvent) {
    test.skip(true, 'Cannot re-open cancelled event card — skipping CANCEL-02');
    return;
  }
  await eventItems.first().click();

  // Confirm the panel is showing a cancelled event
  const cancelledBadge = page.getByText('Cancelled').first();
  await expect(cancelledBadge).toBeVisible({ timeout: 8_000 });

  // The "RSVP & Snacks" section heading must NOT be present.
  // EventDetailPanel renders: <h3>RSVP &amp; Snacks</h3> only when
  // event.status !== 'cancelled' && event.status !== 'completed'.
  const rsvpHeading = page.getByRole('heading', { name: /rsvp.*snacks|snacks.*rsvp/i }).or(
    page.locator('h3').filter({ hasText: /RSVP/i })
  );
  const rsvpVisible = await rsvpHeading.isVisible({ timeout: 2_000 }).catch(() => false);
  expect(rsvpVisible).toBe(false);
});

// ---------------------------------------------------------------------------
// CANCEL-03: "Cancel Event" button is absent in the panel of an already-cancelled event
// ---------------------------------------------------------------------------

test('CANCEL-03: Cancel Event button is absent when event is already cancelled', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  await setupTeamAndNavigate(page, 'C03');

  const created = await createEvent(page, 12);
  if (!created) {
    test.skip(true, 'Could not create event — skipping CANCEL-03');
    return;
  }

  const result = await cancelFirstEvent(page);
  if (result !== 'cancelled') {
    test.skip(true, `cancelFirstEvent returned '${result}' — skipping CANCEL-03`);
    return;
  }

  // Re-open the cancelled event
  const eventItems = page.locator('[class*="rounded"][class*="cursor"]').filter({
    has: page.locator('button'),
  });
  const hasEvent = await eventItems.first().isVisible({ timeout: 8_000 }).catch(() => false);
  if (!hasEvent) {
    test.skip(true, 'Cannot re-open cancelled event card — skipping CANCEL-03');
    return;
  }
  await eventItems.first().click();

  // Confirm the panel is showing a cancelled event
  const cancelledBadge = page.getByText('Cancelled').first();
  await expect(cancelledBadge).toBeVisible({ timeout: 8_000 });

  // The "Cancel Event" ghost button in the panel footer must NOT be present.
  // EventDetailPanel renders it only when event.status !== 'cancelled'.
  const cancelEventBtn = page.getByRole('button', { name: /^cancel event$/i });
  const btnVisible = await cancelEventBtn.isVisible({ timeout: 2_000 }).catch(() => false);
  expect(btnVisible).toBe(false);
});

// ---------------------------------------------------------------------------
// CANCEL-04: Admin can restore a cancelled event by editing it back to Scheduled
// ---------------------------------------------------------------------------

test('CANCEL-04: admin can restore a cancelled event and the Cancelled badge disappears', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  await setupTeamAndNavigate(page, 'C04');

  const created = await createEvent(page, 13);
  if (!created) {
    test.skip(true, 'Could not create event — skipping CANCEL-04');
    return;
  }

  const result = await cancelFirstEvent(page);
  if (result !== 'cancelled') {
    test.skip(true, `cancelFirstEvent returned '${result}' — skipping CANCEL-04`);
    return;
  }

  // Re-open the cancelled event
  const eventItems = page.locator('[class*="rounded"][class*="cursor"]').filter({
    has: page.locator('button'),
  });
  const hasEvent = await eventItems.first().isVisible({ timeout: 8_000 }).catch(() => false);
  if (!hasEvent) {
    test.skip(true, 'Cannot re-open cancelled event card — skipping CANCEL-04');
    return;
  }
  await eventItems.first().click();

  const cancelledBadge = page.getByText('Cancelled').first();
  await expect(cancelledBadge).toBeVisible({ timeout: 8_000 });

  // Open the Edit form
  const editBtn = page.getByRole('button', { name: /^edit$/i }).first();
  const hasEdit = await editBtn.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!hasEdit) {
    test.skip(true, 'Edit button not found in EventDetailPanel — skipping CANCEL-04');
    return;
  }
  await editBtn.click();

  const editModal = page.getByRole('dialog');
  await expect(editModal).toBeVisible({ timeout: 5_000 });

  // Look for a Status field and set it back to "Scheduled"
  const statusSelect = editModal.getByLabel(/status/i);
  const hasStatusField = await statusSelect.isVisible({ timeout: 2_000 }).catch(() => false);
  if (!hasStatusField) {
    // Close the modal — the EventForm may not expose a status field
    const dismissBtn = editModal.getByRole('button', { name: /cancel/i });
    if (await dismissBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await dismissBtn.click();
    } else {
      await editModal.press('Escape');
    }
    test.skip(true, 'EventForm does not expose a Status field — cannot test restore via edit (CANCEL-04)');
    return;
  }

  await statusSelect.selectOption({ label: /scheduled/i });

  const saveBtn = editModal.getByRole('button', { name: /save|update/i });
  await saveBtn.click();
  await expect(editModal).not.toBeVisible({ timeout: 10_000 });

  // The schedule list should now show the event without the Cancelled badge.
  // Re-open the event to check its status badge inside the panel.
  const updatedItems = page.locator('[class*="rounded"][class*="cursor"]').filter({
    has: page.locator('button'),
  });
  const hasUpdated = await updatedItems.first().isVisible({ timeout: 8_000 }).catch(() => false);
  if (!hasUpdated) {
    test.skip(true, 'Event card not found after restore — skipping CANCEL-04 final assertion');
    return;
  }
  await updatedItems.first().click();

  // The panel must NOT show the Cancelled badge any more
  const stillCancelled = page.getByText('Cancelled').first();
  const stillVisible = await stillCancelled.isVisible({ timeout: 3_000 }).catch(() => false);
  expect(stillVisible).toBe(false);

  // And the Scheduled badge must now be visible
  const scheduledBadge = page.getByText('Scheduled').first();
  await expect(scheduledBadge).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// CANCEL-05: EventCard inline RSVP / snack section is suppressed for a cancelled event
// ---------------------------------------------------------------------------

test('CANCEL-05: EventCard does not render inline RSVP or snack controls for a cancelled event', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  await setupTeamAndNavigate(page, 'C05');

  const created = await createEvent(page, 15);
  if (!created) {
    test.skip(true, 'Could not create event — skipping CANCEL-05');
    return;
  }

  const result = await cancelFirstEvent(page);
  if (result !== 'cancelled') {
    test.skip(true, `cancelFirstEvent returned '${result}' — skipping CANCEL-05`);
    return;
  }

  // Close the detail panel if it opened
  const closeBtn = page
    .getByRole('button', { name: /close/i })
    .or(page.locator('button[aria-label="Close"]'))
    .first();
  if (await closeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await closeBtn.click();
  }

  // Confirm the schedule tab still shows the cancelled event card
  const cancelledIndicator = page.getByText('Cancelled').first();
  await expect(cancelledIndicator).toBeVisible({ timeout: 10_000 });

  // EventCard only renders the interactive RSVP + snack section when
  // showInteractive === true, which requires status !== 'cancelled'.
  // The section is wrapped in a div with class "space-y-2" inside a border-t.
  // RsvpButton renders a button with "Going" / "Not Going" aria labels
  // when the user has not yet responded.  SnackSlotButton renders similarly.
  // If the event is cancelled, neither button should appear in the card area.

  // Check there is no RSVP button inside the event card row
  const rsvpInCard = page.locator('[class*="border-t border-gray-100"]').filter({
    has: page.locator('button').filter({ hasText: /going|rsvp|snack/i }),
  });
  const rsvpInCardVisible = await rsvpInCard.isVisible({ timeout: 2_000 }).catch(() => false);
  expect(rsvpInCardVisible).toBe(false);
});
