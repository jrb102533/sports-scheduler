import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * PlayerHomePage — wraps the /parent route when accessed as a player.
 *
 * Players share the /parent route with parents (both are permitted by RoleGuard).
 * The rendered UI is identical — the difference is that a player account IS the
 * athlete, whereas a parent account links to a child athlete via playerId.
 *
 * This page object mirrors ParentHomePage to keep test intent clear: tests in
 * player.spec.ts should read "player sees their team", not "parent sees their team".
 */
export class PlayerHomePage {
  readonly page: Page;

  // Team header
  readonly teamHeader: Locator;
  readonly noTeamMessage: Locator;

  // Upcoming events section
  readonly upcomingGamesHeading: Locator;
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
    this.noEventsMessage = page.getByText(/hasn't added any games yet/i);

    this.goingButton = page.getByRole('button', { name: 'Going' }).first();
    this.notGoingButton = page.getByRole('button', { name: 'Not Going' }).first();
  }

  async goto() {
    await this.page.goto('/parent');
    await this.page.waitForLoadState('networkidle');
  }

  async expectTeamVisible(teamNameSubstring: string) {
    await expect(
      this.page.getByText(teamNameSubstring, { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
  }

  async expectNoTeamLinked() {
    await expect(this.noTeamMessage).toBeVisible({ timeout: 10_000 });
  }

  /**
   * RSVPs "Going" on the first visible event.
   * Caller should verify events exist before calling this.
   */
  async rsvpGoingOnFirstEvent(): Promise<void> {
    await expect(this.goingButton).toBeVisible({ timeout: 10_000 });
    await this.goingButton.click();
    await expect(this.goingButton).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
  }

  /**
   * Returns true if at least one Going button is visible — used to guard
   * event-dependent tests so they skip gracefully when the test account has
   * no upcoming events.
   */
  async hasUpcomingEvents(timeoutMs = 5_000): Promise<boolean> {
    return this.goingButton.isVisible({ timeout: timeoutMs }).catch(() => false);
  }
}
