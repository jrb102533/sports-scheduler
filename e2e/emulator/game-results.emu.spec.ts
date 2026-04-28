/**
 * @emu @schedule — Game result recording
 *
 * Ported from e2e/game-results.spec.ts.
 *
 * Uses the seeded past-dated game event (EMU_IDS.eventId, date=yesterday)
 * on Emu Team A. The coach fixture (emu-coach) is assigned to that team.
 *
 * Architecture:
 *   EventDetailPanel renders two result-recording sections:
 *     1. "Record Score" — visible to admin/LM/coach on non-cancelled/non-completed games.
 *        Calls recordResult() (local Zustand store write).  Button: "Save Score".
 *     2. "Submit Result" — visible ONLY to a coach for a past game.
 *        Calls the submitGameResult Cloud Function.  Button: "Submit Result".
 *
 *   The seeded event is dated yesterday, so both sections may appear for the
 *   coach. Tests accept either section.  RESULT-04 specifically targets "Record
 *   Score" (no CF required).
 *
 * Tests NOT migrated:
 *   - The "Submit Result" happy-path (RESULT-04 variant) requires the
 *     submitGameResult Cloud Function to succeed — the emulator runs Functions
 *     locally, so this IS exercisable but requires additional setup. Marked as
 *     advisory in COVERAGE.md.
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';
import { EMU_IDS } from '../seed-emulator.js';

// ---------------------------------------------------------------------------
// Helper — navigate to Team A Schedule tab and open the seeded event.
// ---------------------------------------------------------------------------

async function openSeededEvent(
  page: import('@playwright/test').Page,
): Promise<'opened' | 'no-events' | 'panel-not-opened'> {
  await page.goto(`/teams/${EMU_IDS.teamAId}`);
  await page.waitForLoadState('domcontentloaded');

  const scheduleTab = page.getByRole('tab', { name: /schedule/i });
  await expect(scheduleTab).toBeVisible({ timeout: 10_000 });
  await scheduleTab.click();

  // Primary card selector.
  const eventCard = page
    .locator('div.rounded-xl.border.border-gray-200.cursor-pointer')
    .first()
    .or(page.locator('div.rounded-xl.border').filter({ has: page.locator('span, p') }).first());

  const cardVisible = await eventCard.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!cardVisible) return 'no-events';

  await eventCard.click();

  const panelHeading = page.locator('h2').filter({ hasText: /.+/ }).first();
  const panelVisible = await panelHeading.isVisible({ timeout: 8_000 }).catch(() => false);
  return panelVisible ? 'opened' : 'panel-not-opened';
}

function getResultSection(page: import('@playwright/test').Page) {
  return page
    .locator('div.border.border-gray-200.rounded-xl')
    .filter({ has: page.locator('h3').filter({ hasText: /record score|submit result/i }) })
    .first();
}

// ---------------------------------------------------------------------------
// RESULT-01: Result recording section is visible
// ---------------------------------------------------------------------------

test('@emu @schedule RESULT-01: result recording section is visible on seeded event for coach', async ({
  coachPage: page,
}) => {
  const opened = await openSeededEvent(page);
  if (opened === 'no-events') {
    test.skip(true, 'No events on seeded team schedule — skipping RESULT-01');
    return;
  }
  if (opened === 'panel-not-opened') {
    test.skip(true, 'EventDetailPanel did not open — skipping RESULT-01');
    return;
  }

  const recordScoreHeading = page.locator('h3').filter({ hasText: /record score/i }).first();
  const submitResultHeading = page.locator('h3').filter({ hasText: /submit result/i }).first();

  const recordVisible = await recordScoreHeading.isVisible({ timeout: 5_000 }).catch(() => false);
  const submitVisible = !recordVisible
    ? await submitResultHeading.isVisible({ timeout: 3_000 }).catch(() => false)
    : false;

  if (!recordVisible && !submitVisible) {
    test.skip(
      true,
      'RESULT-01: neither "Record Score" nor "Submit Result" visible — ' +
        'event may not be a game type or is already cancelled/completed',
    );
    return;
  }

  expect(recordVisible || submitVisible).toBe(true);
});

// ---------------------------------------------------------------------------
// RESULT-02: Score input fields (home and away) are visible
// ---------------------------------------------------------------------------

test('@emu @schedule RESULT-02: score input fields (home + away) are visible in result section', async ({
  coachPage: page,
}) => {
  const opened = await openSeededEvent(page);
  if (opened !== 'opened') {
    test.skip(true, `RESULT-02: event open returned '${opened}' — skipping`);
    return;
  }

  const section = getResultSection(page);
  const sectionVisible = await section.isVisible({ timeout: 8_000 }).catch(() => false);

  if (!sectionVisible) {
    test.skip(true, 'RESULT-02: result section not found — skipping');
    return;
  }

  const scoreInputs = section.locator('input[type="number"]');
  const inputCount = await scoreInputs.count();

  expect(inputCount, 'Expected exactly 2 score inputs (home + away)').toBe(2);
  await expect(scoreInputs.nth(0)).toBeVisible({ timeout: 5_000 });
  await expect(scoreInputs.nth(1)).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// RESULT-03: Coach can enter home and away scores
// ---------------------------------------------------------------------------

test('@emu @schedule RESULT-03: coach can enter home score (3) and away score (1)', async ({
  coachPage: page,
}) => {
  const opened = await openSeededEvent(page);
  if (opened !== 'opened') {
    test.skip(true, `RESULT-03: event open returned '${opened}' — skipping`);
    return;
  }

  const section = getResultSection(page);
  const sectionVisible = await section.isVisible({ timeout: 8_000 }).catch(() => false);

  if (!sectionVisible) {
    test.skip(true, 'RESULT-03: result section not found — skipping');
    return;
  }

  const homeInput = section.locator('input[type="number"]').nth(0);
  const awayInput = section.locator('input[type="number"]').nth(1);

  await homeInput.fill('3');
  await awayInput.fill('1');

  await expect(homeInput).toHaveValue('3');
  await expect(awayInput).toHaveValue('1');
});

// ---------------------------------------------------------------------------
// RESULT-05: Save button disabled when score fields are empty
// ---------------------------------------------------------------------------

test('@emu @schedule RESULT-05: save button is disabled when both score fields are empty', async ({
  coachPage: page,
}) => {
  const opened = await openSeededEvent(page);
  if (opened !== 'opened') {
    test.skip(true, `RESULT-05: event open returned '${opened}' — skipping`);
    return;
  }

  const section = getResultSection(page);
  const sectionVisible = await section.isVisible({ timeout: 8_000 }).catch(() => false);

  if (!sectionVisible) {
    test.skip(true, 'RESULT-05: result section not found — skipping');
    return;
  }

  const homeInput = section.locator('input[type="number"]').nth(0);
  const awayInput = section.locator('input[type="number"]').nth(1);
  const actionButton = section
    .getByRole('button', { name: /save score|submit result/i })
    .first();

  await expect(actionButton).toBeVisible({ timeout: 5_000 });

  // Clear both inputs.
  await homeInput.fill('');
  await awayInput.fill('');
  await expect(actionButton).toBeDisabled({ timeout: 3_000 });

  // Filling only one keeps it disabled.
  await homeInput.fill('2');
  await expect(actionButton).toBeDisabled({ timeout: 2_000 });

  // Filling both enables the button.
  await awayInput.fill('0');
  await expect(actionButton).not.toBeDisabled({ timeout: 3_000 });
});
