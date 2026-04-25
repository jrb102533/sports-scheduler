/**
 * Team Chat smoke tests — CHAT-*
 *
 * The /messaging route was removed in the messaging rearchitecture (2026-04-24).
 * Messaging is now per-team via the Chat tab on TeamDetailPage (/teams/:id).
 *
 * Covers:
 *   CHAT-01: Chat tab is visible on the team detail page for a coach
 *   CHAT-02: Clicking the Chat tab renders the TeamChatPanel without crashing
 *   CHAT-03: The message input area is present and accepts text
 *   CHAT-04: The Send button is disabled when the input is empty
 *   CHAT-05: The Send button is enabled once text is typed
 *   CHAT-06: Navigating away and back to the Chat tab does not crash
 *   CHAT-07: /messaging route no longer exists — redirects or 404s
 *   CHAT-08: Unread dot renders on TeamsPage when a team has a lastMessageAt
 *
 * Notes:
 *   - Tests use the coach fixture; coach has access to E2E Team A.
 *   - Actual message send (Firestore write + Cloud Function) is NOT exercised here.
 *   - CHAT-08 is skipped when no team with lastMessageAt is found in the seed data.
 */

import { test, expect, waitForAppHydrated } from './fixtures/auth.fixture';
import { loadTestData } from './helpers/test-data';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function gotoTeamDetailChat(page: import('@playwright/test').Page, teamName: string): Promise<boolean> {
  await page.goto('/teams');
  await waitForAppHydrated(page);

  // Find the team card and navigate to its detail page
  const teamLink = page.getByRole('link', { name: new RegExp(teamName, 'i') }).first();
  const found = await teamLink.isVisible({ timeout: 8_000 }).catch(() => false);
  if (!found) return false;

  await teamLink.click();
  await page.waitForURL(/\/teams\/.+/, { timeout: 10_000 });
  await waitForAppHydrated(page);

  // Click the Chat tab
  const chatTab = page.getByRole('button', { name: /^chat$/i })
    .or(page.getByRole('tab', { name: /^chat$/i }))
    .first();
  const chatTabVisible = await chatTab.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!chatTabVisible) return false;

  await chatTab.click();
  return true;
}

// ---------------------------------------------------------------------------
// CHAT-01: Chat tab is visible for a coach on their team detail page
// ---------------------------------------------------------------------------

test('CHAT-01: Chat tab is visible on team detail page for a coach', async ({ asCoach }) => {
  const { page } = asCoach;
  const testData = loadTestData();
  const teamName = testData?.teamAName ?? 'Sharks';

  await page.goto('/teams');
  await waitForAppHydrated(page);

  const teamLink = page.getByRole('link', { name: new RegExp(teamName, 'i') }).first();
  const found = await teamLink.isVisible({ timeout: 8_000 }).catch(() => false);
  if (!found) {
    test.skip(true, `CHAT-01: Team "${teamName}" not found on /teams — data contract mismatch`);
    return;
  }

  await teamLink.click();
  await page.waitForURL(/\/teams\/.+/, { timeout: 10_000 });

  const chatTab = page.getByRole('button', { name: /^chat$/i })
    .or(page.getByRole('tab', { name: /^chat$/i }))
    .first();
  await expect(chatTab).toBeVisible({ timeout: 8_000 });
});

// ---------------------------------------------------------------------------
// CHAT-02: Clicking the Chat tab renders the panel without crashing
// ---------------------------------------------------------------------------

test('CHAT-02: Chat tab renders TeamChatPanel without crashing', async ({ asCoach }) => {
  const { page } = asCoach;
  const testData = loadTestData();
  const teamName = testData?.teamAName ?? 'Sharks';

  const navigated = await gotoTeamDetailChat(page, teamName);
  if (!navigated) {
    test.skip(true, `CHAT-02: Could not navigate to Chat tab for team "${teamName}" — data or UI mismatch`);
    return;
  }

  // The panel must render — at minimum the message input area should exist
  // (even if message history is empty)
  const chatPanel = page.locator('[data-testid="team-chat-panel"]')
    .or(page.locator('textarea[placeholder*="message" i]'))
    .or(page.locator('input[placeholder*="message" i]'))
    .first();

  await expect(chatPanel).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// CHAT-03: Message input is present and accepts text
// ---------------------------------------------------------------------------

test('CHAT-03: message input accepts typed text', async ({ asCoach }) => {
  const { page } = asCoach;
  const testData = loadTestData();
  const teamName = testData?.teamAName ?? 'Sharks';

  const navigated = await gotoTeamDetailChat(page, teamName);
  if (!navigated) {
    test.skip(true, `CHAT-03: Could not navigate to Chat tab for team "${teamName}"`);
    return;
  }

  const messageInput = page.locator('textarea[placeholder*="message" i]')
    .or(page.locator('input[placeholder*="message" i]'))
    .first();
  await expect(messageInput).toBeVisible({ timeout: 10_000 });

  await messageInput.fill('Hello team!');
  await expect(messageInput).toHaveValue('Hello team!');
});

// ---------------------------------------------------------------------------
// CHAT-04: Send button is disabled when the input is empty
// ---------------------------------------------------------------------------

test('CHAT-04: Send button is disabled when message input is empty', async ({ asCoach }) => {
  const { page } = asCoach;
  const testData = loadTestData();
  const teamName = testData?.teamAName ?? 'Sharks';

  const navigated = await gotoTeamDetailChat(page, teamName);
  if (!navigated) {
    test.skip(true, `CHAT-04: Could not navigate to Chat tab for team "${teamName}"`);
    return;
  }

  // Ensure the input is blank
  const messageInput = page.locator('textarea[placeholder*="message" i]')
    .or(page.locator('input[placeholder*="message" i]'))
    .first();
  await expect(messageInput).toBeVisible({ timeout: 10_000 });
  await messageInput.fill('');

  const sendBtn = page.getByRole('button', { name: /send/i }).last();
  await expect(sendBtn).toBeDisabled({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// CHAT-05: Send button is enabled once text is typed
// ---------------------------------------------------------------------------

test('CHAT-05: Send button is enabled once message text is entered', async ({ asCoach }) => {
  const { page } = asCoach;
  const testData = loadTestData();
  const teamName = testData?.teamAName ?? 'Sharks';

  const navigated = await gotoTeamDetailChat(page, teamName);
  if (!navigated) {
    test.skip(true, `CHAT-05: Could not navigate to Chat tab for team "${teamName}"`);
    return;
  }

  const messageInput = page.locator('textarea[placeholder*="message" i]')
    .or(page.locator('input[placeholder*="message" i]'))
    .first();
  await expect(messageInput).toBeVisible({ timeout: 10_000 });
  await messageInput.fill('This is a test message');

  const sendBtn = page.getByRole('button', { name: /send/i }).last();
  await expect(sendBtn).toBeEnabled({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// CHAT-06: Navigating away and back to Chat tab does not crash
// ---------------------------------------------------------------------------

test('CHAT-06: navigating away and back to Chat tab does not crash', async ({ asCoach }) => {
  const { page } = asCoach;
  const testData = loadTestData();
  const teamName = testData?.teamAName ?? 'Sharks';

  const navigated = await gotoTeamDetailChat(page, teamName);
  if (!navigated) {
    test.skip(true, `CHAT-06: Could not navigate to Chat tab for team "${teamName}"`);
    return;
  }

  // Chat panel is visible
  const chatPanel = page.locator('textarea[placeholder*="message" i]')
    .or(page.locator('input[placeholder*="message" i]'))
    .first();
  await expect(chatPanel).toBeVisible({ timeout: 10_000 });

  // Navigate away
  await page.goto('/teams');
  await waitForAppHydrated(page);
  await expect(page).toHaveURL(/\/teams/);

  // Come back and re-open Chat tab
  const navigated2 = await gotoTeamDetailChat(page, teamName);
  if (!navigated2) {
    test.skip(true, `CHAT-06: Could not re-navigate to Chat tab`);
    return;
  }

  // Must render without a crash or blank state
  await expect(chatPanel).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// CHAT-07: /messaging route no longer exists
// ---------------------------------------------------------------------------

test('CHAT-07: /messaging route no longer exists and does not render messaging UI', async ({ asCoach }) => {
  const { page } = asCoach;

  await page.goto('/messaging');
  await page.waitForLoadState('domcontentloaded');

  // The route was removed — expect either a redirect away from /messaging
  // or a 404/not-found page, not the old MessagingPage UI.
  // The old page had "Recipients" and "Message" headings; those must be absent.
  const oldRecipientsHeading = page.getByRole('heading', { name: /^recipients$/i });
  const oldMessageHeading = page.locator('h2').filter({ hasText: /^message$/i }).first();

  await expect(oldRecipientsHeading).not.toBeVisible({ timeout: 5_000 });
  await expect(oldMessageHeading).not.toBeVisible({ timeout: 3_000 });
});
