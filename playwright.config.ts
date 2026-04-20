import { defineConfig, devices } from '@playwright/test';

/**
 * First Whistle — Playwright UAT configuration
 *
 * Local runs hit the Vite dev server (which itself points at the Firebase Emulator).
 * Production runs use E2E_BASE_URL=https://firstwhistlesports.com passed via env.
 *
 * Required environment variables — see e2e/README.md for full details:
 *   E2E_BASE_URL          base URL to test against (default: http://localhost:5173)
 *   E2E_ADMIN_EMAIL       admin account email
 *   E2E_ADMIN_PASSWORD    admin account password
 *   E2E_PARENT_EMAIL      parent account email (pre-linked to a team)
 *   E2E_PARENT_PASSWORD   parent account password
 *   E2E_STAGING_URL       staging base URL for banner environment check
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const stagingURL = process.env.E2E_STAGING_URL ?? 'https://staging.firstwhistlesports.com';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false, // Firebase state is shared; run serially to avoid interference
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  // 90s per test: with the storageState/IndexedDB gap, all sessions fall back to
  // live login in CI. Worst-case fixture overhead is ~37s (20s redirect wait +
  // 15s live login + navigations), leaving 53s for test assertions.
  // Previously 60s, which left only 23s headroom — too tight for slow CI.
  timeout: 90_000,

  expect: {
    timeout: 15_000,
  },

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /.*\.emu\.spec\.ts/,
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
      testIgnore: /.*\.emu\.spec\.ts/,
    },
    // Production-only project — run with: npx playwright test --project=production
    {
      name: 'production',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'https://firstwhistlesports.com',
      },
      testMatch: /.*\.prod\.spec\.ts/,
    },
    // Staging-only project — run with: npx playwright test --project=staging
    {
      name: 'staging',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: stagingURL,
      },
      testMatch: /.*\.staging\.spec\.ts/,
    },
    // Emulator project — runs @emu-tagged specs against the local Firebase
    // Emulator Suite (see firebase.json "emulators" block). No Firestore cost,
    // no network latency. CI workflow: .github/workflows/e2e-emulator.yml.
    // Local run: `npm run dev:local` then `npm run test:e2e:emulator`.
    {
      name: 'emulator',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.E2E_EMULATOR_URL ?? 'http://localhost:5173',
      },
      testMatch: /.*\.emu\.spec\.ts/,
    },
  ],

  // Spin up the Vite dev server automatically for local runs.
  // Set E2E_BASE_URL to skip this (e.g. for prod/staging runs).
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
