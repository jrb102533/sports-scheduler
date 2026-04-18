/* eslint-disable react-hooks/rules-of-hooks */
/**
 * Emulator-tier auth fixture.
 *
 * Exposes one Playwright Page per seeded role, already signed in against the
 * Firebase Auth emulator. No storageState persistence — emulator login is fast
 * enough that per-test sign-in adds negligible overhead, and avoiding persistence
 * keeps the setup simple (no global-setup dependency, no stale-token risk).
 *
 * Usage:
 *   import { test, expect } from '../fixtures/auth.emu.fixture.js';
 *
 *   test('my test', async ({ adminPage }) => {
 *     await adminPage.goto('/profile');
 *     // adminPage is a Page already authenticated as admin@emu.test
 *   });
 */
import { test as base, type Page } from '@playwright/test';
import { EMU_USERS, EMU_PASSWORD, type EmuUser } from '../seed-emulator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Signs in as the given seeded user and waits for the redirect off /login.
 * Returns the Page already on an authenticated route.
 */
async function signInAsEmuUser(page: Page, user: EmuUser): Promise<Page> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /email/i }).fill(user.email);
  await page.getByRole('textbox', { name: /password/i }).fill(EMU_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Redirect away from /login proves Firebase Auth accepted the credentials.
  await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15_000 });

  return page;
}

function findUser(role: EmuUser['role']): EmuUser {
  const user = EMU_USERS.find(u => u.role === role);
  if (!user) throw new Error(`[auth.emu.fixture] No seeded user with role="${role}"`);
  return user;
}

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

export type EmuFixtures = {
  /** Page authenticated as emu-admin (admin@emu.test, admin claim). */
  adminPage: Page;
  /** Page authenticated as emu-coach (coach@emu.test). */
  coachPage: Page;
  /** Page authenticated as emu-lm (lm@emu.test). */
  lmPage: Page;
  /** Page authenticated as emu-parent (parent@emu.test). */
  parentPage: Page;
  /** Page authenticated as emu-player (player@emu.test). */
  playerPage: Page;
};

// ---------------------------------------------------------------------------
// Extended test
// ---------------------------------------------------------------------------

export const test = base.extend<EmuFixtures>({
  adminPage: async ({ page }, use) => {
    await signInAsEmuUser(page, findUser('admin'));
    await use(page);
  },

  coachPage: async ({ page }, use) => {
    await signInAsEmuUser(page, findUser('coach'));
    await use(page);
  },

  lmPage: async ({ page }, use) => {
    await signInAsEmuUser(page, findUser('league_manager'));
    await use(page);
  },

  parentPage: async ({ page }, use) => {
    await signInAsEmuUser(page, findUser('parent'));
    await use(page);
  },

  playerPage: async ({ page }, use) => {
    await signInAsEmuUser(page, findUser('player'));
    await use(page);
  },
});

export { expect } from '@playwright/test';
