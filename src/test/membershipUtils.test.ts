/**
 * membershipUtils — pure unit tests
 *
 * syncLegacyScalars, addMembership, removeMembership, setPrimaryMembership.
 * Covers the coach-parent case: playerId must flow through syncLegacyScalars
 * and deleteField() must be used (not undefined) for absent IDs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RoleMembership } from '@/types';

// ─── Mock firebase/firestore ──────────────────────────────────────────────────

const DELETE_SENTINEL = { __type: 'deleteField' };

vi.mock('firebase/firestore', () => ({
  deleteField: vi.fn(() => DELETE_SENTINEL),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  syncLegacyScalars,
  addMembership,
  removeMembership,
  setPrimaryMembership,
} from '@/lib/membershipUtils';

beforeEach(() => vi.clearAllMocks());

// ─── syncLegacyScalars ────────────────────────────────────────────────────────

describe('syncLegacyScalars', () => {

  it('returns deleteField sentinels for all IDs when memberships is empty', () => {
    const result = syncLegacyScalars([]);
    expect(result.role).toBe('player');
    expect(result.teamId).toBe(DELETE_SENTINEL);
    expect(result.leagueId).toBe(DELETE_SENTINEL);
    expect(result.playerId).toBe(DELETE_SENTINEL);
  });

  it('writes teamId from primary coach membership', () => {
    const memberships: RoleMembership[] = [
      { role: 'coach', teamId: 'team-1', isPrimary: true },
    ];
    const result = syncLegacyScalars(memberships);
    expect(result.role).toBe('coach');
    expect(result.teamId).toBe('team-1');
    expect(result.leagueId).toBe(DELETE_SENTINEL);
    expect(result.playerId).toBe(DELETE_SENTINEL);
  });

  it('writes playerId from primary parent membership', () => {
    const memberships: RoleMembership[] = [
      { role: 'parent', teamId: 'team-1', playerId: 'player-42', isPrimary: true },
    ];
    const result = syncLegacyScalars(memberships);
    expect(result.role).toBe('parent');
    expect(result.teamId).toBe('team-1');
    expect(result.playerId).toBe('player-42');
    expect(result.leagueId).toBe(DELETE_SENTINEL);
  });

  it('uses deleteField() for playerId when parent membership has no playerId', () => {
    const memberships: RoleMembership[] = [
      { role: 'parent', teamId: 'team-1', isPrimary: true },
    ];
    const result = syncLegacyScalars(memberships);
    expect(result.playerId).toBe(DELETE_SENTINEL);
    // Must never be undefined — Firestore rejects undefined in batch writes
    expect(result.playerId).not.toBeUndefined();
  });

  it('uses the primary membership, not the first', () => {
    const memberships: RoleMembership[] = [
      { role: 'coach', teamId: 'team-a', isPrimary: false },
      { role: 'parent', teamId: 'team-b', playerId: 'player-7', isPrimary: true },
    ];
    const result = syncLegacyScalars(memberships);
    expect(result.role).toBe('parent');
    expect(result.playerId).toBe('player-7');
  });

  it('falls back to first membership when none is marked primary', () => {
    const memberships: RoleMembership[] = [
      { role: 'coach', teamId: 'team-a', isPrimary: false },
      { role: 'player', teamId: 'team-b', isPrimary: false },
    ];
    const result = syncLegacyScalars(memberships);
    expect(result.role).toBe('coach');
    expect(result.teamId).toBe('team-a');
  });

  it('never produces undefined values (Firestore-safe)', () => {
    const memberships: RoleMembership[] = [
      { role: 'league_manager', leagueId: 'league-1', isPrimary: true },
    ];
    const result = syncLegacyScalars(memberships);
    for (const val of Object.values(result)) {
      expect(val).not.toBeUndefined();
    }
  });

});

// ─── addMembership ────────────────────────────────────────────────────────────

describe('addMembership', () => {

  it('marks the first membership as primary', () => {
    const result = addMembership([], { role: 'coach', teamId: 'team-1' });
    expect(result).toHaveLength(1);
    expect(result[0].isPrimary).toBe(true);
  });

  it('does not mark subsequent memberships as primary', () => {
    const existing: RoleMembership[] = [{ role: 'coach', teamId: 'team-1', isPrimary: true }];
    const result = addMembership(existing, { role: 'parent', teamId: 'team-1', playerId: 'p1' });
    expect(result).toHaveLength(2);
    expect(result[1].isPrimary).toBe(false);
    expect(result[0].isPrimary).toBe(true);
  });

  it('preserves playerId on parent membership', () => {
    const result = addMembership([], { role: 'parent', teamId: 'team-1', playerId: 'player-5' });
    expect(result[0].playerId).toBe('player-5');
  });

  it('does not mutate the input array', () => {
    const original: RoleMembership[] = [{ role: 'coach', isPrimary: true }];
    addMembership(original, { role: 'player' });
    expect(original).toHaveLength(1);
  });

});

// ─── removeMembership ─────────────────────────────────────────────────────────

describe('removeMembership', () => {

  it('returns null when removing the only membership', () => {
    const memberships: RoleMembership[] = [{ role: 'coach', isPrimary: true }];
    expect(removeMembership(memberships, 0)).toBeNull();
  });

  it('promotes the next membership to primary when the primary is removed', () => {
    const memberships: RoleMembership[] = [
      { role: 'coach', teamId: 'team-a', isPrimary: true },
      { role: 'parent', teamId: 'team-a', playerId: 'p1', isPrimary: false },
    ];
    const result = removeMembership(memberships, 0)!;
    expect(result).toHaveLength(1);
    expect(result[0].isPrimary).toBe(true);
    expect(result[0].role).toBe('parent');
  });

  it('does not change primary when a non-primary is removed', () => {
    const memberships: RoleMembership[] = [
      { role: 'coach', teamId: 'team-a', isPrimary: true },
      { role: 'parent', teamId: 'team-a', playerId: 'p1', isPrimary: false },
    ];
    const result = removeMembership(memberships, 1)!;
    expect(result).toHaveLength(1);
    expect(result[0].isPrimary).toBe(true);
    expect(result[0].role).toBe('coach');
  });

});

// ─── setPrimaryMembership ─────────────────────────────────────────────────────

describe('setPrimaryMembership', () => {

  it('promotes the specified index and demotes all others', () => {
    const memberships: RoleMembership[] = [
      { role: 'coach', isPrimary: true },
      { role: 'parent', playerId: 'p1', isPrimary: false },
    ];
    const result = setPrimaryMembership(memberships, 1);
    expect(result[0].isPrimary).toBe(false);
    expect(result[1].isPrimary).toBe(true);
  });

  it('does not mutate the input array', () => {
    const memberships: RoleMembership[] = [
      { role: 'coach', isPrimary: true },
      { role: 'parent', isPrimary: false },
    ];
    setPrimaryMembership(memberships, 1);
    expect(memberships[0].isPrimary).toBe(true);
  });

});
