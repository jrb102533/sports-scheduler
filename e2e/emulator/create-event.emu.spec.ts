/**
 * @emu @coach — Coach creates a new event for emu-team-a (Phase 3c)
 *
 * Happy-path: coach navigates to the seeded `emu-team-a` detail page,
 * opens the Schedule tab, clicks "Add Event" / "New Event", fills in the
 * minimum required fields (date, start time, title), saves, and confirms
 * the modal closes without error.
 *
 * No mutation-irreversible CF call is made — event creation writes directly
 * to Firestore.
 *
 * Ported from the createEventOnTeam helper in e2e/event-lifecycle.spec.ts
 * (EVT-LC-01 / EVT-LC-02 pattern).
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';
import { EMU_IDS } from '../seed-emulator.js';

test('@emu @coach coach can create a new event for emu-team-a from the Schedule tab', async ({ coachPage }) => {
  const page = coachPage;

  // Navigate directly to the seeded team.
  await page.goto(`/teams/${EMU_IDS.teamAId}`);
  await page.waitForLoadState('domcontentloaded');

  // Switch to the Schedule tab.
  const scheduleTab = page.getByRole('tab', { name: /schedule/i });
  await expect(scheduleTab).toBeVisible({ timeout: 30_000 });
  await scheduleTab.click();

  // Add Event button.
  const addEventBtn = page
    .getByRole('button', { name: /add event|new event|\+/i })
    .first();
  await expect(addEventBtn).toBeVisible({ timeout: 5_000 });
  await addEventBtn.click();

  // EventForm modal.
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  // Fill a future date.
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 7);
  const iso = futureDate.toISOString().split('T')[0] ?? '';

  const dateInput = modal.locator('input[type="date"]').first();
  await expect(dateInput).toBeVisible({ timeout: 5_000 });
  await dateInput.fill(iso);

  // Start time (optional field — fill if visible).
  const timeInput = modal.locator('input[type="time"]').first();
  if (await timeInput.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await timeInput.fill('10:00');
  }

  // Title (optional field — fill if visible).
  const titleInput = modal.getByLabel(/title|name/i).first();
  if (await titleInput.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await titleInput.fill(`Emu Practice ${Date.now()}`);
  }

  // Save.
  const saveBtn = modal.getByRole('button', { name: /save|create event/i });
  await saveBtn.click();

  // Modal must close — if it stays open, save failed.
  await expect(modal).not.toBeVisible({ timeout: 30_000 });

  // Still on the team detail page; no crash, no redirect to login.
  await expect(page).toHaveURL(/\/teams\/.+/);
  await expect(page).not.toHaveURL(/\/login/);
});
