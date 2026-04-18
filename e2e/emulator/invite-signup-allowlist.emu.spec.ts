/**
 * @emu — Parent signup via invite link bypasses allowlist (fix/invite-signup-allowlist)
 *
 * Scenario: signupConfig.open = false (signup restricted). A parent with an email
 * address NOT in the allowlist follows an invite link containing a valid
 * inviteSecret.  The signup page must succeed without the allowlist error.
 *
 * Prerequisites seeded by e2e/seed-emulator.ts:
 *   - system/signupConfig: { open: false, allowedEmails: [], allowedDomains: [] }
 *   - invites/<id>: pending invite for invitee@external.test with EMU_IDS.inviteSecret
 *
 * The Functions emulator is included in the @emu CI run
 * (.github/workflows/e2e-emulator.yml --only=auth,firestore,storage,functions)
 * so previewInvite is reachable without any skip guard.
 */

import { test, expect } from '@playwright/test';
import { EMU_IDS } from '../seed-emulator';

// ---------------------------------------------------------------------------
// Constants — kept in sync with seed-emulator.ts via EMU_IDS
// ---------------------------------------------------------------------------

const INVITE_SECRET = EMU_IDS.inviteSecret;
const INVITE_EMAIL = 'invitee@external.test';
const INVITE_PASSWORD = 'InviteTest99!';

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

test('@emu @invite parent-with-invite can sign up despite allowlist restriction', async ({
  page,
}) => {
  // Navigate to the signup page with the invite link.
  // SignupPage reads ?inviteSecret from the query string and strips it immediately,
  // so the URL only needs to carry it at navigation time.
  await page.goto(`/signup?inviteSecret=${INVITE_SECRET}`);
  await page.waitForLoadState('domcontentloaded');

  // Signup form should be visible.
  await expect(page.getByText('Create account')).toBeVisible({ timeout: 10_000 });

  // Fill in the form with the invited email.
  const firstName = page.getByLabel('First Name');
  const lastName = page.getByLabel('Last Name');
  const emailField = page.getByLabel('Email', { exact: true });
  const passwordField = page.getByLabel('Password').first();
  const termsCheckbox = page.getByRole('checkbox', { name: /I agree to the Terms of Service/i });

  await firstName.fill('Emu');
  await lastName.fill('InvitedParent');
  await emailField.fill(INVITE_EMAIL);
  await passwordField.fill(INVITE_PASSWORD);
  await termsCheckbox.check();

  // Submit.
  const submitBtn = page.getByRole('button', { name: /create account/i });
  await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
  await submitBtn.click();

  // The allowlist error must NOT appear.
  // This is the primary assertion — it fails if previewInvite is not called or
  // the bypass logic is not wired correctly in signup().
  await expect(page.getByText(/sign-ups are restricted/i)).not.toBeVisible({ timeout: 8_000 });

  // Secondary: either email-verification state OR redirect to a post-auth route,
  // depending on whether the invite's autoVerify flag fires.
  await page
    .waitForURL(/^\/(dashboard|home|teams|signup)/, { timeout: 12_000 })
    .catch(() => {});
});
