import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * SeasonDashboardPage — wraps the Season Dashboard route
 * `/leagues/:leagueId/seasons/:seasonId`.
 *
 * Covers the new Phase 1 multi-division features:
 *   - DivisionScheduleSetupCard (per-division format / games / duration inputs)
 *   - "Divisions" section with Add Division button
 *   - "Open Wizard" CTA in the Generate Schedule panel
 *
 * Assumes the user is already authenticated before calling any method.
 */
export class SeasonDashboardPage {
  readonly page: Page;

  // ── Page-level elements ──────────────────────────────────────────────────────

  /** Season name heading */
  readonly seasonHeading: Locator;

  /** "Regular Season" section heading */
  readonly regularSeasonSection: Locator;

  /** "Divisions" section heading */
  readonly divisionsSection: Locator;

  /** "Add Division" button — visible to league managers */
  readonly addDivisionButton: Locator;

  /** "Open Wizard" CTA button */
  readonly openWizardButton: Locator;

  // ── DivisionScheduleSetupCard ─────────────────────────────────────────────────

  /** All DivisionScheduleSetupCard root elements on the page */
  readonly divisionSetupCards: Locator;

  constructor(page: Page) {
    this.page = page;

    this.seasonHeading = page.locator('h1').first();
    this.regularSeasonSection = page.getByRole('heading', { name: /regular season/i });
    this.divisionsSection = page.getByRole('heading', { name: /^divisions$/i });
    this.addDivisionButton = page.getByRole('button', { name: /add division/i });
    this.openWizardButton = page.getByRole('button', { name: /open wizard/i });

    // Cards are the white bordered containers rendered inside the
    // "Schedule Configuration" subsection under Divisions.
    // They each contain a Format select plus Games per team / Match duration inputs.
    this.divisionSetupCards = page.locator(
      '[aria-label*="Format for"], [aria-label*="Games per team for"], [aria-label*="Match duration"]'
    ).locator('..').locator('..').locator('..');
  }

  /** Navigate to a season dashboard by its IDs and wait for the page to settle. */
  async goto(leagueId: string, seasonId: string): Promise<void> {
    await this.page.goto(`/leagues/${leagueId}/seasons/${seasonId}`);
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Finds a DivisionScheduleSetupCard for the given division name.
   * Matches by the h4 heading inside each card.
   */
  cardForDivision(divisionName: string): Locator {
    return this.page
      .locator('h4')
      .filter({ hasText: divisionName })
      .locator('../..');
  }

  /**
   * Returns the Format select for the given division.
   * Matches the aria-label emitted by DivisionScheduleSetupCard.
   */
  formatSelectFor(divisionName: string): Locator {
    return this.page.locator(`[aria-label="Format for ${divisionName}"]`);
  }

  /**
   * Returns the "Games per team" input for the given division.
   */
  gamesInputFor(divisionName: string): Locator {
    return this.page.locator(`[aria-label="Games per team for ${divisionName}"]`);
  }

  /**
   * Returns the "Match duration in minutes" input for the given division.
   */
  durationInputFor(divisionName: string): Locator {
    return this.page.locator(
      `[aria-label="Match duration in minutes for ${divisionName}"]`
    );
  }

  /**
   * Asserts that DivisionScheduleSetupCards are NOT present on the page.
   * Used to verify non-manager roles cannot see division config.
   */
  async expectNoDivisionSetupCards(): Promise<void> {
    // The "Schedule Configuration" label is only rendered when canManage is true.
    await expect(
      this.page.getByText(/schedule configuration/i)
    ).not.toBeVisible({ timeout: 5_000 });
  }

  /**
   * Asserts the "Open Wizard" button is disabled and carries the division
   * warning text.  Used for the wizard entry guard scenario.
   */
  async expectWizardDisabledForDivisions(): Promise<void> {
    await expect(this.openWizardButton).toBeDisabled({ timeout: 5_000 });
    // The amber warning text below the CTA references missing config
    await expect(
      this.page.getByText(
        /missing schedule configuration|format and games per team|set format and games/i
      ).first()
    ).toBeVisible({ timeout: 5_000 });
  }
}
