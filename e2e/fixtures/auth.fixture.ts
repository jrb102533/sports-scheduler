/* eslint-disable react-hooks/rules-of-hooks */
import { test as base } from '@playwright/test';
import { AuthPage } from '../pages/AuthPage';
import { AdminPage } from '../pages/AdminPage';
import { ParentHomePage } from '../pages/ParentHomePage';

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

export type TestFixtures = {
  authPage: AuthPage;
  adminPage: AdminPage;
  parentPage: ParentHomePage;
  /** Authenticated as admin — navigation to / is handled for you. */
  asAdmin: { page: AuthPage['page']; admin: AdminPage };
  /** Authenticated as parent — navigation to /parent is handled for you. */
  asParent: { page: AuthPage['page']; parent: ParentHomePage };
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

  asAdmin: async ({ page }, use) => {
    const auth = new AuthPage(page);
    await auth.loginAndWaitForApp(
      requireEnv('E2E_ADMIN_EMAIL'),
      requireEnv('E2E_ADMIN_PASSWORD'),
    );
    const admin = new AdminPage(page);
    await use({ page, admin });
  },

  asParent: async ({ page }, use) => {
    const auth = new AuthPage(page);
    await auth.loginAndWaitForApp(
      requireEnv('E2E_PARENT_EMAIL'),
      requireEnv('E2E_PARENT_PASSWORD'),
    );
    const parent = new ParentHomePage(page);
    await parent.goto();
    await use({ page, parent });
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
};
