import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * ScheduleWizardPage — encapsulates interactions with ScheduleWizardModal.
 *
 * This is NOT a route-level page object (the wizard is a modal that lives
 * inside other pages).  Construct it by passing the dialog Locator returned
 * by `page.getByRole('dialog')` after the wizard has been opened.
 *
 * Phase 1 multi-division additions covered here:
 *   - Named surface pills (add / remove)
 *   - "Advanced options" expander on venue cards
 *   - Division preferences section inside Advanced options
 *   - Generate-step division guard (disabled button + warning)
 *   - Preview division tab bar
 */
export class ScheduleWizardPage {
  readonly page: Page;

  /** The wizard `<dialog>` element — all locators are scoped to it. */
  readonly modal: Locator;

  constructor(page: Page) {
    this.page = page;
    this.modal = page.getByRole('dialog');
  }

  // ── Opening ──────────────────────────────────────────────────────────────────

  /** Opens the wizard from whatever button is present on the current page.
   *  Waits until the wizard modal is visible before returning.
   */
  async open(): Promise<void> {
    const wizardBtn = this.page
      .getByRole('button', {
        name: /generate schedule|open wizard|continue schedule|schedule wizard|\bwand\b/i,
      })
      .first();
    await expect(wizardBtn).toBeVisible({ timeout: 5_000 });
    await expect(wizardBtn).toBeEnabled({ timeout: 3_000 });
    await wizardBtn.click();
    await expect(this.modal).toBeVisible({ timeout: 5_000 });
  }

  // ── Mode picker ───────────────────────────────────────────────────────────────

  async selectSeasonMode(): Promise<void> {
    const btn = this.modal.getByRole('button', { name: /^Season/i });
    await expect(btn).toBeVisible({ timeout: 3_000 });
    await btn.click();
    // Config step is now active — date inputs appear
    await expect(this.modal.locator('input[type="date"]').first()).toBeVisible({
      timeout: 5_000,
    });
  }

  async cancel(): Promise<void> {
    const cancelBtn = this.modal.getByRole('button', { name: /cancel/i });
    await expect(cancelBtn).toBeVisible({ timeout: 3_000 });
    await cancelBtn.click();
    await expect(this.modal).not.toBeVisible({ timeout: 5_000 });
  }

  // ── Config step ───────────────────────────────────────────────────────────────

  /** Fills the config step with valid values and clicks Next. */
  async fillConfigAndNext(opts?: {
    startOffset?: number;
    endOffset?: number;
    matchDuration?: string;
    gamesPerTeam?: string;
  }): Promise<void> {
    const startOffset = opts?.startOffset ?? 7;
    const endOffset = opts?.endOffset ?? 90;
    const matchDuration = opts?.matchDuration ?? '60';

    const dateInputs = this.modal.locator('input[type="date"]');
    await dateInputs.first().fill(dateOffset(startOffset));
    await dateInputs.nth(1).fill(dateOffset(endOffset));

    const matchDurInput = this.modal.getByLabel(/match duration/i).first();
    await matchDurInput.fill(matchDuration);

    if (opts?.gamesPerTeam !== undefined) {
      const gamesInput = this.modal.getByLabel(/games per team/i).first();
      await gamesInput.fill(opts.gamesPerTeam);
    }

    await this.modal.getByRole('button', { name: /^next$/i }).click();
  }

  // ── Venues step ───────────────────────────────────────────────────────────────

  /** Fills in a venue name in the first venue card. */
  async fillVenueName(name: string): Promise<void> {
    await this.modal.getByLabel('Venue Name').first().fill(name);
  }

  /**
   * Returns the surface pills container for venue card at index `venueIdx`.
   * Surface pills are the blue rounded spans with × remove buttons.
   */
  surfacePillsFor(venueIdx: number): Locator {
    // Each venue card is a sibling div within the venues step container.
    // We target pills by their aria-label="Remove <name>" buttons' parent spans.
    return this.modal
      .locator('.rounded-xl.border')
      .nth(venueIdx)
      .locator('span')
      .filter({ has: this.page.locator('button[aria-label^="Remove "]') });
  }

  /** Types a surface name and clicks "Add surface" on the specified venue card. */
  async addSurface(venueIdx: number, surfaceName: string): Promise<void> {
    const card = this.modal.locator('.rounded-xl.border').nth(venueIdx);
    // The surface name text input is identified by its placeholder
    const input = card.locator('input[placeholder*="Field"], input[placeholder*="Court"]').first();
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill(surfaceName);
    await card.getByRole('button', { name: /add surface/i }).click();
  }

  /** Removes a surface pill by its name. */
  async removeSurface(surfaceName: string): Promise<void> {
    await this.modal
      .locator(`button[aria-label="Remove ${surfaceName}"]`)
      .click();
  }

  /** Asserts that no "pitch count" / "concurrent pitches" numeric input exists
   *  in the venues step (it was replaced by named surface pills). */
  async expectNoPitchCountInput(): Promise<void> {
    // In the old UI there was a numeric input labelled "Concurrent Pitches" or similar.
    await expect(
      this.modal.getByLabel(/concurrent pitch|pitch count/i)
    ).not.toBeVisible({ timeout: 3_000 });
  }

  /**
   * Asserts the validation error for 0 surfaces is visible.
   * Error text matches the validateVenues message in the component.
   */
  async expectSurfaceRequiredError(): Promise<void> {
    await expect(
      this.modal.getByText(/add at least one surface/i).first()
    ).toBeVisible({ timeout: 3_000 });
  }

  /** Clicks Next on the venues step. */
  async clickVenueNext(): Promise<void> {
    await this.modal.getByRole('button', { name: /^next$/i }).click();
  }

  // ── Advanced options ──────────────────────────────────────────────────────────

  /**
   * Expands the "Advanced options" section on the venue card at index `venueIdx`.
   * Only visible after at least 1 surface has been added (per component logic).
   */
  async expandAdvancedOptions(venueIdx: number): Promise<void> {
    const card = this.modal.locator('.rounded-xl.border').nth(venueIdx);
    const toggle = card.getByRole('button', { name: /advanced options/i });
    await expect(toggle).toBeVisible({ timeout: 5_000 });
    await toggle.click();
  }

  /**
   * Returns whether the "Division preferences" heading is visible.
   * It is only rendered when the season has 2+ divisions.
   */
  async isDivisionPreferencesSectionVisible(): Promise<boolean> {
    return this.modal
      .getByText(/division preferences/i)
      .first()
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
  }

  // ── Generate step ─────────────────────────────────────────────────────────────

  /** Returns the "Generate Schedule" button on the generate step. */
  get generateButton(): Locator {
    return this.modal.getByRole('button', { name: /generate schedule/i });
  }

  /**
   * Asserts the generate button is disabled and the division-config warning
   * is visible.  Called when some divisions have missing format/gamesPerTeam.
   */
  async expectGenerateDisabledForMissingDivisionConfig(): Promise<void> {
    await expect(this.generateButton).toBeDisabled({ timeout: 5_000 });
    await expect(
      this.modal
        .getByText(
          /missing schedule configuration|set format and games per team|some divisions are missing/i
        )
        .first()
    ).toBeVisible({ timeout: 5_000 });
  }

  // ── Preview step ──────────────────────────────────────────────────────────────

  /**
   * Returns locators for each division tab button in the preview tab bar.
   * Tabs are the per-division buttons plus "All".
   */
  get divisionTabButtons(): Locator {
    // Division tab bar is a flex row of buttons inside the preview step.
    // Identified by the border-b border-gray-200 wrapper div.
    return this.modal.locator('.border-b.border-gray-200 button');
  }

  /** Clicks the "All" division tab on the preview step. */
  async clickAllTab(): Promise<void> {
    await this.modal
      .locator('.border-b.border-gray-200 button', { hasText: /^All$/ })
      .click();
  }

  /** Returns the fixture table rows (tbody tr) in the preview step. */
  get fixtureRows(): Locator {
    return this.modal.locator('table tbody tr');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns an ISO YYYY-MM-DD date string `days` from today. */
export function dateOffset(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0]!;
}
