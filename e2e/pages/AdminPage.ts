import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * AdminPage — wraps admin flows: team management, player management,
 * invite management, and schedule publishing.
 *
 * Assumes the user is already authenticated as admin before calling
 * any method.
 */
export class AdminPage {
  readonly page: Page;

  // Nav / shell
  readonly teamsNavLink: Locator;

  // Teams list page
  readonly newTeamButton: Locator;
  readonly teamCards: Locator;

  // Team form modal
  readonly teamNameInput: Locator;
  readonly saveTeamButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.teamsNavLink = page.getByRole('link', { name: /teams/i });
    this.newTeamButton = page.getByRole('button', { name: /new team/i });
    this.teamCards = page.locator('[data-testid="team-card"]');

    this.teamNameInput = page.getByLabel('Team Name');
    this.saveTeamButton = page.getByRole('button', { name: /save|create team/i });
  }

  async gotoTeams() {
    await this.page.goto('/teams');
    await this.page.waitForLoadState('domcontentloaded');
  }

  async gotoTeam(teamId: string) {
    await this.page.goto(`/teams/${teamId}`);
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Opens the New Team modal and fills the minimum required fields.
   * Returns once the modal closes (team saved).
   */
  async createTeam(opts: { name: string; sport?: string }) {
    await this.gotoTeams();
    await this.newTeamButton.click();

    // Wait for modal
    const modal = this.page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    await modal.getByLabel('Team Name').fill(opts.name);

    if (opts.sport) {
      await modal.getByLabel('Sport').selectOption({ label: opts.sport });
    }

    // Save — label varies ("Save" for edit, "Create Team" for new)
    const saveBtn = modal.getByRole('button', { name: /save|create team/i });
    await saveBtn.click();

    // Modal should close — createTeamAndBecomeCoach CF can take 15-20s on cold start in CI
    await expect(modal).not.toBeVisible({ timeout: 30_000 });
  }

  /**
   * Navigates to a team's detail page and opens the Add Player form.
   * Fills first+last name and parent email, then submits.
   */
  async addPlayer(opts: {
    teamId: string;
    firstName: string;
    lastName: string;
    parentEmail: string;
  }) {
    await this.gotoTeam(opts.teamId);

    // Switch to Roster tab
    await this.page.getByRole('tab', { name: /roster/i }).click();

    // Click Add Player button
    const addPlayerBtn = this.page.getByRole('button', { name: /add player/i });
    await addPlayerBtn.click();

    const modal = this.page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    await modal.getByLabel('First Name').fill(opts.firstName);
    await modal.getByLabel('Last Name').fill(opts.lastName);

    // Parent email field — label varies by form; try both likely labels
    const parentEmailInput = modal.getByLabel(/parent.*email|invite.*email|email/i).first();
    await parentEmailInput.fill(opts.parentEmail);

    const saveBtn = modal.getByRole('button', { name: /save|add player/i });
    await saveBtn.click();

    await expect(modal).not.toBeVisible({ timeout: 10_000 });
  }

  /**
   * On the Invites tab, revokes the invite for the given email address.
   */
  async revokeInvite(teamId: string, parentEmail: string) {
    await this.gotoTeam(teamId);

    await this.page.getByRole('tab', { name: /invites/i }).click();

    // Find the row for this email and click Revoke
    const inviteRow = this.page.locator('[data-testid="invite-row"]', { hasText: parentEmail });
    await expect(inviteRow).toBeVisible({ timeout: 10_000 });

    const revokeBtn = inviteRow.getByRole('button', { name: /revoke/i });
    await revokeBtn.click();

    // Confirm dialog if present
    const confirmBtn = this.page.getByRole('button', { name: /confirm|yes|revoke/i }).last();
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click();
    }

    // Row should disappear
    await expect(inviteRow).not.toBeVisible({ timeout: 10_000 });
  }

  /**
   * Publishes the schedule from the Schedule tab (ScheduleWizardModal).
   * Assumes at least one draft schedule exists.
   */
  async publishSchedule(teamId: string) {
    await this.gotoTeam(teamId);

    // Schedule tab should be active by default, but click to be safe
    await this.page.getByRole('tab', { name: /schedule/i }).click();

    const publishBtn = this.page.getByRole('button', { name: /publish/i });
    await expect(publishBtn).toBeVisible({ timeout: 5_000 });
    await publishBtn.click();

    // Confirm dialog
    const confirmBtn = this.page.getByRole('button', { name: /publish|confirm/i }).last();
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click();
    }
  }

  /**
   * Asserts that an invite appears in the Invites tab.
   */
  async expectInviteVisible(teamId: string, parentEmail: string) {
    await this.gotoTeam(teamId);
    await this.page.getByRole('tab', { name: /invites/i }).click();
    await expect(this.page.locator('[data-testid="invite-row"]', { hasText: parentEmail }))
      .toBeVisible({ timeout: 10_000 });
  }

  /**
   * Asserts that an invite is NOT visible in the Invites tab.
   */
  async expectInviteGone(teamId: string, parentEmail: string) {
    await this.gotoTeam(teamId);
    await this.page.getByRole('tab', { name: /invites/i }).click();
    await expect(this.page.locator('[data-testid="invite-row"]', { hasText: parentEmail }))
      .not.toBeVisible({ timeout: 10_000 });
  }
}
