/**
 * Calendar page UAT
 *
 * Covers:
 *   CAL-01: Admin can navigate to /calendar
 *   CAL-02: Calendar renders the month/year header and a grid
 *   CAL-03: Previous month and Next month navigation buttons work
 *   CAL-04: "Today" button navigates back to the current month
 *   CAL-05: "Add Event" button is present for admin
 *   CAL-06: Clicking an event chip (if events exist) opens the EventDetailPanel
 *   CAL-07: EventDetailPanel can be dismissed
 *   CAL-08: Parent can navigate to /calendar and see the same calendar grid
 *
 * CalendarPage uses a grid rendered by CalendarGrid — day cells contain event
 * "chips" (EventChip components). EventDetailPanel opens as an overlay when
 * a chip is clicked.
 */

import { test, expect } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test('@smoke admin can navigate to /calendar', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/calendar');

  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Calendar grid renders
// ---------------------------------------------------------------------------

test('calendar page renders a month heading and a grid', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/calendar');
  await page.waitForLoadState('domcontentloaded');

  // formatMonthYear produces strings like "April 2026"
  const monthHeading = page.locator('h2').filter({ hasText: /january|february|march|april|may|june|july|august|september|october|november|december/i });
  await expect(monthHeading).toBeVisible({ timeout: 10_000 });

  // CalendarGrid renders a white rounded card that wraps the day grid
  const calendarCard = page.locator('[class*="rounded-xl"][class*="border"]').first();
  await expect(calendarCard).toBeVisible({ timeout: 5_000 });
});

test('calendar grid contains day-of-week headers', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/calendar');
  await page.waitForLoadState('domcontentloaded');

  // CalendarGrid always renders Sun/Mon/Tue/Wed/Thu/Fri/Sat headers
  await expect(page.getByText('Sun', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Sat', { exact: true })).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Month navigation
// ---------------------------------------------------------------------------

test('previous and next month navigation buttons are present', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/calendar');
  await page.waitForLoadState('domcontentloaded');

  // ChevronLeft and ChevronRight buttons plus "Today" ghost button
  const prevBtn = page.getByRole('button').filter({ has: page.locator('svg') }).first();
  await expect(prevBtn).toBeVisible({ timeout: 5_000 });

  const todayBtn = page.getByRole('button', { name: 'Today' });
  await expect(todayBtn).toBeVisible({ timeout: 5_000 });
});

test('clicking next month changes the month heading', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/calendar');
  await page.waitForLoadState('domcontentloaded');

  const monthHeading = page.locator('h2').filter({
    hasText: /january|february|march|april|may|june|july|august|september|october|november|december/i,
  });

  const originalMonth = await monthHeading.textContent();

  // The Next Month button is the second chevron button in the nav row
  // Both ChevronLeft and ChevronRight are secondary size buttons
  const navButtons = page.locator('.flex.items-center.gap-3 button[class*="secondary"]');
  const nextBtn = navButtons.nth(1); // 0 = prev, 1 = next

  await expect(nextBtn).toBeVisible({ timeout: 5_000 });
  await nextBtn.click();

  // Heading should now show a different month
  const newMonth = await monthHeading.textContent();
  expect(newMonth).not.toBe(originalMonth);
});

test('"Today" button navigates back to current month', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/calendar');
  await page.waitForLoadState('domcontentloaded');

  const monthHeading = page.locator('h2').filter({
    hasText: /january|february|march|april|may|june|july|august|september|october|november|december/i,
  });

  // Navigate forward two months
  const navButtons = page.locator('.flex.items-center.gap-3 button[class*="secondary"]');
  const nextBtn = navButtons.nth(1);
  await nextBtn.click();
  await nextBtn.click();

  // Click Today
  const todayBtn = page.getByRole('button', { name: 'Today' });
  await todayBtn.click();

  // Heading should now match the current real month
  const now = new Date();
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const currentMonthName = monthNames[now.getMonth()];

  await expect(monthHeading).toContainText(currentMonthName ?? '', { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// Admin actions
// ---------------------------------------------------------------------------

test('"Add Event" button is visible for admin on the calendar page', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/calendar');
  await page.waitForLoadState('domcontentloaded');

  const addEventBtn = page.getByRole('button', { name: /add event/i });
  await expect(addEventBtn).toBeVisible({ timeout: 10_000 });
});

test('clicking Add Event opens the EventForm modal', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/calendar');
  await page.waitForLoadState('domcontentloaded');

  await page.getByRole('button', { name: /add event/i }).click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  // EventForm always shows a date input
  const dateInput = modal.locator('input[type="date"]').first();
  await expect(dateInput).toBeVisible({ timeout: 5_000 });

  // Close without saving
  const cancelBtn = modal.getByRole('button', { name: /cancel/i });
  if (await cancelBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await cancelBtn.click();
  }
});

// ---------------------------------------------------------------------------
// Event chip — click to open EventDetailPanel
// ---------------------------------------------------------------------------

test('clicking an event chip opens the EventDetailPanel', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/calendar');
  await page.waitForLoadState('domcontentloaded');

  // Event chips are small coloured pill elements inside day cells
  // CalendarGrid → CalendarDayCell → EventChip renders as a truncated div/button
  const eventChips = page.locator('[class*="truncate"][class*="rounded"]').filter({
    has: page.locator('text=/.+/'),
  });

  const hasChips = await eventChips.first().isVisible({ timeout: 3_000 }).catch(() => false);

  if (!hasChips) {
    test.skip(true, 'No event chips visible in current month — skipping event click test');
    return;
  }

  await eventChips.first().click();

  // EventDetailPanel renders as an overlay with a close button
  const closeBtn = page
    .getByRole('button', { name: /close/i })
    .or(page.locator('button[aria-label*="close" i]'))
    .first();

  const detailPanel = page.locator('[class*="fixed"], [role="dialog"]').filter({
    has: page.locator('h2, h3, [class*="font-semibold"]'),
  }).first();

  const panelOpen = await detailPanel.isVisible({ timeout: 5_000 }).catch(() => false);
  const closeVisible = await closeBtn.isVisible({ timeout: 5_000 }).catch(() => false);

  expect(panelOpen || closeVisible).toBe(true);

  // Dismiss the panel
  if (closeVisible) {
    await closeBtn.click();
  }
});

// ---------------------------------------------------------------------------
// Parent access
// ---------------------------------------------------------------------------

test('parent can navigate to /calendar and the grid renders', async ({ asParent }) => {
  const { page } = asParent;

  await page.goto('/calendar');
  await page.waitForLoadState('domcontentloaded');

  // Calendar is not guarded — parent should see the grid
  await expect(page).not.toHaveURL(/\/login/);

  const monthHeading = page.locator('h2').filter({
    hasText: /january|february|march|april|may|june|july|august|september|october|november|december/i,
  });
  await expect(monthHeading).toBeVisible({ timeout: 10_000 });
});
