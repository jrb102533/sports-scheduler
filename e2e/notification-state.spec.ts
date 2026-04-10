/**
 * Notification bell + panel state E2E tests
 *
 * Covers the TopBar bell and NotificationPanel slide-over only.
 * The /notifications full page is covered by notifications.spec.ts — do not
 * duplicate those assertions here.
 *
 * Covered:
 *   NOTIF-STATE-01: Bell badge shows the unread count when unread items exist
 *   NOTIF-STATE-02: Clicking the bell opens the NotificationPanel
 *   NOTIF-STATE-03: Panel closes when clicking the backdrop overlay
 *   NOTIF-STATE-04: Clicking an unread item in the panel marks it read
 *                   (blue highlight removed; badge decrements)
 *   NOTIF-STATE-05: "Mark all read" in the panel clears the badge on the bell
 *   NOTIF-STATE-06: Panel shows empty state when there are no notifications
 *
 * Requires:
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD
 *
 * Data notes:
 * - Staging may or may not have unread notifications. Tests that depend on
 *   unread data skip gracefully when none is present.
 * - The notification store is populated from a Firestore subscription that
 *   fires on MainLayout mount. domcontentloaded is used to let the DOM settle
 *   (networkidle never fires on this app due to persistent Firestore connections).
 */

import { test, expect } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Locate the bell button in the TopBar header.
 */
function bellButton(page: import('@playwright/test').Page) {
  return page.getByRole('button', { name: 'Notifications' });
}

/**
 * The unread-count badge rendered inside the bell button.
 * It is the <span> rendered conditionally only when unread > 0.
 */
function bellBadge(page: import('@playwright/test').Page) {
  return bellButton(page).locator('span');
}

/**
 * The NotificationPanel root — the fixed overlay rendered when panelOpen is true.
 * The panel is identified by its "Notifications" heading inside the slide-over.
 */
function notificationPanel(page: import('@playwright/test').Page) {
  return page.locator('div').filter({ has: page.getByRole('heading', { name: 'Notifications', exact: true }) }).first();
}

// ---------------------------------------------------------------------------
// NOTIF-STATE-01: Bell badge shows correct unread count
// ---------------------------------------------------------------------------

test('NOTIF-STATE-01: bell badge displays the unread notification count', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const badge = bellBadge(page);
  const badgeVisible = await badge.isVisible({ timeout: 5_000 }).catch(() => false);

  if (!badgeVisible) {
    test.skip(true, 'No unread notifications in staging — badge is not rendered; skipping count assertion');
    return;
  }

  const badgeText = await badge.innerText();
  // Badge shows a number 1–9 or the literal string "9+"
  expect(badgeText).toMatch(/^([1-9]|9\+)$/);
});

// ---------------------------------------------------------------------------
// NOTIF-STATE-02: Clicking the bell opens the NotificationPanel
// ---------------------------------------------------------------------------

test('NOTIF-STATE-02: clicking the bell button opens the notification panel', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Panel must not already be open
  const panelBefore = await notificationPanel(page).isVisible({ timeout: 2_000 }).catch(() => false);
  expect(panelBefore, 'Panel should not be open before clicking the bell').toBe(false);

  await bellButton(page).click();

  const panelHeading = page.getByRole('heading', { name: 'Notifications', exact: true });
  await expect(panelHeading).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// NOTIF-STATE-03: Panel closes when clicking the backdrop overlay
// ---------------------------------------------------------------------------

test('NOTIF-STATE-03: notification panel closes when clicking the backdrop', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Open the panel
  await bellButton(page).click();
  const panelHeading = page.getByRole('heading', { name: 'Notifications', exact: true });
  await expect(panelHeading).toBeVisible({ timeout: 5_000 });

  // The backdrop is the absolute-positioned div that fills the viewport behind the panel.
  // Click at the far left of the screen (outside the 320 px panel).
  await page.mouse.click(50, 300);

  await expect(panelHeading).not.toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// NOTIF-STATE-04: Clicking an unread item marks it read (badge decrements)
// ---------------------------------------------------------------------------

test('NOTIF-STATE-04: clicking an unread notification item marks it read and decrements the badge', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Skip if there are no unread notifications (no badge)
  const badgeVisible = await bellBadge(page).isVisible({ timeout: 5_000 }).catch(() => false);
  if (!badgeVisible) {
    test.skip(true, 'No unread notifications — skipping mark-read assertion');
    return;
  }

  const badgeBefore = await bellBadge(page).innerText();
  const countBefore = badgeBefore === '9+' ? 10 : parseInt(badgeBefore, 10);

  // Open the panel
  await bellButton(page).click();
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible({ timeout: 5_000 });

  // Find an unread item — it has bg-blue-50 applied when !n.isRead
  const unreadItem = page.locator('[class*="bg-blue-50"]').first();
  const hasUnread = await unreadItem.isVisible({ timeout: 3_000 }).catch(() => false);

  if (!hasUnread) {
    test.skip(true, 'No blue-highlighted unread item found in panel — skipping');
    return;
  }

  await unreadItem.click();

  // After clicking, the item should lose its blue background
  await expect(unreadItem).not.toHaveClass(/bg-blue-50/, { timeout: 5_000 });

  if (countBefore === 1) {
    // Badge should disappear entirely when the last unread is cleared
    await expect(bellBadge(page)).not.toBeVisible({ timeout: 5_000 });
  } else {
    // Badge should show countBefore - 1
    const expectedCount = countBefore - 1;
    const expectedText = expectedCount > 9 ? '9+' : String(expectedCount);
    await expect(bellBadge(page)).toHaveText(expectedText, { timeout: 5_000 });
  }
});

// ---------------------------------------------------------------------------
// NOTIF-STATE-05: "Mark all read" in the panel clears the bell badge
// ---------------------------------------------------------------------------

test('NOTIF-STATE-05: "Mark all read" in the panel removes the bell badge', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Skip if nothing is unread
  const badgeVisible = await bellBadge(page).isVisible({ timeout: 5_000 }).catch(() => false);
  if (!badgeVisible) {
    test.skip(true, 'No unread notifications — "Mark all read" has no effect to assert');
    return;
  }

  // Open the panel
  await bellButton(page).click();
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible({ timeout: 5_000 });

  const markAllBtn = page.getByRole('button', { name: /mark all read/i }).first();
  await expect(markAllBtn).toBeVisible({ timeout: 5_000 });
  await markAllBtn.click();

  // Badge must disappear — unread count is now 0
  await expect(bellBadge(page)).not.toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// NOTIF-STATE-06: Panel shows empty state when there are no notifications
// ---------------------------------------------------------------------------

test('NOTIF-STATE-06: notification panel shows empty state when there are no notifications', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Open the panel
  await bellButton(page).click();
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible({ timeout: 5_000 });

  // Check whether the panel is populated or empty
  // An unread or read item inside the panel has class px-4 py-3 border-b cursor-pointer
  const hasItems = await page.locator('[class*="cursor-pointer"][class*="px-4"][class*="py-3"]')
    .first()
    .isVisible({ timeout: 2_000 })
    .catch(() => false);

  if (hasItems) {
    // Notifications exist — verify the empty state is NOT shown
    const emptyMsg = page.getByText('No notifications', { exact: true });
    await expect(emptyMsg).not.toBeVisible();
  } else {
    // No notifications — the empty state must be shown
    const emptyMsg = page.getByText('No notifications', { exact: true });
    await expect(emptyMsg).toBeVisible({ timeout: 5_000 });
  }
});
