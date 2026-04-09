/**
 * Coach availability E2E tests
 *
 * Covers:
 *   AVAIL-01: Page renders without crashing for an authenticated coach navigating
 *             directly to /leagues/:leagueId/availability/:collectionId
 *   AVAIL-02: Weekly availability grid is visible — days (Mon–Sun) and time blocks
 *             (Morning, Afternoon, Evening) are all rendered
 *   AVAIL-03: Coach can toggle a grid cell from available → unavailable
 *   AVAIL-04: Availability card on the home page links to the form when a collection
 *             is open (data-dependent, skips gracefully when no open collection)
 *   AVAIL-05: Non-coach (admin) navigating to the availability URL sees the
 *             "not a coach" graceful error, not a crash
 *
 * Data contract
 * ─────────────
 * AVAIL-01 through AVAIL-03 require:
 *   E2E_COACH_EMAIL / E2E_COACH_PASSWORD  — a coach account
 *   E2E_AVAIL_LEAGUE_ID                  — Firestore leagueId the coach belongs to
 *   E2E_AVAIL_COLLECTION_ID              — an OPEN availabilityCollection document id
 *                                          in that league (status === 'open')
 *
 * When the env vars above are absent the tests skip with a clear message.
 * AVAIL-04 uses the home page card; it skips when no "Availability Requested"
 * card appears within the settle timeout.
 * AVAIL-05 uses E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD + the same league/collection ids.
 *
 * Requires:
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD — an admin account (for AVAIL-05)
 */

import { test, expect } from './fixtures/auth.fixture';
import { AuthPage } from './pages/AuthPage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the direct availability URL, or null if the env vars are absent. */
function availabilityUrl(): string | null {
  const leagueId = process.env.E2E_AVAIL_LEAGUE_ID;
  const collectionId = process.env.E2E_AVAIL_COLLECTION_ID;
  if (!leagueId || !collectionId) return null;
  return `/leagues/${leagueId}/availability/${collectionId}`;
}

// ---------------------------------------------------------------------------
// AVAIL-01: page loads without crashing for a coach
// ---------------------------------------------------------------------------

test('AVAIL-01: availability page loads without crashing for an authenticated coach', async ({ asCoach }) => {
  const { page } = asCoach;

  const url = availabilityUrl();
  if (!url) {
    test.skip(true, 'E2E_AVAIL_LEAGUE_ID or E2E_AVAIL_COLLECTION_ID not set');
    return;
  }

  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');

  // The page must not show a React error overlay or a blank screen.
  // It will show either the full form (open collection, coach matched)
  // or one of the graceful fallback messages — both are valid passes
  // for a "does not crash" assertion.
  const errorOverlay = page.getByText(/something went wrong/i);
  const crashed = await errorOverlay.isVisible({ timeout: 3_000 }).catch(() => false);
  expect(crashed, 'Error overlay should not appear on the availability page').toBe(false);

  // At minimum the back button must exist — it appears in both the form
  // path and every graceful-error path.
  const backButton = page.getByRole('button', { name: /back to dashboard/i });
  await expect(backButton).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// AVAIL-02: weekly availability grid is visible
// ---------------------------------------------------------------------------

test('AVAIL-02: weekly availability grid shows all days and time blocks', async ({ asCoach }) => {
  const { page } = asCoach;

  const url = availabilityUrl();
  if (!url) {
    test.skip(true, 'E2E_AVAIL_LEAGUE_ID or E2E_AVAIL_COLLECTION_ID not set');
    return;
  }

  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');

  // If the form is not rendered (coach not matched, collection closed, etc.)
  // the grid will never appear — skip rather than fail.
  const weeklyHeading = page.getByRole('heading', { name: /weekly availability/i });
  const headingVisible = await weeklyHeading.isVisible({ timeout: 10_000 }).catch(() => false);
  if (!headingVisible) {
    test.skip(true, 'Weekly Availability heading not visible — collection may be closed or coach not matched in test data');
    return;
  }

  // All seven day columns must be labeled
  for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
    await expect(
      page.getByText(day, { exact: true }).first(),
      `Day column "${day}" must be visible`,
    ).toBeVisible({ timeout: 5_000 });
  }

  // All three time-block row labels must be visible
  for (const block of ['Morning', 'Afternoon', 'Evening']) {
    await expect(
      page.getByText(block, { exact: true }).first(),
      `Time block "${block}" must be visible`,
    ).toBeVisible({ timeout: 5_000 });
  }

  // 21 toggle buttons (7 days × 3 blocks) must exist
  // Each button has aria-label of the form "Mon Morning: available"
  const gridButtons = page.locator('button[aria-label*="Morning"], button[aria-label*="Afternoon"], button[aria-label*="Evening"]');
  await expect(gridButtons).toHaveCount(21, { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// AVAIL-03: coach can toggle a grid cell
// ---------------------------------------------------------------------------

test('AVAIL-03: coach can toggle a grid cell from available to unavailable', async ({ asCoach }) => {
  const { page } = asCoach;

  const url = availabilityUrl();
  if (!url) {
    test.skip(true, 'E2E_AVAIL_LEAGUE_ID or E2E_AVAIL_COLLECTION_ID not set');
    return;
  }

  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');

  // Gate: only continue if the grid is rendered
  const weeklyHeading = page.getByRole('heading', { name: /weekly availability/i });
  const headingVisible = await weeklyHeading.isVisible({ timeout: 10_000 }).catch(() => false);
  if (!headingVisible) {
    test.skip(true, 'Weekly Availability heading not visible — skipping toggle test');
    return;
  }

  // Pick the Mon/Morning cell — it starts as "available" by default.
  // aria-label pattern: "Mon Morning: available"
  const monMorning = page.locator('button[aria-label="Mon Morning: available"]').first();
  await expect(monMorning).toBeVisible({ timeout: 5_000 });

  // Toggle it — the aria-label must change to "unavailable"
  await monMorning.click();

  const monMorningUnavailable = page.locator('button[aria-label="Mon Morning: unavailable"]').first();
  await expect(monMorningUnavailable).toBeVisible({ timeout: 5_000 });

  // The cell must now carry red styling (bg-red-100 class)
  await expect(monMorningUnavailable).toHaveClass(/bg-red-100/, { timeout: 3_000 });
});

// ---------------------------------------------------------------------------
// AVAIL-04: home page shows availability card and links to the form
// ---------------------------------------------------------------------------

test('AVAIL-04: coach home page shows availability card when a collection is open', async ({ asCoach }) => {
  const { page } = asCoach;

  // The coach fixture already navigated to /.
  // Wait for the page to settle after Firestore fetches complete.
  await page.waitForLoadState('domcontentloaded');

  // CoachAvailabilityCard renders "Availability Requested" when an open
  // collection exists for a league the coach belongs to.
  const cardLabel = page.getByText(/availability requested/i).first();
  const cardVisible = await cardLabel.isVisible({ timeout: 10_000 }).catch(() => false);

  if (!cardVisible) {
    test.skip(true, 'No open availability collection found for this coach account — data contract mismatch');
    return;
  }

  // The CTA button must be visible ("Submit My Availability" or "Update Availability")
  const ctaButton = page.getByRole('button', { name: /availability/i }).first();
  await expect(ctaButton).toBeVisible({ timeout: 5_000 });

  // Clicking the CTA must navigate to the availability form URL
  await ctaButton.click();
  await expect(page).toHaveURL(/\/leagues\/.+\/availability\/.+/, { timeout: 10_000 });

  // Back button must appear — confirms the page rendered (not a blank / crash)
  const backButton = page.getByRole('button', { name: /back to dashboard/i });
  await expect(backButton).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// AVAIL-05: non-coach (admin) visiting the URL sees graceful error, not crash
// ---------------------------------------------------------------------------

test('AVAIL-05: admin visiting an availability URL sees graceful error, not a crash', async ({ page }) => {
  const adminEmail = process.env.E2E_ADMIN_EMAIL;
  const adminPassword = process.env.E2E_ADMIN_PASSWORD;
  const url = availabilityUrl();

  if (!adminEmail || !adminPassword) {
    test.skip(true, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set');
    return;
  }
  if (!url) {
    test.skip(true, 'E2E_AVAIL_LEAGUE_ID or E2E_AVAIL_COLLECTION_ID not set');
    return;
  }

  const auth = new AuthPage(page);
  await auth.loginAndWaitForApp(adminEmail, adminPassword);

  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');

  // The page must not crash
  const errorOverlay = page.getByText(/something went wrong/i);
  const crashed = await errorOverlay.isVisible({ timeout: 3_000 }).catch(() => false);
  expect(crashed, 'Error overlay should not appear — page must degrade gracefully').toBe(false);

  // The back button must appear — present in every graceful-error branch of
  // CoachAvailabilityPage, confirming the component rendered without throwing
  const backButton = page.getByRole('button', { name: /back to dashboard/i });
  await expect(backButton).toBeVisible({ timeout: 10_000 });

  // The "not a coach" message must be shown — admin has no coach membership
  const notCoachMessage = page.getByText(/you are not a coach in this league/i);
  await expect(notCoachMessage).toBeVisible({ timeout: 5_000 });
});
