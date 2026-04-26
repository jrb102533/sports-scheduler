/**
 * useIsPro — unit tests
 *
 * Entitlement paths under test:
 *   1. Pro tier (subscriptionTier === 'league_manager_pro')
 *   2. adminGrantedLM === true
 *   3. Canceled but subscriptionExpiresAt in the future (still in paid period)
 *   4. Free / no tier — not Pro
 *   5. Canceled and expired — not Pro
 *   6. Null profile — not Pro
 *   7. Admin role short-circuits to Pro regardless of subscription fields
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { UserProfile } from '@/types';

// ── Firebase stub ─────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, functions: {} }));

// ── Auth store ────────────────────────────────────────────────────────────────
let currentProfile: UserProfile | null = null;

vi.mock('@/store/useAuthStore', async () => {
  const real = await vi.importActual<typeof import('@/store/useAuthStore')>('@/store/useAuthStore');
  const mockState = {
    get profile() { return currentProfile; },
  };
  const useAuthStore = (sel?: (s: typeof mockState) => unknown) =>
    typeof sel === 'function' ? sel(mockState) : mockState;
  useAuthStore.getState = () => mockState;
  return { ...real, useAuthStore };
});

// ── Import under test (after all mocks) ──────────────────────────────────────
import { useIsPro } from './useIsPro';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'uid-1',
    email: 'lm@example.com',
    displayName: 'League Mgr',
    role: 'league_manager',
    createdAt: '2024-01-01T00:00:00.000Z',
    memberships: [{ role: 'league_manager', leagueId: 'league-1', isPrimary: true }],
    ...overrides,
  };
}

function futureIso(daysFromNow = 30): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

function pastIso(daysAgo = 1): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(() => {
  currentProfile = null;
});

// ─────────────────────────────────────────────────────────────────────────────

describe('useIsPro — Pro entitlement paths', () => {
  it('returns true when subscriptionTier is league_manager_pro', () => {
    currentProfile = makeProfile({ subscriptionTier: 'league_manager_pro', subscriptionStatus: 'active' });
    const { result } = renderHook(() => useIsPro());
    expect(result.current).toBe(true);
  });

  it('returns true when adminGrantedLM is true regardless of subscription tier', () => {
    currentProfile = makeProfile({ subscriptionTier: 'free', adminGrantedLM: true });
    const { result } = renderHook(() => useIsPro());
    expect(result.current).toBe(true);
  });

  it('returns true when canceled but subscriptionExpiresAt is in the future', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'free',
      subscriptionStatus: 'canceled',
      subscriptionExpiresAt: futureIso(10),
    });
    const { result } = renderHook(() => useIsPro());
    expect(result.current).toBe(true);
  });

  it('returns true for an admin regardless of subscription fields', () => {
    currentProfile = makeProfile({
      role: 'admin',
      memberships: [{ role: 'admin', isPrimary: true }],
      subscriptionTier: 'free',
      subscriptionStatus: undefined,
    });
    const { result } = renderHook(() => useIsPro());
    expect(result.current).toBe(true);
  });
});

describe('useIsPro — free / non-Pro paths', () => {
  it('returns false when profile is null', () => {
    currentProfile = null;
    const { result } = renderHook(() => useIsPro());
    expect(result.current).toBe(false);
  });

  it('returns false for a free-tier user with no subscription', () => {
    currentProfile = makeProfile({ subscriptionTier: 'free', subscriptionStatus: undefined });
    const { result } = renderHook(() => useIsPro());
    expect(result.current).toBe(false);
  });

  it('returns false when canceled and subscriptionExpiresAt is in the past', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'free',
      subscriptionStatus: 'canceled',
      subscriptionExpiresAt: pastIso(1),
    });
    const { result } = renderHook(() => useIsPro());
    expect(result.current).toBe(false);
  });

  it('returns false when canceled with no subscriptionExpiresAt', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'free',
      subscriptionStatus: 'canceled',
      subscriptionExpiresAt: undefined,
    });
    const { result } = renderHook(() => useIsPro());
    expect(result.current).toBe(false);
  });
});
