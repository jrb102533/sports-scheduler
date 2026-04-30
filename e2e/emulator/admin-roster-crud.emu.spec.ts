/**
 * @emu @admin — admin roster CRUD (migrated from e2e/coach.spec.ts)
 *
 * Covers:
 *   ADMIN-PLR-01: admin can edit a player's name from the roster row
 *   ADMIN-PLR-02: admin can delete a player from the roster row
 *
 * Existing emu coverage we don't duplicate:
 *   - add-player.emu.spec.ts — add player happy path
 *   - cancelled-event.emu.spec.ts (CANCEL-02..05) — cancel-event side effects
 *   - admin.emu.spec.ts — Add Player form open/close
 *
 * The staging spec was named coach.spec.ts but its tests all run as admin.
 * The unique-and-uncovered tests are roster edit + delete; everything else
 * was either already in the @emu suite or covered by EVENT-* / CANCEL-* tests.
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';
import { EMU_IDS } from '../seed-emulator.js';

async function gotoRoster(page: import('@playwright/test').Page) {
  await page.goto(`/teams/${EMU_IDS.teamAId}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('body[data-hydrated="true"]', { timeout: 30_000 });

  const rosterTab = page.getByRole('tab', { name: /roster/i });
  await expect(rosterTab).toBeVisible({ timeout: 10_000 });
  await rosterTab.click();
}

async function addPlayer(
  page: import('@playwright/test').Page,
  firstName: string,
  lastName: string,
): Promise<void> {
  await page.getByRole('button', { name: /add player/i }).click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  await modal.getByLabel('First Name').fill(firstName);
  await modal.getByLabel('Last Name').fill(lastName);
  await modal.getByRole('button', { name: /save|add player/i }).click();

  await expect(modal).not.toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText(new RegExp(`${firstName}.*${lastName}|${lastName}.*${firstName}`, 'i')),
  ).toBeVisible({ timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// ADMIN-PLR-01
// ---------------------------------------------------------------------------

test('@emu @admin ADMIN-PLR-01: admin can edit a player name on the roster', async ({
  adminPage: page,
}) => {
  const stamp = Date.now();
  const firstName = `EditMe${stamp}`;
  const lastName = 'Player';
  const newFirstName = `Edited${stamp}`;

  await gotoRoster(page);
  await addPlayer(page, firstName, lastName);

  // Edit button is rendered with aria-label `Edit FirstName LastName`
  const editBtn = page.getByRole('button', { name: new RegExp(`edit ${firstName} ${lastName}`, 'i') }).first();
  await expect(editBtn).toBeVisible({ timeout: 5_000 });
  await editBtn.click();

  const editModal = page.getByRole('dialog');
  await expect(editModal).toBeVisible({ timeout: 5_000 });

  const firstNameInput = editModal.getByLabel('First Name');
  await firstNameInput.clear();
  await firstNameInput.fill(newFirstName);
  await editModal.getByRole('button', { name: /save/i }).click();

  await expect(editModal).not.toBeVisible({ timeout: 10_000 });

  // Updated name appears in the roster
  await expect(
    page.getByText(new RegExp(`${newFirstName}.*${lastName}|${lastName}.*${newFirstName}`, 'i')),
  ).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// ADMIN-PLR-02
// ---------------------------------------------------------------------------

test('@emu @admin ADMIN-PLR-02: admin can delete a player from the roster', async ({
  adminPage: page,
}) => {
  const stamp = Date.now();
  const firstName = `DeleteMe${stamp}`;
  const lastName = 'Player';

  await gotoRoster(page);
  await addPlayer(page, firstName, lastName);

  // Remove button is rendered with aria-label `Remove FirstName LastName`
  const removeBtn = page.getByRole('button', { name: new RegExp(`remove ${firstName} ${lastName}`, 'i') }).first();
  await expect(removeBtn).toBeVisible({ timeout: 5_000 });
  await removeBtn.click();

  // ConfirmDialog default confirmLabel is 'Delete'
  const confirmBtn = page.getByRole('button', { name: /^delete$/i }).last();
  if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await confirmBtn.click();
  }

  // Player should disappear from the roster — assert via the row aria-label,
  // which is more deterministic than a text match across the document.
  await expect(
    page.getByRole('button', { name: new RegExp(`remove ${firstName} ${lastName}`, 'i') }),
  ).toHaveCount(0, { timeout: 15_000 });
});
