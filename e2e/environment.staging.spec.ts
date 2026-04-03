/**
 * Staging environment checks
 *
 * Matched ONLY by the "staging" Playwright project (testMatch: /.*.staging.spec.ts/).
 * Run with: npx playwright test --project=staging
 *
 * Covers:
 *   GO_LIVE_CHECKLIST: Staging banner IS visible on staging URL
 */

import { test, expect, creds } from './fixtures/auth.fixture';

test('staging environment banner IS visible on the staging URL', async ({
  authPage,
  page,
}) => {
  const { email, password } = creds.admin();
  await authPage.loginAndWaitForApp(email, password);

  // The amber banner must be present and label must read "staging"
  const banner = page.locator('[class*="bg-amber-50"]');
  await expect(banner).toBeVisible({ timeout: 10_000 });

  const label = banner.locator('span').filter({ hasText: /staging/i }).first();
  await expect(label).toBeVisible();
});
