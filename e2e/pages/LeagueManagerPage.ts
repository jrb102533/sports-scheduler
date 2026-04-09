import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * LeagueManagerPage — wraps the LM home experience and league management flows.
 *
 * League managers land on `/` (HomePage) after login, not `/parent`.
 * The HomePage renders a "My Teams" section with team cards for all teams
 * in the LM's league, plus an "Upcoming Events" section.
 *
 * Assumes the user is already authenticated as a league manager before
 * calling any method.
 */
export class LeagueManagerPage {
  readonly page: Page;

  // ── HomePage (/home or /) ────────────────────────────────────────────────

  /** Section heading "My Teams" — present on the home page for non-admin users */
  readonly myTeamsHeading: Locator;

  /** Team cards rendered inside the "My Teams" grid */
  readonly teamCards: Locator;

  /** "League Manager" role badge inside a team card */
  readonly leagueManagerBadge: Locator;

  /** "Upcoming Events" section heading */
  readonly upcomingEventsHeading: Locator;

  /** Empty state message when there are no teams yet */
  readonly noTeamsMessage: Locator;

  /** Empty state message when there are no upcoming events */
  readonly noEventsMessage: Locator;

  // ── Sidebar nav ─────────────────────────────────────────────────────────

  /** "Leagues" link in the sidebar nav — visible to LMs */
  readonly leaguesNavLink: Locator;

  /** "Manage Users" link — admin-only; must NOT appear for LMs */
  readonly manageUsersNavLink: Locator;

  // ── /leagues page ────────────────────────────────────────────────────────

  /** "New League" button — visible to LMs (canCreateLeague = true) */
  readonly newLeagueButton: Locator;

  /** League cards on the /leagues list page */
  readonly leagueCards: Locator;

  constructor(page: Page) {
    this.page = page;

    // HomePage
    this.myTeamsHeading = page.getByRole('heading', { name: /my teams/i });
    this.teamCards = page.locator('button').filter({ has: page.locator('span.rounded-full') });
    this.leagueManagerBadge = page.getByText('League Manager').first();
    this.upcomingEventsHeading = page.getByRole('heading', { name: /upcoming events/i });
    this.noTeamsMessage = page.getByText(/you have no teams yet/i);
    this.noEventsMessage = page.getByText(/no upcoming events scheduled/i);

    // Sidebar
    this.leaguesNavLink = page.getByRole('link', { name: /^leagues$/i });
    this.manageUsersNavLink = page.getByRole('link', { name: /manage users/i });

    // /leagues page
    this.newLeagueButton = page.getByRole('button', { name: /new league/i });
    this.leagueCards = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator('h3'),
    });
  }

  /** Navigate to the home page and wait for it to settle. */
  async goto() {
    await this.page.goto('/');
    await this.page.waitForLoadState('domcontentloaded');
  }

  /** Navigate to /leagues and wait for the page to settle. */
  async gotoLeagues() {
    await this.page.goto('/leagues');
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Assert that the named league is visible on the /leagues list page.
   * Assumes the caller is already on /leagues.
   */
  async expectLeagueVisible(leagueName: string) {
    await expect(
      this.page.getByText(leagueName, { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
  }

  /**
   * Navigate to the team detail page for the first visible team card on the
   * home page.  Returns once the /teams/:id URL is loaded.
   */
  async clickFirstTeamCard() {
    const cards = this.page.locator('button').filter({
      has: this.page.locator('span.rounded-full'),
    });
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
    await cards.first().click();
  }
}
