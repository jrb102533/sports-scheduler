/**
 * @emu @coach — Seeded event appears in emu-team-a schedule view (Phase 3c)
 *
 * Pure read: verifies that the event seeded by seed-emulator.ts
 * (EMU_IDS.eventId = 'emu-event', title = 'Emu Test Game', dated yesterday)
 * appears when a coach navigates to the Schedule tab of emu-team-a.
 *
 * No mutations — this test exercises the Firestore read path and the
 * schedule-list rendering only.
 *
 * Source: EVT-LC-02 pattern from e2e/event-lifecycle.spec.ts, simplified
 * to a pure read against pre-seeded data.
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';
import { EMU_IDS } from '../seed-emulator.js';

// The title written by seed-emulator.ts.
const SEEDED_EVENT_TITLE = 'Emu Test Game';

test('@emu @coach seeded event appears in emu-team-a schedule list', async ({ coachPage }) => {
  const page = coachPage;

  // Navigate directly to the seeded team.
  await page.goto(`/teams/${EMU_IDS.teamAId}`);
  await page.waitForLoadState('domcontentloaded');

  // Switch to the Schedule tab.
  const scheduleTab = page.getByRole('tab', { name: /schedule/i });
  await expect(scheduleTab).toBeVisible({ timeout: 10_000 });
  await scheduleTab.click();

  // The seeded game title must appear somewhere in the schedule list.
  // seed-emulator.ts sets status:'published' and date to yesterday, so it
  // should always render (past events are shown in the schedule view).
  await expect(
    page.getByText(SEEDED_EVENT_TITLE, { exact: false }),
  ).toBeVisible({ timeout: 15_000 });
});
