/**
 * @emu @admin — Admin create-team smoke (Phase 3a)
 *
 * Ported from e2e/admin.spec.ts line 52:
 *   "admin can create a new team and it appears in the teams list"
 *
 * SKIPPED — Functions emulator is not started in the CI workflow.
 *
 * The create-team flow calls the `createTeamAndBecomeCoach` Cloud Function
 * (callable). The e2e-emulator.yml workflow starts only `auth,firestore,storage`
 * via `--only=auth,firestore,storage`. The Functions emulator port (5001) is
 * configured in firebase.json but is NOT included in the CI run command.
 *
 * If this test were enabled as-is, the callable would fail to connect
 * (ECONNREFUSED on port 5001) and the test would hang until the 30s modal
 * timeout fires, then report an assertion error.
 *
 * Decision: skip with a linked issue rather than expand this PR's scope to
 * stand up a new emulator service. Starting the Functions emulator in CI also
 * requires building the functions bundle (`npm run build` inside `functions/`)
 * which adds ~60s to the job and is a separate infrastructure decision.
 *
 * Tracked in: https://github.com/jrb102533/sports-scheduler/issues — file a
 * new issue "Enable Functions emulator in e2e-emulator.yml (Phase 3b)" and
 * replace the TODO below with the issue number once filed.
 *
 * TODO: replace skip reason with issue number when filed (#TBD).
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';

test.skip(
  true,
  'createTeamAndBecomeCoach calls the Functions emulator which is not started in the ' +
  'e2e-emulator.yml CI workflow (only auth,firestore,storage). ' +
  'Track in a Phase 3b issue to add --only=functions to the workflow.',
);

// The test body below is preserved so it can be enabled once the Functions
// emulator is available. It does NOT run while test.skip(true) is in effect.
test('@emu @admin admin can create a new team and it appears in the teams list', async ({ adminPage }) => {
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
