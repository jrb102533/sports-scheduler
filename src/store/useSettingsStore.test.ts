/**
 * useSettingsStore — unit tests
 *
 * Behaviors under test:
 *   - Initial state has default settings (kidsSportsMode: false, etc.)
 *   - subscribe() starts a Firestore snapshot and merges settings from it
 *   - subscribe() does not overwrite settings if the doc does not exist
 *   - updateSettings() optimistically updates state before the Firestore write
 *   - updateSettings() is a no-op when no user is authenticated
 *   - updateSettings() merges the patch with existing settings
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firestore mock ────────────────────────────────────────────────────────────

const mockOnSnapshot = vi.fn(() => () => {});
const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn(() => ({}));

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mockDoc(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
}));

vi.mock('@/lib/firebase', () => ({
  db: {},
  auth: { currentUser: null },
}));

// ── Import store after mocks ──────────────────────────────────────────────────

import { useSettingsStore } from './useSettingsStore';

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
  useSettingsStore.setState({
    settings: { kidsSportsMode: false, hideStandingsInKidsMode: false },
  });
});

// ── Initial state ─────────────────────────────────────────────────────────────

describe('useSettingsStore — initial state', () => {
  it('has kidsSportsMode disabled by default', () => {
    expect(useSettingsStore.getState().settings.kidsSportsMode).toBe(false);
  });

  it('has hideStandingsInKidsMode disabled by default', () => {
    expect(useSettingsStore.getState().settings.hideStandingsInKidsMode).toBe(false);
  });
});

// ── subscribe() ───────────────────────────────────────────────────────────────

describe('useSettingsStore — subscribe', () => {
  it('merges settings from Firestore snapshot when doc exists', () => {
    mockOnSnapshot.mockImplementation((_ref, cb) => {
      cb({ exists: () => true, data: () => ({ kidsSportsMode: true, hideStandingsInKidsMode: true }) });
      return () => {};
    });

    useSettingsStore.getState().subscribe('uid-1');
    expect(useSettingsStore.getState().settings.kidsSportsMode).toBe(true);
    expect(useSettingsStore.getState().settings.hideStandingsInKidsMode).toBe(true);
  });

  it('does not change settings when Firestore doc does not exist', () => {
    mockOnSnapshot.mockImplementation((_ref, cb) => {
      cb({ exists: () => false });
      return () => {};
    });

    useSettingsStore.getState().subscribe('uid-1');
    expect(useSettingsStore.getState().settings.kidsSportsMode).toBe(false);
  });

  it('returns an unsubscribe function', () => {
    const unsub = vi.fn();
    mockOnSnapshot.mockReturnValue(unsub);
    const result = useSettingsStore.getState().subscribe('uid-1');
    expect(typeof result).toBe('function');
  });
});

// ── updateSettings() ──────────────────────────────────────────────────────────

describe('useSettingsStore — updateSettings', () => {
  it('is a no-op when auth.currentUser is null', async () => {
    // auth.currentUser is null in the mock
    await useSettingsStore.getState().updateSettings({ kidsSportsMode: true });
    expect(mockSetDoc).not.toHaveBeenCalled();
    // State should remain unchanged
    expect(useSettingsStore.getState().settings.kidsSportsMode).toBe(false);
  });

  it('optimistically updates state before the Firestore write completes', async () => {
    // Swap auth mock to have a user
    const { auth } = await import('@/lib/firebase');
    (auth as { currentUser: { uid: string } | null }).currentUser = { uid: 'uid-1' };

    let resolveWrite!: () => void;
    mockSetDoc.mockReturnValue(new Promise<void>(res => { resolveWrite = res; }));

    const promise = useSettingsStore.getState().updateSettings({ kidsSportsMode: true });
    // State should be updated optimistically before the write resolves
    expect(useSettingsStore.getState().settings.kidsSportsMode).toBe(true);
    resolveWrite();
    await promise;

    // Reset auth mock
    (auth as { currentUser: null }).currentUser = null;
  });

  it('merges the patch with existing settings (does not overwrite unrelated fields)', async () => {
    const { auth } = await import('@/lib/firebase');
    (auth as { currentUser: { uid: string } | null }).currentUser = { uid: 'uid-1' };

    // Start with both flags enabled
    useSettingsStore.setState({
      settings: { kidsSportsMode: true, hideStandingsInKidsMode: true },
    });

    await useSettingsStore.getState().updateSettings({ kidsSportsMode: false });

    expect(useSettingsStore.getState().settings.kidsSportsMode).toBe(false);
    // The other field should not be clobbered
    expect(useSettingsStore.getState().settings.hideStandingsInKidsMode).toBe(true);

    (auth as { currentUser: null }).currentUser = null;
  });
});
