/**
 * @emu @admin — full /users lifecycle (migrated from e2e/admin-users-full.spec.ts)
 *
 * Extends users-page.emu.spec.ts (which covers the static surface) with
 * end-to-end lifecycle scenarios that exercise the admin Cloud Functions:
 *   USR-FULL-01: createUserByAdmin — new user appears in the list with role badge
 *   USR-FULL-05: deleteUserByAdmin — admin can delete a user and they disappear
 *
 * Tests NOT migrated:
 *   USR-FULL-02 (role dropdown change) — staging UI used a row-level <select>;
 *     the current SlideOver-based memberships UI doesn't expose an inline role
 *     dropdown, so the test no longer translates 1:1.
 *   USR-FULL-03 (resetUserPassword + success toast) — that CF calls SMTP via
 *     transporter.sendMail. The emulator CI sets SMTP_HOST=emulator.local
 *     (DNS-unresolvable), so the CF throws and the toast never appears. Worth
 *     covering as an integration-tier test once we wire a stub transporter,
 *     or as a manual checklist item.
 *   USR-FULL-04 (no self-delete button) — already covered by ADMIN-USR-08
 *     in users-page.emu.spec.ts.
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';
import { EMU_IDS } from '../seed-emulator.js';

// User cards live in <main>; sidebar/topbar both render the current user's
// display name, so list-level locators must be scoped or strict-mode trips.
function userList(page: import('@playwright/test').Page) {
  return page.getByRole('main');
}

async function gotoUsers(page: import('@playwright/test').Page) {
  await page.goto('/users');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByText(/\d+ users?/)).toBeVisible({ timeout: 15_000 });
}

/**
 * Create a coach via the AddUserModal and return the modal close so the page
 * is back in its normal list state. The seed always exposes Emu Team A as
 * `emu-team-a`, which is what the form's team dropdown surfaces by name.
 */
async function createCoachViaModal(
  page: import('@playwright/test').Page,
  displayName: string,
  email: string,
): Promise<void> {
  await page.getByRole('button', { name: /add user/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  const [firstName, ...rest] = displayName.split(' ');
  const lastName = rest.join(' ') || 'Test';
  await dialog.getByLabel(/first name/i).fill(firstName);
  await dialog.getByLabel(/last name/i).fill(lastName);
  await dialog.getByLabel(/email/i).fill(email);

  // Temporary Password isn't an HTML <label for=…> — fall back to placeholder
  await dialog.getByPlaceholder(/at least 8 characters/i).fill('TempPass123!');

  await dialog.getByLabel(/role/i).selectOption('coach');
  // Selecting role=coach reveals the Team select
  await dialog.getByLabel(/team/i).selectOption(EMU_IDS.teamAId);

  // Form submit — button is "Create User" (becomes "Creating…" while in flight).
  // The modal flips to a "User Created" success view on success.
  await dialog.getByRole('button', { name: /^create user$/i }).click();

  // Success view shows the temp password + a Done button
  await expect(dialog.getByText(/user created|temporary password/i).first())
    .toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: /^done$/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
}

// ---------------------------------------------------------------------------
// USR-FULL-01: createUserByAdmin — new user appears in list
// ---------------------------------------------------------------------------

test('@emu @admin USR-FULL-01: newly created user appears in the list', async ({
  adminPage: page,
}) => {
  await gotoUsers(page);

  const stamp = Date.now();
  const displayName = `E2E Coach ${stamp}`;
  const email = `e2e-coach-${stamp}@emu.test`;

  await createCoachViaModal(page, displayName, email);

  // The new user card should appear in the main content area
  await expect(userList(page).getByText(displayName, { exact: false }).first())
    .toBeVisible({ timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// USR-FULL-05: deleteUserByAdmin — admin can delete a user
// ---------------------------------------------------------------------------

test('@emu @admin USR-FULL-05: admin can delete a created user', async ({
  adminPage: page,
}) => {
  await gotoUsers(page);

  const stamp = Date.now();
  const displayName = `E2E DeleteTarget ${stamp}`;
  const email = `e2e-del-${stamp}@emu.test`;

  await createCoachViaModal(page, displayName, email);

  // Open the new user's detail panel
  const newUserCard = userList(page).getByRole('button', { name: new RegExp(displayName, 'i') }).first();
  await expect(newUserCard).toBeVisible({ timeout: 15_000 });
  await newUserCard.click();

  // Detail panel → Danger Zone → Delete User
  const detailPanel = page.getByLabel('Edit User');
  await detailPanel.getByRole('button', { name: /delete user/i }).click();

  // ConfirmDialog → Confirm
  await page.getByRole('button', { name: /^delete$|^confirm$|^yes$/i }).last().click();

  // The user card must disappear from the list
  await expect(userList(page).getByText(displayName, { exact: false }))
    .not.toBeVisible({ timeout: 15_000 });
});
