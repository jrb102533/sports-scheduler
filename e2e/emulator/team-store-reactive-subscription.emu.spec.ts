/**
 * @emu @admin — Team-store reactive subscription race-condition regression (fix/#686)
 *
 * Verifies that an admin navigating directly to a team detail page immediately
 * after sign-in sees role-specific content (the full set of tabs) within 15s —
 * even though the auth flow has a race window where `user` is set but `profile`
 * (loaded via a separate onSnapshot) is still null when subscribe() is first
 * called.
 *
 * Before fix: subscribe() read profile?.role at call-time. With profile=null
 * it took the non-admin branch, issued where(documentId(), 'in', []) — a
 * malformed query that hangs forever — and loading stayed true / page showed
 * "Loading team…" indefinitely.
 *
 * After fix: subscribe() internally watches useAuthStore for profile changes
 * and re-opens the correct admin listener once profile arrives.
 *
 * This spec is intentionally placed in the @emu suite because it depends on
 * the emulator seeding exactly the roles + team fixture from seed-emulator.ts.
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';
import { EMU_IDS } from '../seed-emulator.js';

test(
  '@emu @admin admin navigates directly to team detail page and sees role-specific tabs within 15s',
  async ({ adminPage }) => {
    const page = adminPage;

    // Navigate directly to the seeded team (skips the teams list).
    // This mimics the real-world flow: user has a bookmark / deep-link and
    // hits the page immediately after sign-in before profile has loaded.
    await page.goto(`/teams/${EMU_IDS.teamAId}`);
    await page.waitForLoadState('domcontentloaded');

    // The Roster tab is only rendered for admin / coach roles.
    // A non-admin branch (the pre-fix bug path) would never show it.
    const rosterTab = page.getByRole('tab', { name: /roster/i });
    await expect(rosterTab).toBeVisible({ timeout: 15_000 });

    // The Schedule tab is similarly role-gated.
    const scheduleTab = page.getByRole('tab', { name: /schedule/i });
    await expect(scheduleTab).toBeVisible({ timeout: 5_000 });

    // Confirm the page did not stay in a loading state.
    // If loading hangs, the tabs above would never become visible and the test
    // would have already timed out — this assertion documents the invariant.
    await expect(page.getByText(/loading team/i)).not.toBeVisible();
  },
);
