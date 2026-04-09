/**
 * Parent role E2E tests — gap coverage
 *
 * Covers:
 *   PARENT-ROLE-01: /users is blocked — parent is redirected away (not shown admin content)
 *   PARENT-ROLE-02: Profile page loads and shows "Parent" role badge
 *   PARENT-ROLE-03: Player card PII check — parent CAN see parentContact fields on player
 *                   cards for their child. Gracefully skips if no player cards with contact
 *                   info are visible (ParentHomePage currently shows events only; this test
 *                   documents the expectation for when a roster view is added).
 *   PARENT-ROLE-04: Session timeout warning appears after 30 minutes of inactivity
 *
 * Does NOT duplicate:
 *   - Routing redirect to /parent
 *   - Team header visible
 *   - Upcoming Games heading
 *   - RSVP Going / Not Going / toggle / persistence
 *   - Snack slot claim / release / persistence
 *   - Empty state
 *   - Page renders without crash
 *
 * Requires:
 *   E2E_PARENT_EMAIL / E2E_PARENT_PASSWORD — a parent account.
 *   The account must have role 'parent' in its Firestore profile and must be
 *   linked to a team that has at least one player document with sensitiveData
 *   populated for PARENT-ROLE-03 to run (not skip).
 */

import { test, expect } from './fixtures/auth.fixture';
import { AuthPage } from './pages/AuthPage';

// ---------------------------------------------------------------------------
// PARENT-ROLE-01 — /users is blocked for parent role
// ---------------------------------------------------------------------------

test('PARENT-ROLE-01: parent visiting /users is redirected away', async ({ asParent }) => {
  const { page } = asParent;

  await page.goto('/users');

  // RoleGuard with redirect=true sends non-admin back to /
  // Dashboard then redirects parent role to /parent
  await expect(page).not.toHaveURL(/\/users/, { timeout: 10_000 });
  await expect(page).toHaveURL(/^\/(parent|home)?$/, { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// PARENT-ROLE-02 — profile page shows Parent badge
// ---------------------------------------------------------------------------

test('PARENT-ROLE-02: parent profile page loads and shows Parent role badge', async ({ asParent }) => {
  const { page } = asParent;

  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');

  // Profile page heading
  const editProfileHeading = page.getByRole('heading', { name: /edit profile/i });
  await expect(editProfileHeading).toBeVisible({ timeout: 10_000 });

  // The Parent membership badge — "Parent" text appears inside the
  // Roles section rendered by ProfilePage
  const parentBadge = page.getByText(/\bparent\b/i).first();
  await expect(parentBadge).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// PARENT-ROLE-03 — player card PII: parent can see parentContact fields
//
// The current ParentHomePage renders upcoming events only — it does not
// expose a roster or player cards. This test checks for parentContact fields
// if they become visible on the /parent route and skips gracefully if the
// current UI does not render them.
//
// When a parent-facing roster view ships, remove the skip branch and add a
// concrete locator for the player card contact section.
// ---------------------------------------------------------------------------

test('PARENT-ROLE-03: parent can see parentContact fields on their child\'s player card', async ({ asParent }) => {
  const { page } = asParent;

  // The /parent page must have fully loaded (fixture already called goto())
  await page.waitForLoadState('domcontentloaded');

  // Look for any visible parentContact label — the component uses text labels
  // such as "Parent Contact", "Parent Name", "Parent Phone", or "Parent Email"
  const contactSectionHeading = page.getByText(/parent contact/i).first();
  const parentNameLabel = page.getByText(/parent name/i).first();
  const parentPhoneLabel = page.getByText(/parent phone/i).first();
  const parentEmailLabel = page.getByText(/parent email/i).first();

  const contactVisible = await contactSectionHeading.isVisible({ timeout: 3_000 }).catch(() => false);
  const nameVisible = await parentNameLabel.isVisible({ timeout: 1_000 }).catch(() => false);
  const phoneVisible = await parentPhoneLabel.isVisible({ timeout: 1_000 }).catch(() => false);
  const emailVisible = await parentEmailLabel.isVisible({ timeout: 1_000 }).catch(() => false);

  const anyContactFieldVisible = contactVisible || nameVisible || phoneVisible || emailVisible;

  if (!anyContactFieldVisible) {
    // The current ParentHomePage does not render player cards with contact
    // fields. This is a known gap — skip rather than false-pass.
    test.skip(true, 'No player card contact fields visible on /parent — roster view not yet implemented; revisit when parent-facing roster ships');
    return;
  }

  // If player cards with contact info ARE rendered, every visible contact
  // section must show at least a name or phone or email value (not blank).
  // Assert that at least one concrete piece of contact data is present.
  const anyDataVisible =
    (await page.getByText(/parent name/i).first().isVisible({ timeout: 2_000 }).catch(() => false)) ||
    (await page.getByText(/\d{3}[-.\s]\d{3}[-.\s]\d{4}/).first().isVisible({ timeout: 2_000 }).catch(() => false)) ||
    (await page.getByText(/@/).first().isVisible({ timeout: 2_000 }).catch(() => false));

  expect(
    anyDataVisible,
    'Parent contact section is visible but no name, phone, or email data was found — possible PII rendering bug',
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// PARENT-ROLE-04 — session timeout warning after 30 minutes of inactivity
//                  Uses Playwright's page.clock API to fast-forward time.
// ---------------------------------------------------------------------------

test('PARENT-ROLE-04: parent sees session expiring warning after 30 minutes of inactivity', async ({ page }) => {
  const parentEmail = process.env.E2E_PARENT_EMAIL;
  const parentPassword = process.env.E2E_PARENT_PASSWORD;

  if (!parentEmail || !parentPassword) {
    test.skip(true, 'E2E_PARENT_EMAIL / E2E_PARENT_PASSWORD not set');
    return;
  }

  const auth = new AuthPage(page);
  await auth.loginAndWaitForApp(parentEmail, parentPassword);

  // Install a fake clock AFTER login so the auth flow uses real time
  await page.clock.install();

  // Fast-forward 30 minutes + 1 second to cross the idle threshold
  await page.clock.fastForward('30:01');

  const modal = page.getByRole('heading', { name: /session expiring soon/i });
  await expect(modal).toBeVisible({ timeout: 5_000 });
});
