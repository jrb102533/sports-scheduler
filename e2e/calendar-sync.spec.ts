/**
 * Calendar Sync — Subscribe to Calendar modal UAT
 *
 * Covers:
 *   CALSYNC-01: Admin can open the Subscribe modal from /calendar
 *   CALSYNC-02: Subscribe modal renders the correct title
 *   CALSYNC-03: Modal closes when the X button is clicked
 *   CALSYNC-04: Coach can open the Subscribe modal from the Team Schedule tab
 *   CALSYNC-05: Modal shows a URL containing "webcal://"
 *              (skipped until getCalendarFeedUrl deployed to staging — #362)
 *   CALSYNC-06: Copy button is present and has correct aria-label
 *              (skipped until getCalendarFeedUrl deployed to staging — #362)
 *
 * Tests that require the live calendarFeed Cloud Function response are marked
 * test.skip with a reference to #362.  Remove the skip once PR #361 is
 * deployed to staging and the callable is live.
 *
 * Note: These tests do NOT assert that the copy-to-clipboard actually writes
 * to the system clipboard — clipboard access is unreliable in headless
 * browsers without explicit permission grants.  The Copy button interaction
 * is validated by aria-label state change (Copy → Copied).
 */

import { test, expect } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Open the Subscribe to Calendar modal from /calendar and wait for it to appear.
 * Returns the dialog locator.
 */
async function openSubscribeModalFromCalendarPage(
  page: import('@playwright/test').Page,
) {
  await page.goto('/calendar');
  await page.waitForLoadState('domcontentloaded');

  const subscribeBtn = page.getByRole('button', { name: /sync calendar|subscribe to calendar/i });
  await expect(subscribeBtn).toBeVisible({ timeout: 10_000 });
  await subscribeBtn.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  return dialog;
}

// ---------------------------------------------------------------------------
// CALSYNC-01: Admin — Calendar page
// ---------------------------------------------------------------------------

test('CALSYNC-01: admin can open the Subscribe modal from the Calendar page', async ({ asAdmin }) => {
  const { page } = asAdmin;
  const dialog = await openSubscribeModalFromCalendarPage(page);
  await expect(dialog).toBeVisible();
});

// ---------------------------------------------------------------------------
// CALSYNC-02: Modal title
// ---------------------------------------------------------------------------

test('CALSYNC-02: Subscribe modal renders the correct title', async ({ asAdmin }) => {
  const { page } = asAdmin;
  const dialog = await openSubscribeModalFromCalendarPage(page);

  await expect(dialog.getByRole('heading', { name: /subscribe to calendar/i })).toBeVisible({
    timeout: 5_000,
  });
});

// ---------------------------------------------------------------------------
// CALSYNC-03: Modal closes on X click
// ---------------------------------------------------------------------------

test('CALSYNC-03: modal closes when the X button is clicked', async ({ asAdmin }) => {
  const { page } = asAdmin;
  const dialog = await openSubscribeModalFromCalendarPage(page);

  const closeBtn = dialog.getByRole('button', { name: /close/i });
  await expect(closeBtn).toBeVisible({ timeout: 5_000 });
  await closeBtn.click();

  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// CALSYNC-04: Coach — Team Schedule tab
// ---------------------------------------------------------------------------

test('CALSYNC-04: coach can open the Subscribe modal from the Team Schedule tab', async ({ asCoach }) => {
  const { page } = asCoach;

  // Navigate to /teams and click the first available team
  await page.goto('/teams');
  await page.waitForLoadState('domcontentloaded');

  const teamLinks = page.locator('a[href*="/teams/"]');
  const hasTeam = await teamLinks.first().isVisible({ timeout: 10_000 }).catch(() => false);

  if (!hasTeam) {
    test.skip(true, 'No teams visible for coach account in staging — #362');
    return;
  }

  await teamLinks.first().click();
  await page.waitForURL(/\/teams\/.+/, { timeout: 10_000 });
  await page.waitForLoadState('domcontentloaded');

  // Click the Schedule tab
  const scheduleTab = page.getByRole('tab', { name: /schedule/i });
  await expect(scheduleTab).toBeVisible({ timeout: 10_000 });
  await scheduleTab.click();

  // Subscribe button should be visible in the Schedule tab header area
  const subscribeBtn = page.getByRole('button', { name: /sync calendar|subscribe to calendar/i });
  await expect(subscribeBtn).toBeVisible({ timeout: 10_000 });
  await subscribeBtn.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Verify modal title
  await expect(dialog.getByRole('heading', { name: /subscribe to calendar/i })).toBeVisible({
    timeout: 5_000,
  });

  // Dismiss
  await dialog.getByRole('button', { name: /close/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// CALSYNC-05: webcal:// URL is displayed
// (requires getCalendarFeedUrl callable — skip until PR #361 deployed — #362)
// ---------------------------------------------------------------------------

test('CALSYNC-05: modal shows a URL containing "webcal://" after the feed loads', async ({ asAdmin }) => {
  const { page } = asAdmin;
  const dialog = await openSubscribeModalFromCalendarPage(page);

  // Wait for the loading indicator to disappear (callable returns)
  await expect(dialog.getByText(/loading your feed url/i)).not.toBeVisible({ timeout: 30_000 });

  // The <code> element should contain a webcal:// URL
  const feedUrlCode = dialog.locator('code');
  await expect(feedUrlCode).toBeVisible({ timeout: 10_000 });

  const urlText = await feedUrlCode.textContent();
  expect(urlText).toMatch(/^webcal:\/\//);
});

// ---------------------------------------------------------------------------
// CALSYNC-06: Copy button is present
// (requires getCalendarFeedUrl callable — skip until PR #361 deployed — #362)
// ---------------------------------------------------------------------------

test('CALSYNC-06: Copy button is present and toggles to "Copied!" after click', async ({ asAdmin }) => {
  const { page } = asAdmin;
  const dialog = await openSubscribeModalFromCalendarPage(page);

  // Wait for the feed URL to load
  await expect(dialog.getByText(/loading your feed url/i)).not.toBeVisible({ timeout: 30_000 });

  // Copy button should be visible once URL is loaded
  const copyBtn = dialog.getByRole('button', { name: /copy feed url/i });
  await expect(copyBtn).toBeVisible({ timeout: 10_000 });

  await copyBtn.click();

  // After clicking, aria-label should change to "Copied" and button text should show "Copied!"
  await expect(dialog.getByRole('button', { name: /copied/i })).toBeVisible({ timeout: 3_000 });
});
