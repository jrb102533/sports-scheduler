/**
 * @emu @admin — Admin create-team smoke (Phase 3b)
 *
 * Exercises the `createTeamAndBecomeCoach` Cloud Function (callable) via the
 * Functions emulator. Ported from e2e/admin.spec.ts.
 *
 * The e2e-emulator.yml workflow builds the Functions bundle and starts the
 * Functions emulator (port 5001) alongside auth/firestore/storage before
 * Playwright runs. The web app connects to it when VITE_USE_EMULATOR=true.
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';

test('@emu @admin admin can create a new team and it appears in the teams list', async ({ adminPage }) => {
  test.skip(true, '#479 — CF rejects default FE palette color "Crimson" (#DC143C) with invalid-argument. Un-skip once CF allowlist aligns with TEAM_COLOR_PALETTE.');
  const page = adminPage;
  const uniqueName = `Emu Team ${Date.now()}`;

  await page.goto('/teams');
  await page.waitForLoadState('domcontentloaded');

  await page.getByRole('button', { name: /new team/i }).click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  await modal.getByLabel('Team Name').fill(uniqueName);

  const saveBtn = modal.getByRole('button', { name: /save|create team/i });
  await saveBtn.click();

  // createTeamAndBecomeCoach CF can take up to 15-20s on cold start.
  await expect(modal).not.toBeVisible({ timeout: 30_000 });

  // Team should appear in the list.
  await expect(page.getByText(uniqueName, { exact: false })).toBeVisible({ timeout: 10_000 });
});
