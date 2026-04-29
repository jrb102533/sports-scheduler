/**
 * @emu @messaging — Messaging page smoke tests
 *
 * The /messaging route is a DM-only surface since PR #665 (feat: DM-only page).
 * The old broadcast/announcement UI (Recipients + Message sections) was removed.
 *
 * These tests verify the current DM surface loads without crashing and renders
 * the expected heading. Full DM interaction tests (send, receive, thread nav)
 * require seeded DM threads and are deferred to a future spec.
 *
 * Tests NOT migrated (require old broadcast UI or CF/SMTP):
 *   - MSG-03/05: Send disabled with no recipients — broadcast form removed
 *   - MSG-06: Subject field — broadcast form removed
 *   - MSG-07: Message textarea — broadcast form removed
 *   - MSG-11 (partial): navigate-away still tested here against DM heading
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';

async function gotoMessaging(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/messaging');
  await page.waitForLoadState('domcontentloaded');
}

// ---------------------------------------------------------------------------
// MSG-01: Page loads without crashing
// ---------------------------------------------------------------------------

test('@emu @messaging MSG-01: messaging page loads without crashing for admin', async ({
  adminPage: page,
}) => {
  await gotoMessaging(page);

  await expect(page).toHaveURL(/\/messaging/);

  // Current page is the DM-only surface — h1 "Direct Messages" must be visible.
  await expect(page.getByRole('heading', { name: /direct messages/i })).toBeVisible({
    timeout: 10_000,
  });
});

// ---------------------------------------------------------------------------
// MSG-02: DM surface renders without Firestore errors
// ---------------------------------------------------------------------------

test('@emu @messaging MSG-02: messaging page renders DM panel without crashing', async ({
  adminPage: page,
}) => {
  await gotoMessaging(page);

  // The DM panel wraps a contact list or an empty state — either way the
  // "Direct Messages" heading must be present (no blank page).
  await expect(page.getByRole('heading', { name: /direct messages/i })).toBeVisible({
    timeout: 10_000,
  });

  // No error overlay.
  const errorOverlay = page.getByText(/something went wrong/i);
  const errorVisible = await errorOverlay.isVisible({ timeout: 2_000 }).catch(() => false);
  expect(errorVisible, 'Error overlay must not appear on /messaging').toBe(false);
});

// ---------------------------------------------------------------------------
// MSG-11: Navigate away and back does not crash
// ---------------------------------------------------------------------------

test('@emu @messaging MSG-11: navigating away and back to /messaging does not crash', async ({
  adminPage: page,
}) => {
  await gotoMessaging(page);
  await expect(page.getByRole('heading', { name: /direct messages/i })).toBeVisible({
    timeout: 10_000,
  });

  await page.goto('/teams');
  await page.waitForLoadState('domcontentloaded');
  await expect(page).toHaveURL(/\/teams/);

  await gotoMessaging(page);
  await expect(page).toHaveURL(/\/messaging/);
  await expect(page.getByRole('heading', { name: /direct messages/i })).toBeVisible({
    timeout: 10_000,
  });
});
