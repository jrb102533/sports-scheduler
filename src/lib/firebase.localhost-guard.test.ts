/**
 * firebase.ts — localhost guard unit tests
 *
 * The guard throws at module evaluation time when:
 *   _isLocalhost=true AND VITE_USE_EMULATOR !== 'true' AND VITE_ALLOW_LOCAL_STAGING !== 'true'
 *
 * Because firebase.ts is normally fully mocked in all consuming test files
 * (vi.mock('@/lib/firebase', ...)), those tests never exercise the guard code.
 * This file tests the guard directly by:
 *   1. Mocking all Firebase SDK packages so initializeApp / getAuth / etc. don't throw
 *   2. Controlling window.location.hostname via Object.defineProperty
 *   3. Controlling import.meta.env values via direct mutation
 *   4. Using vi.resetModules() + dynamic import so the module re-evaluates each time
 *
 * NOTE: src/lib/firebase.ts is excluded from the coverage report
 * (vitest.config.ts: coverage.exclude). The guard itself is pure boolean logic —
 * keeping it simple and reviewable is more valuable than coverage numbers.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';

// ── Stub every Firebase SDK the module imports ─────────────────────────────────
// These mocks are hoisted (vi.mock is hoisted by Vitest's transform), so they
// run before firebase.ts evaluates even on a dynamic import.

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  connectAuthEmulator: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  connectFirestoreEmulator: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  connectFunctionsEmulator: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(() => ({})),
  connectStorageEmulator: vi.fn(),
}));

vi.mock('./firestoreReadCounter', () => ({
  installReadCounter: vi.fn(),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Overwrite window.location.hostname for the duration of a test.
 * jsdom defines location as non-configurable on the window prototype, so we
 * replace the whole property with a plain object containing our hostname.
 */
function setHostname(hostname: string): void {
  Object.defineProperty(window, 'location', {
    value: { hostname },
    writable: true,
    configurable: true,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('firebase.ts — localhost guard', () => {
  afterEach(() => {
    vi.resetModules();
    // Restore env vars mutated during the test
    delete (import.meta.env as Record<string, unknown>).VITE_USE_EMULATOR;
    delete (import.meta.env as Record<string, unknown>).VITE_ALLOW_LOCAL_STAGING;
  });

  it('throws when running on localhost with no bypass env vars set', async () => {
    setHostname('localhost');
    // Neither VITE_USE_EMULATOR nor VITE_ALLOW_LOCAL_STAGING is set
    delete (import.meta.env as Record<string, unknown>).VITE_USE_EMULATOR;
    delete (import.meta.env as Record<string, unknown>).VITE_ALLOW_LOCAL_STAGING;

    await expect(import('@/lib/firebase')).rejects.toThrow(
      '[firebase] Refusing to connect to remote Firebase from localhost.'
    );
  });

  it('throws when VITE_USE_EMULATOR is explicitly false on localhost', async () => {
    setHostname('localhost');
    (import.meta.env as Record<string, unknown>).VITE_USE_EMULATOR = 'false';
    delete (import.meta.env as Record<string, unknown>).VITE_ALLOW_LOCAL_STAGING;

    await expect(import('@/lib/firebase')).rejects.toThrow(
      '[firebase] Refusing to connect to remote Firebase from localhost.'
    );
  });

  it('throws when running on 127.0.0.1 with no bypass env vars set', async () => {
    setHostname('127.0.0.1');
    delete (import.meta.env as Record<string, unknown>).VITE_USE_EMULATOR;
    delete (import.meta.env as Record<string, unknown>).VITE_ALLOW_LOCAL_STAGING;

    await expect(import('@/lib/firebase')).rejects.toThrow(
      '[firebase] Refusing to connect to remote Firebase from localhost.'
    );
  });

  it('does not throw when VITE_USE_EMULATOR=true on localhost (normal dev flow)', async () => {
    setHostname('localhost');
    (import.meta.env as Record<string, unknown>).VITE_USE_EMULATOR = 'true';
    delete (import.meta.env as Record<string, unknown>).VITE_ALLOW_LOCAL_STAGING;

    await expect(import('@/lib/firebase')).resolves.toBeDefined();
  });

  it('does not throw when VITE_ALLOW_LOCAL_STAGING=true on localhost (escape hatch)', async () => {
    setHostname('localhost');
    delete (import.meta.env as Record<string, unknown>).VITE_USE_EMULATOR;
    (import.meta.env as Record<string, unknown>).VITE_ALLOW_LOCAL_STAGING = 'true';

    await expect(import('@/lib/firebase')).resolves.toBeDefined();
  });

  it('does not throw on a production hostname even without bypass vars', async () => {
    setHostname('firstwhistlesports.com');
    delete (import.meta.env as Record<string, unknown>).VITE_USE_EMULATOR;
    delete (import.meta.env as Record<string, unknown>).VITE_ALLOW_LOCAL_STAGING;

    await expect(import('@/lib/firebase')).resolves.toBeDefined();
  });

  it('does not throw on staging hostname (first-whistle-e76f4.web.app)', async () => {
    setHostname('first-whistle-e76f4.web.app');
    delete (import.meta.env as Record<string, unknown>).VITE_USE_EMULATOR;
    delete (import.meta.env as Record<string, unknown>).VITE_ALLOW_LOCAL_STAGING;

    await expect(import('@/lib/firebase')).resolves.toBeDefined();
  });
});
