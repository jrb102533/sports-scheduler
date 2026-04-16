/* eslint-disable react-hooks/rules-of-hooks */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { test as base } from '@playwright/test';
import { AuthPage } from '../pages/AuthPage';
import { AdminPage } from '../pages/AdminPage';
import { ParentHomePage } from '../pages/ParentHomePage';
import { PlayerHomePage } from '../pages/PlayerHomePage';
import { LeagueManagerPage } from '../pages/LeagueManagerPage';
import { CoachPage } from '../pages/CoachPage';

/**
 * Test credentials are read from environment variables.
 * Never hardcode credentials — see e2e/README.md.
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
        'See e2e/README.md for setup instructions.',
    );
  }
  return v;
}

/**
 * Resolve the path to a role's pre-saved storageState file.
 * These files are written by global-setup.ts once per CI run.
 */
function authStatePath(role: string): string {
  return path.join(__dirname, '..', '.auth', `${role}.json`);
}

/**
 * Returns true if the storageState file for the given role exists.
 * Falls back to live login when global-setup hasn't run (e.g., local dev
 * without credentials configured for that role).
 */
function hasStorageState(role: string): boolean {
  return fs.existsSync(authStatePath(role));
}

/**
 * Navigate to / and wait for Firebase Auth to initialize and the route guard to
 * redirect. Authenticated sessions land on /home; expired sessions land on /login.
 *
 * `waitForLoadState('domcontentloaded')` fires before React mounts and before
 * Firebase Auth determines the session state, so ensureAuthenticated would check
 * the URL too early and see "/" instead of "/login". This helper waits for the
 * auth-driven redirect to complete before handing off.
 */
async function gotoAndWaitForAuthRedirect(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.goto('/');
  try {
    // Wait for Firebase Auth to settle: /home (valid session) or /login (expired).
    // Falls back gracefully if the redirect doesn't happen within 20s.
    await page.waitForURL(
      url => {
        const u = url.toString();
        return u.includes('/home') || u.includes('/login');
      },
      { timeout: 20_000 },
    );
  } catch {
    // Redirect didn't happen within 20s — proceed with current URL.
    // ensureAuthenticated will inspect the URL and live-login if needed.
    console.warn(`[auth.fixture] gotoAndWaitForAuthRedirect timed out — current URL: ${page.url()}`);
  }
}

/**
 * After restoring a storageState context, the Firebase token may have expired
 * if the suite has been running for >1 hour. If the page lands on /login,
 * re-authenticate with the env-var credentials so the test can proceed.
 *
 * Always call gotoAndWaitForAuthRedirect() before this so the URL has had
 * time to settle to /home or /login.
 */
async function ensureAuthenticated(
  page: import('@playwright/test').Page,
  emailEnvVar: string,
  passwordEnvVar: string,
): Promise<void> {
  if (page.url().includes('/login')) {
    const auth = new AuthPage(page);
    await auth.loginAndWaitForApp(requireEnv(emailEnvVar), requireEnv(passwordEnvVar));
  }
}

/**
 * Wait for MainLayout to signal that the initial Firestore snapshots have
 * been delivered (teams + events stores both have loading=false).
 * MainLayout writes data-hydrated="true" to <body> when this condition is met.
 *
 * This is a best-effort helper — it does NOT throw on timeout. Individual
 * test assertions are responsible for handling remaining latency.
 * Call this in tests that need to wait for store data before asserting.
 */
export async function waitForAppHydrated(
  page: import('@playwright/test').Page,
  timeout = 15_000,
): Promise<void> {
  try {
    await page.waitForSelector('body[data-hydrated="true"]', { timeout });
  } catch {
    // Hydration signal didn't arrive — proceed and let test assertions handle it.
    console.warn('[waitForAppHydrated] timed out — Firestore stores may still be loading');
  }
}

export type TestFixtures = {
  authPage: AuthPage;
  adminPage: AdminPage;
  parentPage: ParentHomePage;
  playerPage: PlayerHomePage;
  leagueManagerPage: LeagueManagerPage;
  coachPage: CoachPage;
  /** Authenticated as admin — navigation to / is handled for you. */
  asAdmin: { page: AuthPage['page']; admin: AdminPage };
  /** Authenticated as parent — navigation to /parent is handled for you. */
  asParent: { page: AuthPage['page']; parent: ParentHomePage };
  /** Authenticated as player — navigation to /parent is handled for you. */
  asPlayer: { page: AuthPage['page']; player: PlayerHomePage };
  /** Authenticated as league manager — navigation to / is handled for you. */
  asLeagueManager: { page: AuthPage['page']; lm: LeagueManagerPage };
  /** Authenticated as coach — navigation to / is handled for you. */
  asCoach: { page: AuthPage['page']; coach: CoachPage };
};

export const test = base.extend<TestFixtures>({
  authPage: async ({ page }, use) => {
    await use(new AuthPage(page));
  },

  adminPage: async ({ page }, use) => {
    await use(new AdminPage(page));
  },

  parentPage: async ({ page }, use) => {
    await use(new ParentHomePage(page));
  },

  playerPage: async ({ page }, use) => {
    await use(new PlayerHomePage(page));
  },

  leagueManagerPage: async ({ page }, use) => {
    await use(new LeagueManagerPage(page));
  },

  coachPage: async ({ page }, use) => {
    await use(new CoachPage(page));
  },

  /**
   * asAdmin — restores the admin session from global-setup storageState.
   * Falls back to live login if the state file does not exist.
   */
  asAdmin: async ({ browser, page }, use, testInfo) => {
    const role = 'admin';

    if (hasStorageState(role)) {
      const context = await browser.newContext({
        ...testInfo.project.use,
        storageState: authStatePath(role),
      });
      const p = await context.newPage();
      await gotoAndWaitForAuthRedirect(p);
      await ensureAuthenticated(p, 'E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASSWORD');
      const admin = new AdminPage(p);
      await use({ page: p, admin });
      await context.close();
    } else {
      // Fallback: live login (local dev without pre-saved state)
      const auth = new AuthPage(page);
      await auth.loginAndWaitForApp(
        requireEnv('E2E_ADMIN_EMAIL'),
        requireEnv('E2E_ADMIN_PASSWORD'),
      );
      const admin = new AdminPage(page);
      await use({ page, admin });
    }
  },

  /**
   * asParent — restores the parent session from global-setup storageState.
   * Falls back to live login if the state file does not exist.
   */
  asParent: async ({ browser, page }, use, testInfo) => {
    const role = 'parent';

    if (hasStorageState(role)) {
      const context = await browser.newContext({
        ...testInfo.project.use,
        storageState: authStatePath(role),
      });
      const p = await context.newPage();
      await gotoAndWaitForAuthRedirect(p);
      await ensureAuthenticated(p, 'E2E_PARENT_EMAIL', 'E2E_PARENT_PASSWORD');
      const parent = new ParentHomePage(p);
      await parent.goto();
      await use({ page: p, parent });
      await context.close();
    } else {
      const auth = new AuthPage(page);
      await auth.loginAndWaitForApp(
        requireEnv('E2E_PARENT_EMAIL'),
        requireEnv('E2E_PARENT_PASSWORD'),
      );
      const parent = new ParentHomePage(page);
      await parent.goto();
      await use({ page, parent });
    }
  },

  /**
   * asPlayer — restores the player session from global-setup storageState.
   * Falls back to live login if the state file does not exist.
   */
  asPlayer: async ({ browser, page }, use, testInfo) => {
    const role = 'player';

    if (hasStorageState(role)) {
      const context = await browser.newContext({
        ...testInfo.project.use,
        storageState: authStatePath(role),
      });
      const p = await context.newPage();
      await gotoAndWaitForAuthRedirect(p);
      await ensureAuthenticated(p, 'E2E_PLAYER_EMAIL', 'E2E_PLAYER_PASSWORD');
      const player = new PlayerHomePage(p);
      await player.goto();
      await use({ page: p, player });
      await context.close();
    } else {
      const auth = new AuthPage(page);
      await auth.loginAndWaitForApp(
        requireEnv('E2E_PLAYER_EMAIL'),
        requireEnv('E2E_PLAYER_PASSWORD'),
      );
      const player = new PlayerHomePage(page);
      await player.goto();
      await use({ page, player });
    }
  },

  /**
   * asLeagueManager — restores the LM session from global-setup storageState.
   * Falls back to live login if the state file does not exist.
   */
  asLeagueManager: async ({ browser, page }, use, testInfo) => {
    const role = 'lm';

    if (hasStorageState(role)) {
      const context = await browser.newContext({
        ...testInfo.project.use,
        storageState: authStatePath(role),
      });
      const p = await context.newPage();
      await gotoAndWaitForAuthRedirect(p);
      await ensureAuthenticated(p, 'E2E_LM_EMAIL', 'E2E_LM_PASSWORD');
      const lm = new LeagueManagerPage(p);
      await lm.goto();
      await use({ page: p, lm });
      await context.close();
    } else {
      const auth = new AuthPage(page);
      await auth.loginAndWaitForApp(
        requireEnv('E2E_LM_EMAIL'),
        requireEnv('E2E_LM_PASSWORD'),
      );
      const lm = new LeagueManagerPage(page);
      await lm.goto();
      await use({ page, lm });
    }
  },

  /**
   * asCoach — restores the coach session from global-setup storageState.
   * Falls back to live login if the state file does not exist.
   */
  asCoach: async ({ browser, page }, use, testInfo) => {
    const role = 'coach';

    if (hasStorageState(role)) {
      const context = await browser.newContext({
        ...testInfo.project.use,
        storageState: authStatePath(role),
      });
      const p = await context.newPage();
      await gotoAndWaitForAuthRedirect(p);
      await ensureAuthenticated(p, 'E2E_COACH_EMAIL', 'E2E_COACH_PASSWORD');
      const coach = new CoachPage(p);
      await coach.goto();
      await use({ page: p, coach });
      await context.close();
    } else {
      const auth = new AuthPage(page);
      await auth.loginAndWaitForApp(
        requireEnv('E2E_COACH_EMAIL'),
        requireEnv('E2E_COACH_PASSWORD'),
      );
      const coach = new CoachPage(page);
      await coach.goto();
      await use({ page, coach });
    }
  },
});

export { expect } from '@playwright/test';

/**
 * Credentials helpers — only call inside a test that has opted in to needing them.
 */
export const creds = {
  admin: () => ({
    email: requireEnv('E2E_ADMIN_EMAIL'),
    password: requireEnv('E2E_ADMIN_PASSWORD'),
  }),
  parent: () => ({
    email: requireEnv('E2E_PARENT_EMAIL'),
    password: requireEnv('E2E_PARENT_PASSWORD'),
  }),
  player: () => ({
    email: requireEnv('E2E_PLAYER_EMAIL'),
    password: requireEnv('E2E_PLAYER_PASSWORD'),
  }),
  lm: () => ({
    email: requireEnv('E2E_LM_EMAIL'),
    password: requireEnv('E2E_LM_PASSWORD'),
  }),
  coach: () => ({
    email: requireEnv('E2E_COACH_EMAIL'),
    password: requireEnv('E2E_COACH_PASSWORD'),
  }),
};
