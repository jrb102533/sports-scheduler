/**
 * Notifications page UAT
 *
 * Covers:
 *   NOTIF-01: Admin can navigate to /notifications
 *   NOTIF-02: Notifications page renders without error (no crash)
 *   NOTIF-03: Empty state message shown when there are no notifications
 *   NOTIF-04: When notifications exist, they are listed with a title and message
 *   NOTIF-05: "Mark all read" button is rendered and is clickable when unread items exist
 *   NOTIF-06: "Clear all" button is rendered
 *   NOTIF-07: Parent can also navigate to /notifications without being redirected
 *
 * The notification store is populated from Firestore subscriptions; staging
 * may or may not have notifications.  Tests gracefully skip assertions that
 * depend on data that does not exist in the current environment.
 */

import { test, expect } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test('admin can navigate to /notifications', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/notifications');

  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Page renders without error
// ---------------------------------------------------------------------------

test('notifications page renders without a crash', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/notifications');
  await page.waitForLoadState('domcontentloaded');

  // Either the empty state or the notification list must be visible
  const emptyState = page.getByText(/no notifications/i);
  const notifList = page.locator('[class*="space-y"]').first();

  const hasEmpty = await emptyState.isVisible({ timeout: 5_000 }).catch(() => false);
  const hasList = await notifList.isVisible({ timeout: 5_000 }).catch(() => false);

  expect(hasEmpty || hasList).toBe(true);
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

test('notifications page shows empty state message when there are no notifications', async ({
  asAdmin,
}) => {
  const { page } = asAdmin;
  await page.goto('/notifications');
  await page.waitForLoadState('domcontentloaded');

  const emptyState = page.getByText(/no notifications/i);
  const notificationItems = page.locator('[class*="rounded-xl"][class*="border"]').filter({
    has: page.locator('p'),
  });

  const hasNotifications = await notificationItems.first().isVisible({ timeout: 2_000 }).catch(() => false);

  if (!hasNotifications) {
    // Verify the empty state description is also present
    await expect(emptyState).toBeVisible({ timeout: 5_000 });
    const description = page.getByText(/event reminders/i);
    await expect(description).toBeVisible({ timeout: 5_000 });
  } else {
    // Notifications exist — empty state should not be shown
    await expect(emptyState).not.toBeVisible();
  }
});

// ---------------------------------------------------------------------------
// Notification list (when data exists)
// ---------------------------------------------------------------------------

test('if notifications exist they are listed with a title', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/notifications');
  await page.waitForLoadState('domcontentloaded');

  // Each notification row renders a <p> with the title (font-medium text-gray-900)
  const notifRows = page.locator('[class*="rounded-xl"][class*="border"]').filter({
    has: page.locator('p[class*="font-medium"]'),
  });

  const count = await notifRows.count();

  if (count === 0) {
    test.skip(true, 'No notifications in staging environment — skipping list assertion');
    return;
  }

  // First notification row must have a visible title
  await expect(notifRows.first().locator('p').first()).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// Action buttons
// ---------------------------------------------------------------------------

test('"Mark all read" button is present on the notifications page', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/notifications');
  await page.waitForLoadState('domcontentloaded');

  // The button is always rendered but is disabled when unread === 0
  const markAllBtn = page.getByRole('button', { name: /mark all read/i });
  await expect(markAllBtn).toBeVisible({ timeout: 10_000 });
});

test('"Mark all read" button is clickable when unread notifications exist', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/notifications');
  await page.waitForLoadState('domcontentloaded');

  const markAllBtn = page.getByRole('button', { name: /mark all read/i });
  await expect(markAllBtn).toBeVisible({ timeout: 10_000 });

  const isDisabled = await markAllBtn.isDisabled();

  if (isDisabled) {
    test.skip(true, 'No unread notifications — "Mark all read" is disabled; skipping click test');
    return;
  }

  // Click the button — it should not throw or navigate away
  await markAllBtn.click();

  // After marking all read, the button should become disabled (unread count drops to 0)
  await expect(markAllBtn).toBeDisabled({ timeout: 10_000 });
});

test('"Clear all" button is present on the notifications page', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/notifications');
  await page.waitForLoadState('domcontentloaded');

  const clearAllBtn = page.getByRole('button', { name: /clear all/i });
  await expect(clearAllBtn).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Access control — parent can reach notifications
// ---------------------------------------------------------------------------

test('parent can navigate to /notifications without being redirected', async ({ asParent }) => {
  const { page } = asParent;

  await page.goto('/notifications');
  await page.waitForLoadState('domcontentloaded');

  // Notifications is not behind a RoleGuard — parent should see the page
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
});
