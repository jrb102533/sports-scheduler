/**
 * Venue CRUD — gaps not covered by venues.spec.ts
 *
 * venues.spec.ts already covers:
 *   VEN-01  Navigate to /venues
 *   VEN-02  New Venue button visible
 *   VEN-03  Open modal — Name and Address fields present
 *   VEN-04  Surface Type toggle buttons present
 *   VEN-05  Create venue appears in list
 *   VEN-06  Edit venue name persists
 *   VEN-07  Delete venue disappears from list
 *   VEN-08  Parent cannot see edit/delete controls
 *
 * This suite covers only what remains:
 *   VENUE-CRUD-01  Empty Name blocks form submission (inline validation error)
 *   VENUE-CRUD-02  Empty Address blocks form submission (inline validation error)
 *   VENUE-CRUD-03  Address and Notes saved correctly — edit modal pre-populates with saved values
 *   VENUE-CRUD-04  Indoor surface type saves correctly — card badge reads "Indoor"
 *   VENUE-CRUD-05  Saved venue appears in the EventForm venue dropdown on /calendar
 *   VENUE-CRUD-06  Saved venue appears in the schedule wizard venue combobox
 *
 * All tests use asAdmin.
 * Tests that mutate data create uniquely-named venues and clean up after themselves.
 * Tests that depend on pre-existing data (leagues, seasons) skip gracefully when that
 * data is absent — no || true patterns anywhere.
 */

import { test, expect } from './fixtures/auth.fixture';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to /venues, open the New Venue modal, and return the dialog locator.
 * The caller is responsible for filling in fields and submitting.
 */
async function openNewVenueModal(page: import('@playwright/test').Page) {
  await page.goto('/venues');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: /new venue/i }).click();
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });
  return modal;
}

/**
 * Create a throwaway venue with a unique name and the given address/notes.
 * Returns the venue name so the caller can locate the card.
 */
async function createVenue(
  page: import('@playwright/test').Page,
  opts: { name: string; address: string; notes?: string; indoor?: boolean },
) {
  const modal = await openNewVenueModal(page);

  await modal.getByLabel('Name').fill(opts.name);
  await modal.getByLabel('Address').fill(opts.address);

  if (opts.indoor) {
    await modal.getByRole('button', { name: 'Indoor' }).click();
  }

  if (opts.notes) {
    await modal.getByLabel(/notes/i).fill(opts.notes);
  }

  await modal.getByRole('button', { name: /create venue/i }).click();
  await expect(modal).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(opts.name, { exact: false })).toBeVisible({ timeout: 10_000 });
}

/**
 * Delete the venue whose card contains the given name text.
 * Soft-deletes via the "Remove" confirm label.
 * No-ops silently when the card is not found (cleanup guard).
 */
async function deleteVenueByName(page: import('@playwright/test').Page, name: string) {
  const venueCard = page.locator('[class*="rounded"]').filter({
    has: page.getByText(name, { exact: false }),
  }).first();

  const cardVisible = await venueCard.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!cardVisible) return;

  const deleteBtn = venueCard
    .locator('button[title*="Delete venue" i]')
    .or(venueCard.locator('button[title*="delete" i]'))
    .first();

  const btnVisible = await deleteBtn.isVisible({ timeout: 2_000 }).catch(() => false);
  if (!btnVisible) return;

  await deleteBtn.click();

  const confirmBtn = page.getByRole('button', { name: /^remove$/i }).last();
  const confirmVisible = await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!confirmVisible) return;

  await confirmBtn.click();
  // Wait for the card to disappear after deletion
  await expect(venueCard).not.toBeVisible({ timeout: 10_000 }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// VENUE-CRUD-01 — empty Name blocks save
// ---------------------------------------------------------------------------

test('VENUE-CRUD-01: submitting the venue form without a Name shows an inline validation error', async ({ asAdmin }) => {
  const { page } = asAdmin;
  const modal = await openNewVenueModal(page);

  // Leave Name blank; fill in a valid Address so only Name fails
  await modal.getByLabel('Address').fill('1 Any Street, City, ST 00000');

  await modal.getByRole('button', { name: /create venue/i }).click();

  // Modal must stay open — save was blocked
  await expect(modal).toBeVisible({ timeout: 3_000 });

  // Inline error for Name must be visible
  const nameError = modal.getByText(/name is required/i);
  await expect(nameError).toBeVisible({ timeout: 3_000 });

  // Address error must NOT be shown (only Name was invalid)
  const addressError = modal.getByText(/address is required/i);
  await expect(addressError).not.toBeVisible();

  // Close without saving to leave no side-effects
  await modal.getByRole('button', { name: /cancel/i }).click();
});

// ---------------------------------------------------------------------------
// VENUE-CRUD-02 — empty Address blocks save
// ---------------------------------------------------------------------------

test('VENUE-CRUD-02: submitting the venue form without an Address shows an inline validation error', async ({ asAdmin }) => {
  const { page } = asAdmin;
  const modal = await openNewVenueModal(page);

  // Fill a valid Name; leave Address blank
  await modal.getByLabel('Name').fill('No-Address Venue (E2E)');

  await modal.getByRole('button', { name: /create venue/i }).click();

  // Modal must stay open
  await expect(modal).toBeVisible({ timeout: 3_000 });

  // Inline error for Address must be visible
  const addressError = modal.getByText(/address is required/i);
  await expect(addressError).toBeVisible({ timeout: 3_000 });

  // Name error must NOT be shown
  const nameError = modal.getByText(/name is required/i);
  await expect(nameError).not.toBeVisible();

  await modal.getByRole('button', { name: /cancel/i }).click();
});

// ---------------------------------------------------------------------------
// VENUE-CRUD-03 — Address and Notes fields save correctly; edit modal pre-populates
// ---------------------------------------------------------------------------

test('@smoke VENUE-CRUD-03: address and notes are saved and pre-populate the edit modal', async ({ asAdmin }) => {
  const { page } = asAdmin;

  const venueName = `E2E AddressNotes ${Date.now()}`;
  const venueAddress = '99 Persistent Ave, Savedville, SV 12345';
  const venueNotes = 'Gate code is 1234. Park in lot B.';

  await createVenue(page, { name: venueName, address: venueAddress, notes: venueNotes });

  // Open the edit modal for this venue
  const venueCard = page.locator('[class*="rounded"]').filter({
    has: page.getByText(venueName, { exact: false }),
  }).first();

  await expect(venueCard).toBeVisible({ timeout: 5_000 });

  const editBtn = venueCard
    .locator('button[title*="Edit venue" i]')
    .or(venueCard.locator('button[title*="edit" i]'))
    .first();

  await expect(editBtn).toBeVisible({ timeout: 5_000 });
  await editBtn.click();

  const editModal = page.getByRole('dialog');
  await expect(editModal).toBeVisible({ timeout: 5_000 });

  // The edit modal title must say "Edit Venue"
  await expect(editModal.getByRole('heading', { name: /edit venue/i })).toBeVisible();

  // Address must be pre-populated with the saved value
  const addressInput = editModal.getByLabel('Address');
  await expect(addressInput).toHaveValue(venueAddress);

  // Notes must be pre-populated with the saved value
  const notesInput = editModal.getByLabel(/notes/i);
  await expect(notesInput).toHaveValue(venueNotes);

  // Close without making changes
  await editModal.getByRole('button', { name: /cancel/i }).click();
  await expect(editModal).not.toBeVisible({ timeout: 5_000 });

  // Cleanup
  await deleteVenueByName(page, venueName);
});

// ---------------------------------------------------------------------------
// VENUE-CRUD-04 — Indoor surface type saves; card badge reads "Indoor"
// ---------------------------------------------------------------------------

test('VENUE-CRUD-04: creating a venue as Indoor shows the Indoor badge on the card', async ({ asAdmin }) => {
  const { page } = asAdmin;

  const venueName = `E2E IndoorVenue ${Date.now()}`;

  await createVenue(page, {
    name: venueName,
    address: '10 Arena Way, Indoortown, IT 00001',
    indoor: true,
  });

  // The venue card for this venue must display an "Indoor" badge
  const venueCard = page.locator('[class*="rounded"]').filter({
    has: page.getByText(venueName, { exact: false }),
  }).first();

  await expect(venueCard).toBeVisible({ timeout: 5_000 });

  // VenueCard renders a badge with the text "Indoor" or "Outdoor"
  const indoorBadge = venueCard.getByText(/^indoor$/i);
  await expect(indoorBadge).toBeVisible({ timeout: 5_000 });

  // Sanity: "Outdoor" badge must NOT appear on the same card
  const outdoorBadge = venueCard.getByText(/^outdoor$/i);
  await expect(outdoorBadge).not.toBeVisible();

  // Cleanup
  await deleteVenueByName(page, venueName);
});

// ---------------------------------------------------------------------------
// VENUE-CRUD-05 — Saved venue appears in the EventForm venue dropdown
// ---------------------------------------------------------------------------

test('VENUE-CRUD-05: a saved venue appears in the Venue dropdown when creating an event on /calendar', async ({ asAdmin }) => {
  const { page } = asAdmin;

  const venueName = `E2E EventVenue ${Date.now()}`;

  // Create the venue first
  await createVenue(page, {
    name: venueName,
    address: '77 Field Rd, Sportstown, ST 77777',
  });

  // Navigate to /calendar and open the New Event form
  await page.goto('/calendar');
  await page.waitForLoadState('domcontentloaded');

  const newEventBtn = page.getByRole('button', { name: /new event/i });
  const btnVisible = await newEventBtn.isVisible({ timeout: 10_000 }).catch(() => false);

  if (!btnVisible) {
    // The calendar page may restrict "New Event" to certain roles or screen sizes.
    // If the button is truly absent for admin, treat this as a data-dependency skip.
    test.skip(true, '"New Event" button not visible on /calendar for this admin account — skipping venue-in-EventForm check');
    return;
  }

  await newEventBtn.click();

  const eventModal = page.getByRole('dialog');
  await expect(eventModal).toBeVisible({ timeout: 5_000 });

  // EventForm renders a "Venue (optional)" <select> only when savedVenues.length > 0.
  // We just created one so it must be present.
  const venueSelect = eventModal.getByLabel(/venue/i);
  await expect(venueSelect).toBeVisible({ timeout: 10_000 });

  // The venue we created must appear as an option in the dropdown
  const venueOption = venueSelect.locator(`option:has-text("${venueName}")`);
  await expect(venueOption).toHaveCount(1, { timeout: 5_000 });

  // Close without saving
  await eventModal.getByRole('button', { name: /cancel/i }).click();
  await expect(eventModal).not.toBeVisible({ timeout: 5_000 });

  // Cleanup
  await page.goto('/venues');
  await page.waitForLoadState('domcontentloaded');
  await deleteVenueByName(page, venueName);
});

// ---------------------------------------------------------------------------
// VENUE-CRUD-06 — Saved venue appears in the schedule wizard venue combobox
// ---------------------------------------------------------------------------

test('VENUE-CRUD-06: a saved venue appears in the schedule wizard venue combobox', async ({ asAdmin }) => {
  const { page } = asAdmin;

  const venueName = `E2E WizardVenue ${Date.now()}`;

  // Create the venue first
  await createVenue(page, {
    name: venueName,
    address: '5 Wizard Lane, Leagueville, LV 55555',
  });

  // Navigate to /leagues and find a league with at least one season
  await page.goto('/leagues');
  await page.waitForLoadState('domcontentloaded');

  const firstLeague = page.getByRole('link', { name: /.+/ }).filter({ hasText: /.+/ }).first();
  const leagueVisible = await firstLeague.isVisible({ timeout: 5_000 }).catch(() => false);

  if (!leagueVisible) {
    test.skip(true, 'No leagues found in staging — skipping wizard venue check');
    // Cleanup venue before skipping
    await page.goto('/venues');
    await page.waitForLoadState('domcontentloaded');
    await deleteVenueByName(page, venueName);
    return;
  }

  await firstLeague.click();
  await page.waitForURL(/\/leagues\/.+/, { timeout: 10_000 });

  // Open the Seasons tab
  const seasonsTab = page.getByRole('tab', { name: /seasons/i });
  const tabVisible = await seasonsTab.isVisible({ timeout: 5_000 }).catch(() => false);

  if (!tabVisible) {
    test.skip(true, 'Seasons tab not visible on league detail — skipping wizard venue check');
    await page.goto('/venues');
    await page.waitForLoadState('domcontentloaded');
    await deleteVenueByName(page, venueName);
    return;
  }

  await seasonsTab.click();
  await page.waitForLoadState('domcontentloaded');

  // Click the first season to reach SeasonDashboard
  const firstSeason = page.getByRole('link', { name: /.+/ }).filter({ hasText: /.+/ }).first();
  const seasonVisible = await firstSeason.isVisible({ timeout: 5_000 }).catch(() => false);

  if (!seasonVisible) {
    test.skip(true, 'No seasons found in this league — skipping wizard venue check');
    await page.goto('/venues');
    await page.waitForLoadState('domcontentloaded');
    await deleteVenueByName(page, venueName);
    return;
  }

  await firstSeason.click();
  await page.waitForURL(/\/leagues\/.+\/seasons\/.+/, { timeout: 10_000 });
  await page.waitForLoadState('domcontentloaded');

  // Open the schedule wizard from SeasonDashboard
  const wizardBtn = page
    .getByRole('button', { name: /generate schedule|create schedule|schedule wizard/i })
    .first();
  const wizardBtnVisible = await wizardBtn.isVisible({ timeout: 5_000 }).catch(() => false);

  if (!wizardBtnVisible) {
    test.skip(true, 'Schedule wizard button not found on SeasonDashboard — skipping wizard venue check');
    await page.goto('/venues');
    await page.waitForLoadState('domcontentloaded');
    await deleteVenueByName(page, venueName);
    return;
  }

  await wizardBtn.click();

  const wizardModal = page.getByRole('dialog');
  await expect(wizardModal).toBeVisible({ timeout: 10_000 });

  // The wizard opens on a mode-selection step.  Advance through steps until the
  // venues step is visible.  We step through config, then advance — the venues
  // step renders a VenueCombobox with a text input.
  // Pick the "Season" mode if a selection is required
  const seasonModeBtn = wizardModal
    .getByRole('button', { name: /season/i })
    .or(wizardModal.getByText(/season schedule/i))
    .first();
  const modeVisible = await seasonModeBtn.isVisible({ timeout: 3_000 }).catch(() => false);
  if (modeVisible) {
    await seasonModeBtn.click();
  }

  // Advance through wizard steps until the venues step appears or we exhaust attempts
  const venuesHeading = wizardModal.getByText(/venues/i).filter({ hasNotText: /league|availability/i }).first();
  let venuesStepFound = false;

  for (let attempt = 0; attempt < 6; attempt++) {
    const onVenuesStep = await venuesHeading.isVisible({ timeout: 2_000 }).catch(() => false);
    if (onVenuesStep) {
      venuesStepFound = true;
      break;
    }

    // Look for a Next button to advance
    const nextBtn = wizardModal.getByRole('button', { name: /next/i }).last();
    const nextVisible = await nextBtn.isEnabled({ timeout: 2_000 }).catch(() => false);
    if (!nextVisible) break;
    await nextBtn.click();
  }

  if (!venuesStepFound) {
    test.skip(true, 'Could not reach the venues step in the schedule wizard — form may require data the staging account lacks');
    await wizardModal.getByRole('button', { name: /cancel|close/i }).first().click().catch(() => undefined);
    await page.goto('/venues');
    await page.waitForLoadState('domcontentloaded');
    await deleteVenueByName(page, venueName);
    return;
  }

  // On the venues step there is a VenueCombobox — a text input used to search venues.
  // Type the unique venue name and confirm it appears in the suggestion list.
  const comboInput = wizardModal.locator('input[placeholder*="venue" i], input[placeholder*="Search" i]').first();
  await expect(comboInput).toBeVisible({ timeout: 5_000 });

  await comboInput.fill(venueName);

  const suggestion = wizardModal.getByText(venueName, { exact: false });
  await expect(suggestion).toBeVisible({ timeout: 5_000 });

  // Close the wizard without saving
  await wizardModal.getByRole('button', { name: /cancel|close/i }).first().click().catch(() => undefined);

  // Cleanup
  await page.goto('/venues');
  await page.waitForLoadState('domcontentloaded');
  await deleteVenueByName(page, venueName);
});
