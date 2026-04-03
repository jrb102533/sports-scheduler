import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * AuthPage — covers /login and /signup pages.
 *
 * All selectors use accessible roles / labels so the tests survive
 * CSS class renames and layout changes.
 */
export class AuthPage {
  readonly page: Page;

  // Login form
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;

  // Signup form extras
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly termsCheckbox: Locator;
  readonly createAccountButton: Locator;

  // Shared error region
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;

    // Login
    this.emailInput = page.getByLabel('Email');
    this.passwordInput = page.getByLabel('Password').first(); // first = "Password", second = "Confirm Password" on signup
    this.signInButton = page.getByRole('button', { name: 'Sign In' });

    // Signup
    this.firstNameInput = page.getByLabel('First Name');
    this.lastNameInput = page.getByLabel('Last Name');
    this.confirmPasswordInput = page.getByLabel('Confirm Password');
    this.termsCheckbox = page.getByRole('checkbox', {
      name: /I agree to the Terms of Service and Privacy Policy/i,
    });
    this.createAccountButton = page.getByRole('button', { name: 'Create Account' });

    this.errorMessage = page.locator('.text-red-600');
  }

  async gotoLogin() {
    await this.page.goto('/login');
  }

  async gotoSignup() {
    await this.page.goto('/signup');
  }

  async login(email: string, password: string) {
    await this.gotoLogin();
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.signInButton.click();
  }

  async loginAndWaitForApp(email: string, password: string) {
    await this.login(email, password);
    // Wait for the authenticated shell — the "First Whistle" brand header appears in MainLayout
    await expect(this.page.getByText('First Whistle')).toBeVisible({ timeout: 15_000 });
  }

  async signup(opts: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    agreeToTerms?: boolean;
  }) {
    await this.gotoSignup();
    await this.firstNameInput.fill(opts.firstName);
    await this.lastNameInput.fill(opts.lastName);
    await this.emailInput.fill(opts.email);
    await this.passwordInput.fill(opts.password);
    await this.confirmPasswordInput.fill(opts.password);
    if (opts.agreeToTerms !== false) {
      await this.termsCheckbox.check();
    }
    await this.createAccountButton.click();
  }

  async expectError(text: string | RegExp) {
    await expect(this.errorMessage.filter({ hasText: text })).toBeVisible();
  }

  async expectOnLoginPage() {
    await expect(this.page).toHaveURL(/\/login/);
    await expect(this.signInButton).toBeVisible();
  }

  async expectOnSignupPage() {
    await expect(this.page).toHaveURL(/\/signup/);
    await expect(this.createAccountButton).toBeVisible();
  }
}
