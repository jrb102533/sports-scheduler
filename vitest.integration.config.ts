/**
 * Vitest config for emulator-backed integration tests.
 *
 * These tests require a running Firestore emulator on 127.0.0.1:8080.
 *
 * Usage:
 *   firebase emulators:exec --only firestore --project demo-test \
 *     "npx vitest run --config vitest.integration.config.ts"
 *
 * Or with a specific file:
 *   firebase emulators:exec --only firestore --project demo-test \
 *     "npx vitest run --config vitest.integration.config.ts src/test/firestore.rules.dmCoachLed.integration.test.ts"
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.integration.test.ts'],
    // No setupFiles — integration tests boot their own emulator environment
    // and must not share the jsdom setup that mocks Firebase.
  },
});
