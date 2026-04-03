import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * ParentHomePage — wraps the /parent route.
 *
 * This page is the landing page for users with role 'parent' or 'player'.
 * It shows the team header and a list of upcoming events with RSVP buttons.
 */
export class ParentHomePage {
  readonly page: Page;

  // Team header
  readonly teamHeader: Locator;
  readonly noTeamMessage: Locator;

  // Upcoming events section
  readonly upcomingGamesHeading: Locator;
  readonly eventCards: Locator;
  readonly noEventsMessage: Locator;

  // RSVP buttons — use aria-pressed to identify state
  readonly goingButton: Locator;
  readonly notGoingButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.teamHeader = page.locator('[class*="rounded-xl"]').filter({
      has: page.locator('[class*="text-white"]'),
    }).first();
    this.noTeamMessage = page.getByText(/no team linked/i);

    this.upcomingGamesHeading = page.getByRole('heading', { name: /upcoming games/i });
    // Event cards are Cards that contain RSVP buttons
    this.eventCards = page.locator('text=RSVP:').locator('..');
    this.noEventsMessage = page.getByText(/hasn't added any games yet/i);

    // RSVP buttons — "Going" and "Not Going" within any event card
    this.goingButton = page.getByRole('button', { name: 'Going' }).first();
    this.notGoingButton = page.getByRole('button', { name: 'Not Going' }).first();
  }

  async goto() {
    await this.page.goto('/parent');
    await this.page.waitForLoadState('networkidle');
  }

  async expectTeamVisible(teamNameSubstring: string) {
    // The team name appears inside the gradient header card
    await expect(this.page.getByText(teamNameSubstring, { exact: false })).toBeVisible({ timeout: 10_000 });
  }

  async expectNoTeamLinked() {
    await expect(this.noTeamMessage).toBeVisible({ timeout: 10_000 });
  }

  /**
   * RSVPs "Going" on the first visible event and returns the event title text.
   */
  async rsvpGoingOnFirstEvent(): Promise<string> {
    await expect(this.goingButton).toBeVisible({ timeout: 10_000 });
    const eventTitle = await this.page
      .locator('.font-semibold.text-gray-900.text-sm')
      .first()
      .textContent() ?? '';

    await this.goingButton.click();

    // Button should become aria-pressed=true
    await expect(this.goingButton).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    return eventTitle.trim();
  }

  /**
   * Verifies the RSVP state persists after a full page reload.
   */
  async expectRsvpStateAfterReload(expectedState: 'yes' | 'no') {
    await this.page.reload();
    await this.page.waitForLoadState('networkidle');

    if (expectedState === 'yes') {
      await expect(this.goingButton).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    } else {
      await expect(this.notGoingButton).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    }
  }

  /**
   * Returns the number of visible event cards.
   */
  async eventCount(): Promise<number> {
    return await this.eventCards.count();
  }
}
