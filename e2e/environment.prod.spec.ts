/**
 * Production environment checks
 *
 * Matched ONLY by the "production" Playwright project (testMatch: /.*.prod.spec.ts/).
 * Run with: npx playwright test --project=production
 *
 * Covers:
 *   GO_LIVE_CHECKLIST: Production banner is NOT visible on firstwhistlesports.com
 */

import { test, expect, creds } from './fixtures/auth.fixture';

test('production environment banner is NOT visible on firstwhistlesports.com', async ({
  authPage,
  page,
}) => {
  const { email, password } = creds.admin();
  await authPage.loginAndWaitForApp(email, password);

  // The amber environment banner MUST NOT appear in production
  const banner = page.locator('[class*="bg-amber-50"]').filter({
    has: page.locator('[class*="uppercase"]'),
  });

  await expect(banner).not.toBeVisible({ timeout: 10_000 });
});

test('app loads on firstwhistlesports.com without console errors', async ({
  authPage,
  page,
}) => {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  const { email, password } = creds.admin();
  await authPage.loginAndWaitForApp(email, password);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

  // Filter out known benign Firebase errors (e.g. quota exceeded warnings in prod that are not actionable)
  const criticalErrors = errors.filter(
    e => !e.includes('favicon') && !e.includes('Content Security Policy'),
  );

  expect(criticalErrors).toHaveLength(0);
});
