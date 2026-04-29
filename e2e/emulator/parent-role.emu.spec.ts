/**
 * @emu @parent Parent role flows (migrated from e2e/parent-role.spec.ts)
 *
 * Covers:
 *   PARENT-ROLE-02: Profile page loads and shows "Parent" role badge
 *
 * Excluded / consolidated:
 *   - PARENT-ROLE-01 (parent /users blocked) — already covered in rbac.emu.spec.ts
 *   - PARENT-ROLE-03 (parentContact PII fields) — was already skipped on staging;
 *     pending a parent-facing roster view that isn't built yet.
 *   - PARENT-ROLE-04 (session timeout) — needs a fresh login flow with page.clock,
 *     which doesn't compose with the pre-authed parentPage fixture. Same exclusion
 *     pattern as LM-10.
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';

test('@emu @parent profile page loads and shows Parent role badge', async ({ parentPage }) => {
  await parentPage.goto('/profile');
  await parentPage.waitForLoadState('domcontentloaded');

  // Profile-page hydration races on slow emu CI runs — give Edit Profile
  // heading more headroom than the default 10s.
  await expect(parentPage.getByRole('heading', { name: /edit profile/i }))
    .toBeVisible({ timeout: 30_000 });
  await expect(parentPage.getByText(/parent/i).first())
    .toBeVisible({ timeout: 5_000 });
});
