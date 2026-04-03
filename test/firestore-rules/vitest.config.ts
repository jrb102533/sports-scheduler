import { defineConfig } from 'vitest/config';

/**
 * Separate Vitest config for Firestore security rules tests.
 *
 * These tests require:
 *   1. The Firebase emulator to be running:
 *        firebase emulators:start --only firestore
 *   2. Node environment (not jsdom) — rules-unit-testing uses Node's fetch
 *      and HTTP to talk to the emulator.
 *
 * Run with:
 *   npm run test:rules
 *
 * Or manually:
 *   npx vitest run --config test/firestore-rules/vitest.config.ts
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/firestore-rules/**/*.test.ts'],
    // Rules tests are slower (emulator round-trips) — give each file 30 s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Disable coverage for this config — rules tests are not source coverage.
    coverage: {
      enabled: false,
    },
  },
});
