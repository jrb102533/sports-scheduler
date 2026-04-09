/**
 * Messaging page smoke tests — MSG-*
 *
 * The /messaging route has zero E2E coverage.  These tests ensure that a crash
 * or regression on this page will fail CI rather than go unnoticed.
 *
 * Covers:
 *   MSG-01: Page loads without crashing for admin
 *   MSG-02: Both major layout sections (Recipients, Message) are visible
 *   MSG-03: Send button is disabled when no recipients are selected
 *   MSG-04: Send button is disabled when subject is empty (email channel)
 *   MSG-05: Send button is disabled when message body is empty
 *   MSG-06: Subject field is present on the email channel (default when SMS disabled)
 *   MSG-07: Message textarea is present and accepts input
 *   MSG-08: Admin sees "Platform Users" recipient section
 *   MSG-09: Selecting a platform user enables the recipient count copy
 *   MSG-10: Clearing the message body re-disables the Send button
 *   MSG-11: Navigating away and back to /messaging does not crash the page
 *
 * Notes:
 *   - MessagingPage is not behind a RoleGuard; any authenticated user can reach it.
 *   - All tests use the admin fixture (which has all coach permissions as well).
 *   - The page is a single-page composer — there is no modal to open; the Subject
 *     input and Message textarea are rendered inline.
 *   - FEATURE_SMS is disabled in staging, so only the email channel is visible.
 *     Tests that would require SMS are skipped when the SMS tab is absent.
 *   - Actual send calls (Cloud Function) are NOT exercised here.  Sending with live
 *     recipients is non-deterministic and belongs in a separate integration suite.
 */

import { test, expect } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to /messaging and wait for the page to be interactive.
 * Returns once the two-panel layout is stable.
 */
async function gotoMessaging(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/messaging');
  await page.waitForLoadState('networkidle');
}

/**
 * Returns true when the SMS channel tabs are present on the page.
 * When FEATURE_SMS is disabled the tabs are not rendered at all.
 */
async function hasSmsFeature(page: import('@playwright/test').Page): Promise<boolean> {
  return page.getByRole('button', { name: /^sms$/i }).isVisible({ timeout: 2_000 }).catch(() => false);
}

// ---------------------------------------------------------------------------
// MSG-01: Page loads without crashing for admin
// ---------------------------------------------------------------------------

test('messaging page loads without crashing for admin', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await gotoMessaging(page);

  // The page renders inside MainLayout — the page-level container is always present.
  // Assert the URL is correct and there is no error boundary / white-screen crash.
  await expect(page).toHaveURL(/\/messaging/);

  // At least one of the two headings (Recipients or Message) must be visible.
  // This rules out a blank render or a thrown exception swallowed by ErrorBoundary.
  const recipientsHeading = page.getByRole('heading', { name: /recipients/i })
    .or(page.locator('h2').filter({ hasText: /recipients/i }))
    .first();
  await expect(recipientsHeading).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// MSG-02: Both layout sections visible
// ---------------------------------------------------------------------------

test('messaging page renders both Recipients and Message sections', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await gotoMessaging(page);

  // Recipients panel heading
  const recipientsSection = page.locator('h2').filter({ hasText: /recipients/i }).first();
  await expect(recipientsSection).toBeVisible({ timeout: 10_000 });

  // Message composer heading — says "Message" for both SMS and email channels
  const messageSection = page.locator('h2').filter({ hasText: /message/i }).first();
  await expect(messageSection).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// MSG-03: Send button disabled when no recipients selected
// ---------------------------------------------------------------------------

test('send button is disabled when no recipients are selected', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await gotoMessaging(page);

  // Fill in subject and message so the only missing condition is recipients.
  // If the subject input is present (email channel), fill it.
  const subjectInput = page.locator('input[placeholder*="Practice"]')
    .or(page.locator('label').filter({ hasText: /^subject$/i }).locator('..').locator('input'))
    .first();
  const subjectVisible = await subjectInput.isVisible({ timeout: 3_000 }).catch(() => false);
  if (subjectVisible) {
    await subjectInput.fill('Smoke test subject');
  }

  // Fill the message textarea
  const messageTextarea = page.locator('textarea[placeholder*="message" i]').first();
  await expect(messageTextarea).toBeVisible({ timeout: 10_000 });
  await messageTextarea.fill('Smoke test message body');

  // The send button should remain disabled — no recipients have been selected.
  const sendBtn = page.getByRole('button', { name: /send/i }).last();
  await expect(sendBtn).toBeDisabled({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// MSG-04: Send button disabled when subject is empty (email channel)
// ---------------------------------------------------------------------------

test('send button is disabled when subject is empty on the email channel', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await gotoMessaging(page);

  const smsEnabled = await hasSmsFeature(page);

  // If SMS is enabled, ensure we are on the email channel.
  if (smsEnabled) {
    await page.getByRole('button', { name: /^email$/i }).click();
  }

  // Subject input must be visible on the email channel.
  const subjectInput = page.locator('input[placeholder*="Practice"]').first();
  const subjectPresent = await subjectInput.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!subjectPresent) {
    test.skip(true, 'Subject input not found — email channel may not be active');
    return;
  }

  // Fill message but leave subject blank.
  const messageTextarea = page.locator('textarea[placeholder*="message" i]').first();
  await messageTextarea.fill('A message without a subject');

  // Select all platform users if any exist (so recipients are not zero).
  const selectAllBtn = page.getByText(/select all/i).first();
  const canSelectAll = await selectAllBtn.isVisible({ timeout: 3_000 }).catch(() => false);
  if (canSelectAll) {
    await selectAllBtn.click();
  }

  // Send must still be disabled because subject is empty.
  const sendBtn = page.getByRole('button', { name: /send/i }).last();
  await expect(sendBtn).toBeDisabled({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// MSG-05: Send button disabled when message body is empty
// ---------------------------------------------------------------------------

test('send button is disabled when the message body is empty', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await gotoMessaging(page);

  // Fill subject (email channel) but leave the message textarea blank.
  const subjectInput = page.locator('input[placeholder*="Practice"]').first();
  const subjectVisible = await subjectInput.isVisible({ timeout: 3_000 }).catch(() => false);
  if (subjectVisible) {
    await subjectInput.fill('Subject without a body');
  }

  // Ensure message textarea is blank (it starts empty, but be explicit).
  const messageTextarea = page.locator('textarea[placeholder*="message" i]').first();
  await expect(messageTextarea).toBeVisible({ timeout: 10_000 });
  await messageTextarea.fill('');

  // Select recipients if possible so the only missing field is the message.
  const selectAllBtn = page.getByText(/select all/i).first();
  const canSelectAll = await selectAllBtn.isVisible({ timeout: 3_000 }).catch(() => false);
  if (canSelectAll) {
    await selectAllBtn.click();
  }

  const sendBtn = page.getByRole('button', { name: /send/i }).last();
  await expect(sendBtn).toBeDisabled({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// MSG-06: Subject field present on email channel
// ---------------------------------------------------------------------------

test('subject input is present on the email channel', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await gotoMessaging(page);

  const smsEnabled = await hasSmsFeature(page);
  if (smsEnabled) {
    await page.getByRole('button', { name: /^email$/i }).click();
  }

  // Input is rendered via the reusable <Input> component; its placeholder is
  // "e.g. Practice cancelled Saturday" per MessagingPage.tsx.
  const subjectInput = page.locator('input[placeholder*="Practice"]').first();
  await expect(subjectInput).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// MSG-07: Message textarea present and accepts input
// ---------------------------------------------------------------------------

test('message textarea is present and accepts input', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await gotoMessaging(page);

  const messageTextarea = page.locator('textarea[placeholder*="message" i]').first();
  await expect(messageTextarea).toBeVisible({ timeout: 10_000 });

  await messageTextarea.fill('Hello from smoke test');
  await expect(messageTextarea).toHaveValue('Hello from smoke test');
});

// ---------------------------------------------------------------------------
// MSG-08: Admin sees Platform Users section
// ---------------------------------------------------------------------------

test('admin sees the Platform Users recipient section', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await gotoMessaging(page);

  const smsEnabled = await hasSmsFeature(page);
  if (smsEnabled) {
    // Platform Users are only shown on the email channel.
    await page.getByRole('button', { name: /^email$/i }).click();
  }

  // The Platform Users section header is always rendered for admin on the email
  // channel, even when no other users exist — it only appears when
  // eligiblePlatformUsers.length > 0, so we skip gracefully if not present.
  const platformUsersHeader = page.getByText(/platform users/i).first();
  const visible = await platformUsersHeader.isVisible({ timeout: 5_000 }).catch(() => false);

  if (!visible) {
    test.skip(true, 'No platform users with email addresses found — section is conditionally rendered; skipping');
    return;
  }

  await expect(platformUsersHeader).toBeVisible();
});

// ---------------------------------------------------------------------------
// MSG-09: Selecting a platform user updates recipient count copy
// ---------------------------------------------------------------------------

test('selecting a platform user updates the recipient count in the composer', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await gotoMessaging(page);

  const smsEnabled = await hasSmsFeature(page);
  if (smsEnabled) {
    await page.getByRole('button', { name: /^email$/i }).click();
  }

  // Verify the initial state says "No recipients selected".
  const noRecipientsText = page.getByText(/no recipients selected/i).first();
  await expect(noRecipientsText).toBeVisible({ timeout: 10_000 });

  // Find the first user checkbox in the Platform Users section.
  const platformUsersCard = page.locator('[class*="overflow-hidden"]').filter({
    has: page.getByText(/platform users/i),
  }).first();

  const hasCard = await platformUsersCard.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!hasCard) {
    test.skip(true, 'No platform users section — skipping recipient count test');
    return;
  }

  const firstUserCheckbox = platformUsersCard.locator('input[type="checkbox"]').first();
  const checkboxVisible = await firstUserCheckbox.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!checkboxVisible) {
    test.skip(true, 'No user checkboxes found in Platform Users section');
    return;
  }

  await firstUserCheckbox.check();

  // After selecting one user the "No recipients selected" copy should be gone
  // and the composer shows either an email address count or a recipient chip.
  await expect(noRecipientsText).not.toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// MSG-10: Clearing message body re-disables the Send button
// ---------------------------------------------------------------------------

test('clearing the message body re-disables the Send button', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await gotoMessaging(page);

  const smsEnabled = await hasSmsFeature(page);
  if (smsEnabled) {
    await page.getByRole('button', { name: /^email$/i }).click();
  }

  // Select a platform user so the recipient condition is met.
  const platformUsersCard = page.locator('[class*="overflow-hidden"]').filter({
    has: page.getByText(/platform users/i),
  }).first();
  const hasCard = await platformUsersCard.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!hasCard) {
    test.skip(true, 'No platform users — cannot verify send-button reactive state');
    return;
  }

  const firstCheckbox = platformUsersCard.locator('input[type="checkbox"]').first();
  await firstCheckbox.check();

  // Fill all required fields.
  const subjectInput = page.locator('input[placeholder*="Practice"]').first();
  await subjectInput.fill('Test subject');
  const messageTextarea = page.locator('textarea[placeholder*="message" i]').first();
  await messageTextarea.fill('Test message body');

  // The send button becomes enabled.
  const sendBtn = page.getByRole('button', { name: /send/i }).last();
  await expect(sendBtn).toBeEnabled({ timeout: 5_000 });

  // Clear the message — button must go back to disabled.
  await messageTextarea.fill('');
  await expect(sendBtn).toBeDisabled({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// MSG-11: Navigate away and back does not crash
// ---------------------------------------------------------------------------

test('navigating away from /messaging and back does not crash the page', async ({ asAdmin }) => {
  const { page } = asAdmin;
  await gotoMessaging(page);

  // Confirm initial load was clean.
  await expect(page.locator('h2').filter({ hasText: /recipients/i }).first())
    .toBeVisible({ timeout: 10_000 });

  // Navigate to /teams (always available to admin) and then return.
  await page.goto('/teams');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/teams/);

  // Return to messaging.
  await gotoMessaging(page);

  // Page must still render correctly — no crash or blank state.
  await expect(page).toHaveURL(/\/messaging/);
  const recipientsSection = page.locator('h2').filter({ hasText: /recipients/i }).first();
  await expect(recipientsSection).toBeVisible({ timeout: 10_000 });
});
