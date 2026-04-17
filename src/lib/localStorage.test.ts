/**
 * localStorage utility — pure unit tests
 *
 * Tests getItem, setItem, and removeItem with both happy-path
 * and error/edge cases (invalid JSON, storage unavailable).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getItem, setItem, removeItem } from './localStorage';

// ─── Setup ────────────────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

beforeEach(() => {
  localStorageMock.clear();
  vi.stubGlobal('localStorage', localStorageMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── getItem ─────────────────────────────────────────────────────────────────

describe('getItem', () => {
  it('returns null when the key does not exist', () => {
    expect(getItem('missing-key')).toBeNull();
  });

  it('returns the parsed value for a stored JSON string', () => {
    localStorageMock.setItem('user', JSON.stringify({ uid: 'abc' }));
    expect(getItem<{ uid: string }>('user')).toEqual({ uid: 'abc' });
  });

  it('returns a stored primitive number', () => {
    localStorageMock.setItem('count', '42');
    expect(getItem<number>('count')).toBe(42);
  });

  it('returns a stored boolean false', () => {
    localStorageMock.setItem('flag', 'false');
    expect(getItem<boolean>('flag')).toBe(false);
  });

  it('returns null (does not throw) when the stored value is invalid JSON', () => {
    localStorageMock.setItem('bad', 'not-valid-json{');
    expect(getItem('bad')).toBeNull();
  });

  it('returns null when localStorage.getItem throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    expect(getItem('key')).toBeNull();
  });
});

// ─── setItem ─────────────────────────────────────────────────────────────────

describe('setItem', () => {
  it('stores a plain object as JSON', () => {
    setItem('profile', { uid: 'xyz', role: 'coach' });
    expect(localStorageMock.getItem('profile')).toBe('{"uid":"xyz","role":"coach"}');
  });

  it('stores an array as JSON', () => {
    setItem('ids', [1, 2, 3]);
    expect(localStorageMock.getItem('ids')).toBe('[1,2,3]');
  });

  it('does not throw when localStorage.setItem throws (storage full)', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: vi.fn(),
    });
    expect(() => setItem('key', { large: true })).not.toThrow();
  });

  it('round-trips a boolean through set then get', () => {
    setItem<boolean>('active', true);
    // Use the real getItem to verify round-trip
    const raw = localStorageMock.getItem('active');
    expect(JSON.parse(raw!)).toBe(true);
  });
});

// ─── removeItem ──────────────────────────────────────────────────────────────

describe('removeItem', () => {
  it('removes a stored key', () => {
    localStorageMock.setItem('temp', '"value"');
    removeItem('temp');
    expect(localStorageMock.getItem('temp')).toBeNull();
  });

  it('does not throw when removing a key that does not exist', () => {
    expect(() => removeItem('non-existent')).not.toThrow();
  });
});
