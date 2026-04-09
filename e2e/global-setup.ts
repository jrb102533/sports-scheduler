/**
 * Playwright global setup — authenticates each role once per CI run.
 *
 * Logs in via the real login form and saves the resulting browser storage
 * state (cookies + localStorage, including the Firebase ID token) to
 * e2e/.auth/{role}.json.
 *
 * Each role fixture in auth.fixture.ts then loads these saved states instead
 * of performing a live login, eliminating Firebase Auth rate-limiting that
 * caused ~100 cascading 15-second timeouts per run.
 *
 * IMPORTANT: e2e/.auth/ is in .gitignore — never commit these files.
 */

import path from 'path';
import fs from 'fs';
import { chromium } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const authDir = path.join(__dirname, '.auth');

interface RoleCredentials {
  role: string;
  emailVar: string;
  passwordVar: string;
}

const ROLES: RoleCredentials[] = [
  { role: 'admin', emailVar: 'E2E_ADMIN_EMAIL', passwordVar: 'E2E_ADMIN_PASSWORD' },
  { role: 'parent', emailVar: 'E2E_PARENT_EMAIL', passwordVar: 'E2E_PARENT_PASSWORD' },
  { role: 'player', emailVar: 'E2E_PLAYER_EMAIL', passwordVar: 'E2E_PLAYER_PASSWORD' },
  { role: 'coach', emailVar: 'E2E_COACH_EMAIL', passwordVar: 'E2E_COACH_PASSWORD' },
  { role: 'lm', emailVar: 'E2E_LM_EMAIL', passwordVar: 'E2E_LM_PASSWORD' },
];

async function loginRole(
  email: string,
  password: string,
  statePath: string,
): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  try {
    await page.goto('/login');

    // Fill in credentials
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password').first().fill(password);
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Wait for the authenticated shell to confirm login succeeded
    await page.getByText('First Whistle').first().waitFor({
      state: 'visible',
      timeout: 30_000,
    });

    // Persist the session
    await context.storageState({ path: statePath });
  } finally {
    await context.close();
    await browser.close();
  }
}

async function globalSetup(): Promise<void> {
  // Ensure the .auth directory exists
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  for (const { role, emailVar, passwordVar } of ROLES) {
    const email = process.env[emailVar];
    const password = process.env[passwordVar];

    if (!email || !password) {
      // Missing creds for this role — skip (tests that need it will skip themselves)
      console.warn(
        `[global-setup] Skipping ${role}: ${emailVar} or ${passwordVar} not set.`,
      );
      continue;
    }

    const statePath = path.join(authDir, `${role}.json`);
    console.log(`[global-setup] Logging in as ${role} (${email})...`);

    try {
      await loginRole(email, password, statePath);
      console.log(`[global-setup] ${role}: storageState saved to ${statePath}`);
    } catch (err) {
      console.error(`[global-setup] ${role}: login failed —`, err);
      // Rethrow so CI fails loudly rather than silently producing bad state files
      throw err;
    }
  }
}

export default globalSetup;
