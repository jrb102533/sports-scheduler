/**
 * @emu @auth — Invite flow (unauthenticated entry points)
 *
 * Ported from e2e/invite-flow.spec.ts — only the tests that do not require
 * a live Cloud Function call, a real SMTP inbox, or mutable staging data.
 *
 * Tests NOT migrated here (require live CF / real email / staging data):
 *   - "adding a player with a parent email creates an invite" (calls sendInvite CF)
 *   - "admin can revoke a pending invite" (requires pre-existing staging invite)
 *   - "team detail page shows Invites tab for admin" (requires asAdmin fixture)
 * Those tests are documented in e2e/COVERAGE.md as "manual checklist only".
 *
 * The allowlist-bypass path (invite secret → signup bypass) is already covered
 * by e2e/emulator/invite-signup-allowlist.emu.spec.ts.
 */
import { test, expect } from '../fixtures/auth.emu.fixture.js';

// ---------------------------------------------------------------------------
// Signup page is reachable and shows required fields
// (already in auth-logout.emu.spec.ts but kept here for bucket grouping)
// ---------------------------------------------------------------------------

test('@emu @auth invite signup page renders Create Account form', async ({ page }) => {
  await page.goto('/signup');

  // SignupPage renders a "Create account" heading and standard form fields.
  await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Password').first()).toBeVisible();

  // "Create Account" submit button must start disabled — terms not yet agreed.
  await expect(page.getByRole('button', { name: /create account/i })).toBeDisabled();
});

// ---------------------------------------------------------------------------
// /invite/league redirects unauthenticated users
// ---------------------------------------------------------------------------

test('@emu @auth unauthenticated /invite/league redirects to /login', async ({ page }) => {
  await page.goto('/invite/league');
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Authenticated user can reach /invite/league without being redirected
// ---------------------------------------------------------------------------

test('@emu @auth authenticated admin can reach /invite/league', async ({ adminPage: page }) => {
  await page.goto('/invite/league');

  // Should not redirect to /login when authenticated.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
});
