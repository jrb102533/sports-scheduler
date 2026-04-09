import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * CoachPage — wraps the coach home experience and team management flows.
 *
 * Coaches land on `/` (HomePage) after login, not `/parent`.
 * The HomePage renders a "My Teams" section with team cards for teams
 * the coach is assigned to.
 *
 * Assumes the user is already authenticated as a coach before calling
 * any method.
 */
export class CoachPage {
  readonly page: Page;

  // ── HomePage (/ or /home) ────────────────────────────────────────────────

  /** Section heading "My Teams" — present on the home page for non-admin users */
  readonly myTeamsHeading: Locator;

  /** Team cards rendered inside the "My Teams" grid */
  readonly teamCards: Locator;

  /** Empty state message when there are no teams yet */
  readonly noTeamsMessage: Locator;

  /** Empty state message when there are no upcoming events */
  readonly noEventsMessage: Locator;

  // ── Sidebar nav ─────────────────────────────────────────────────────────

  /** "Teams" link in the sidebar nav — visible to coaches */
  readonly teamsNavLink: Locator;

  /** "Manage Users" link — admin-only; must NOT appear for coaches */
  readonly manageUsersNavLink: Locator;

  // ── /teams page ──────────────────────────────────────────────────────────

  /** Team list items on the /teams page */
  readonly teamListItems: Locator;

  // ── TeamDetailPage (/teams/:id) ──────────────────────────────────────────

  /** "Roster" tab button on the team detail page */
  readonly rosterTab: Locator;

  /** "Schedule" tab button on the team detail page */
  readonly scheduleTab: Locator;

  /** "Add Event" or event-creation button — visible to coaches who can edit */
  readonly addEventButton: Locator;

  constructor(page: Page) {
    this.page = page;

    // HomePage
    this.myTeamsHeading = page.getByRole('heading', { name: /my teams/i });
    this.teamCards = page.locator('button').filter({ has: page.locator('span.rounded-full') });
    this.noTeamsMessage = page.getByText(/you have no teams yet/i);
    this.noEventsMessage = page.getByText(/no upcoming events scheduled/i);

    // Sidebar
    this.teamsNavLink = page.getByRole('link', { name: /^teams$/i });
    this.manageUsersNavLink = page.getByRole('link', { name: /manage users/i });

    // /teams page
    this.teamListItems = page.locator('a[href*="/teams/"]');

    // TeamDetailPage
    this.rosterTab = page.getByRole('tab', { name: /roster/i });
    this.scheduleTab = page.getByRole('tab', { name: /schedule/i });
    this.addEventButton = page.getByRole('button', { name: /add event/i });
  }

  /** Navigate to the home page and wait for it to settle. */
  async goto() {
    await this.page.goto('/');
    await this.page.waitForLoadState('networkidle');
  }

  /** Navigate to /teams and wait for the page to settle. */
  async gotoTeams() {
    await this.page.goto('/teams');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Navigate to the team detail page for the Sharks team via the /teams list.
   * Returns once the /teams/:id URL is loaded.
   */
  async clickFirstTeamCard() {
    const cards = this.page.locator('button').filter({
      has: this.page.locator('span.rounded-full'),
    });
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
    await cards.first().click();
  }

  /**
   * On the /teams page, click the first visible team link whose text contains
   * the given name.  Returns once the /teams/:id URL is loaded.
   */
  async clickTeamByName(name: string) {
    const link = this.page.getByRole('link', { name: new RegExp(name, 'i') }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    await link.click();
    await this.page.waitForURL(/\/teams\/.+/, { timeout: 10_000 });
    await this.page.waitForLoadState('networkidle');
  }
}
