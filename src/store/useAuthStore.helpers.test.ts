/**
 * useAuthStore — role permission helpers
 *
 * Tests every exported helper function that gates RBAC across the app:
 *   getMemberships, getActiveMembership, hasRole, canEdit, isReadOnly,
 *   isCoachOfTeam, isManagerOfLeague, isMemberOfTeam, getAccessibleTeamIds
 *
 * These are pure functions — no Firebase connection required.
 * All 5 roles tested: admin, coach, league_manager, parent, player.
 */

import { describe, it, expect, vi } from 'vitest';

// ── Firebase mocks (pure-function tests need no real Firebase connection) ─────

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(() => () => {}),
  updateProfile: vi.fn(),
  updatePassword: vi.fn(),
  sendEmailVerification: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  updateDoc: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(),
}));

vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, functions: {} }));

vi.mock('@/lib/consent', () => ({
  getUserConsents: vi.fn(),
}));

vi.mock('@/legal/versions', () => ({
  LEGAL_VERSIONS: { termsOfService: '1.0', privacyPolicy: '1.0' },
}));
import {
  getMemberships,
  getActiveMembership,
  hasRole,
  canEdit,
  isReadOnly,
  isCoachOfTeam,
  isManagerOfLeague,
  isMemberOfTeam,
  getAccessibleTeamIds,
} from './useAuthStore';
import type { UserProfile, RoleMembership, Team } from '@/types';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'uid-1',
    email: 'user@example.com',
    displayName: 'Test User',
    role: 'coach',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeMembership(overrides: Partial<RoleMembership> = {}): RoleMembership {
  return {
    role: 'coach',
    isPrimary: true,
    ...overrides,
  };
}

function makeTeam(id: string, overrides: Partial<Team> = {}): Team {
  return {
    id,
    name: `Team ${id}`,
    sportType: 'soccer',
    color: '#000',
    createdBy: 'other-uid',
    ownerName: 'Other Coach',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── getMemberships ────────────────────────────────────────────────────────────

describe('getMemberships', () => {
  it('returns [] when profile is null', () => {
    expect(getMemberships(null)).toEqual([]);
  });

  it('returns the memberships array when present and non-empty', () => {
    const memberships = [
      makeMembership({ role: 'coach', teamId: 'team-1', isPrimary: true }),
      makeMembership({ role: 'parent', teamId: 'team-2', isPrimary: false }),
    ];
    const profile = makeProfile({ memberships });
    expect(getMemberships(profile)).toEqual(memberships);
  });

  it('falls back to legacy scalar fields when memberships array is absent', () => {
    const profile = makeProfile({ role: 'coach', teamId: 'team-1', memberships: undefined });
    const result = getMemberships(profile);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('coach');
    expect(result[0].teamId).toBe('team-1');
    expect(result[0].isPrimary).toBe(true);
  });

  it('falls back to legacy scalar fields when memberships array is empty', () => {
    const profile = makeProfile({ role: 'player', teamId: 'team-2', memberships: [] });
    const result = getMemberships(profile);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('player');
  });

  it('includes leagueId in legacy fallback for league_manager', () => {
    const profile = makeProfile({ role: 'league_manager', leagueId: 'league-1', memberships: undefined });
    const result = getMemberships(profile);
    expect(result[0].leagueId).toBe('league-1');
  });

  it('includes playerId in legacy fallback for parent', () => {
    const profile = makeProfile({ role: 'parent', playerId: 'player-1', memberships: undefined });
    const result = getMemberships(profile);
    expect(result[0].playerId).toBe('player-1');
  });
});

// ── getActiveMembership ───────────────────────────────────────────────────────

describe('getActiveMembership', () => {
  it('returns null when profile is null', () => {
    expect(getActiveMembership(null)).toBeNull();
  });

  it('returns the first membership when activeContext is 0', () => {
    const m1 = makeMembership({ role: 'coach', teamId: 'team-1', isPrimary: true });
    const m2 = makeMembership({ role: 'parent', teamId: 'team-2', isPrimary: false });
    const profile = makeProfile({ memberships: [m1, m2], activeContext: 0 });
    expect(getActiveMembership(profile)).toEqual(m1);
  });

  it('returns the second membership when activeContext is 1', () => {
    const m1 = makeMembership({ role: 'coach', teamId: 'team-1', isPrimary: true });
    const m2 = makeMembership({ role: 'parent', teamId: 'team-2', isPrimary: false });
    const profile = makeProfile({ memberships: [m1, m2], activeContext: 1 });
    expect(getActiveMembership(profile)).toEqual(m2);
  });

  it('falls back to the primary membership when activeContext is out of bounds', () => {
    const m1 = makeMembership({ role: 'coach', teamId: 'team-1', isPrimary: false });
    const m2 = makeMembership({ role: 'admin', isPrimary: true });
    const profile = makeProfile({ memberships: [m1, m2], activeContext: 99 });
    // Index 99 is out of bounds; falls back to the isPrimary membership (m2)
    expect(getActiveMembership(profile)?.role).toBe('admin');
  });

  it('falls back to memberships[0] when no primary is marked and index is out of bounds', () => {
    const m1 = makeMembership({ role: 'coach', teamId: 'team-1', isPrimary: false });
    const profile = makeProfile({ memberships: [m1], activeContext: 5 });
    expect(getActiveMembership(profile)).toEqual(m1);
  });

  it('returns the legacy synthetic membership for profiles without memberships array', () => {
    const profile = makeProfile({ role: 'parent', teamId: 'team-3', memberships: undefined });
    const active = getActiveMembership(profile);
    expect(active?.role).toBe('parent');
    expect(active?.teamId).toBe('team-3');
  });
});

// ── hasRole ───────────────────────────────────────────────────────────────────

describe('hasRole', () => {
  it('returns false when profile is null', () => {
    expect(hasRole(null, 'admin')).toBe(false);
  });

  it('returns true for a single matching role', () => {
    const profile = makeProfile({ role: 'coach' });
    expect(hasRole(profile, 'coach')).toBe(true);
  });

  it('returns false when role does not match', () => {
    const profile = makeProfile({ role: 'player' });
    expect(hasRole(profile, 'coach')).toBe(false);
  });

  it('returns true when any of multiple supplied roles match', () => {
    const profile = makeProfile({ role: 'coach' });
    expect(hasRole(profile, 'admin', 'coach', 'league_manager')).toBe(true);
  });

  it('returns true when user holds admin role across memberships', () => {
    const profile = makeProfile({
      role: 'coach',
      memberships: [
        makeMembership({ role: 'coach', teamId: 'team-1', isPrimary: true }),
        makeMembership({ role: 'admin', isPrimary: false }),
      ],
    });
    expect(hasRole(profile, 'admin')).toBe(true);
  });

  it('matches across any membership, not just the primary', () => {
    const profile = makeProfile({
      role: 'coach',
      memberships: [
        makeMembership({ role: 'coach', teamId: 'team-1', isPrimary: true }),
        makeMembership({ role: 'league_manager', leagueId: 'league-1', isPrimary: false }),
      ],
    });
    expect(hasRole(profile, 'league_manager')).toBe(true);
  });

  it('returns false for all 5 roles when profile has no matching membership', () => {
    const profile = makeProfile({ role: 'player', memberships: [makeMembership({ role: 'player' })] });
    expect(hasRole(profile, 'admin')).toBe(false);
    expect(hasRole(profile, 'coach')).toBe(false);
    expect(hasRole(profile, 'league_manager')).toBe(false);
    expect(hasRole(profile, 'parent')).toBe(false);
  });
});

// ── canEdit ───────────────────────────────────────────────────────────────────

describe('canEdit', () => {
  it('returns false when profile is null', () => {
    expect(canEdit(null, makeTeam('t1'))).toBe(false);
  });

  it('returns true for admin regardless of team', () => {
    const admin = makeProfile({
      role: 'admin',
      memberships: [makeMembership({ role: 'admin', isPrimary: true })],
    });
    expect(canEdit(admin, null)).toBe(true);
    expect(canEdit(admin, makeTeam('any'))).toBe(true);
  });

  it('returns false for admin when team is not passed but profile has no admin membership', () => {
    const coach = makeProfile({ role: 'coach' });
    expect(canEdit(coach, null)).toBe(false);
  });

  it('returns true when the user created the team (createdBy === uid)', () => {
    const profile = makeProfile({ uid: 'uid-1', role: 'coach' });
    const team = makeTeam('t1', { createdBy: 'uid-1' });
    expect(canEdit(profile, team)).toBe(true);
  });

  it('returns true when user is the legacy coachId on the team', () => {
    const profile = makeProfile({ uid: 'uid-1', role: 'coach' });
    const team = makeTeam('t1', { coachId: 'uid-1' });
    expect(canEdit(profile, team)).toBe(true);
  });

  it('returns true when user uid is in coachIds array', () => {
    const profile = makeProfile({ uid: 'uid-1', role: 'coach' });
    const team = makeTeam('t1', { coachIds: ['uid-other', 'uid-1'] });
    expect(canEdit(profile, team)).toBe(true);
  });

  // ── Bug #343 regression tests ─────────────────────────────────────────────
  // Ensures the coachIds[] array path is checked independently of the legacy
  // scalar coachId field. Both paths must remain independently sufficient.

  it('(#343) returns true when uid is in coachIds[] but scalar coachId belongs to a different user', () => {
    const profile = makeProfile({ uid: 'uid-coach-array', role: 'coach' });
    const team = makeTeam('t1', {
      createdBy: 'uid-other',
      coachId: 'uid-coach-scalar',   // different user — scalar path must NOT match
      coachIds: ['uid-coach-array'],  // only array path should match
    });
    expect(canEdit(profile, team)).toBe(true);
  });

  it('(#343) scalar coachId path still grants access independently of coachIds[]', () => {
    const profile = makeProfile({ uid: 'uid-coach-scalar', role: 'coach' });
    const team = makeTeam('t1', {
      createdBy: 'uid-other',
      coachId: 'uid-coach-scalar',   // only scalar path should match
      coachIds: ['uid-coach-array'],  // array contains a different user — must NOT be required
    });
    expect(canEdit(profile, team)).toBe(true);
  });

  it('returns false when user is not owner/coach and team does not belong to their league', () => {
    const profile = makeProfile({
      uid: 'uid-1',
      role: 'league_manager',
      memberships: [makeMembership({ role: 'league_manager', leagueId: 'league-A', isPrimary: true })],
    });
    const team = makeTeam('t1', { leagueIds: ['league-B'] });
    expect(canEdit(profile, team)).toBe(false);
  });

  it('returns true when league_manager and team is in their league', () => {
    const profile = makeProfile({
      uid: 'uid-1',
      role: 'league_manager',
      memberships: [makeMembership({ role: 'league_manager', leagueId: 'league-A', isPrimary: true })],
    });
    const team = makeTeam('t1', { leagueIds: ['league-A', 'league-B'] });
    expect(canEdit(profile, team)).toBe(true);
  });

  it('returns false for player even if they belong to the team', () => {
    const profile = makeProfile({
      uid: 'uid-1',
      role: 'player',
      memberships: [makeMembership({ role: 'player', teamId: 't1', isPrimary: true })],
    });
    const team = makeTeam('t1');
    expect(canEdit(profile, team)).toBe(false);
  });

  it('returns false for parent even if they belong to the team', () => {
    const profile = makeProfile({
      uid: 'uid-1',
      role: 'parent',
      memberships: [makeMembership({ role: 'parent', teamId: 't1', isPrimary: true })],
    });
    const team = makeTeam('t1');
    expect(canEdit(profile, team)).toBe(false);
  });
});

// ── isReadOnly ────────────────────────────────────────────────────────────────

describe('isReadOnly', () => {
  it('returns false when profile is null', () => {
    expect(isReadOnly(null)).toBe(false);
  });

  it('returns true when all memberships are player', () => {
    const profile = makeProfile({
      role: 'player',
      memberships: [makeMembership({ role: 'player', isPrimary: true })],
    });
    expect(isReadOnly(profile)).toBe(true);
  });

  it('returns true when all memberships are parent', () => {
    const profile = makeProfile({
      role: 'parent',
      memberships: [makeMembership({ role: 'parent', isPrimary: true })],
    });
    expect(isReadOnly(profile)).toBe(true);
  });

  it('returns true for multi-membership parent+player profile', () => {
    const profile = makeProfile({
      role: 'parent',
      memberships: [
        makeMembership({ role: 'parent', isPrimary: true }),
        makeMembership({ role: 'player', isPrimary: false }),
      ],
    });
    expect(isReadOnly(profile)).toBe(true);
  });

  it('returns false when at least one membership is coach', () => {
    const profile = makeProfile({
      role: 'coach',
      memberships: [
        makeMembership({ role: 'coach', isPrimary: true }),
        makeMembership({ role: 'parent', isPrimary: false }),
      ],
    });
    expect(isReadOnly(profile)).toBe(false);
  });

  it('returns false for admin', () => {
    const profile = makeProfile({
      role: 'admin',
      memberships: [makeMembership({ role: 'admin', isPrimary: true })],
    });
    expect(isReadOnly(profile)).toBe(false);
  });

  it('returns false for league_manager', () => {
    const profile = makeProfile({
      role: 'league_manager',
      memberships: [makeMembership({ role: 'league_manager', isPrimary: true })],
    });
    expect(isReadOnly(profile)).toBe(false);
  });
});

// ── isCoachOfTeam ─────────────────────────────────────────────────────────────

describe('isCoachOfTeam', () => {
  it('returns false when profile is null', () => {
    expect(isCoachOfTeam(null, 'team-1')).toBe(false);
  });

  it('returns true when coach has the matching teamId in their membership', () => {
    const profile = makeProfile({
      role: 'coach',
      memberships: [makeMembership({ role: 'coach', teamId: 'team-1', isPrimary: true })],
    });
    expect(isCoachOfTeam(profile, 'team-1')).toBe(true);
  });

  it('returns false when coach has a different teamId', () => {
    const profile = makeProfile({
      role: 'coach',
      memberships: [makeMembership({ role: 'coach', teamId: 'team-2', isPrimary: true })],
    });
    expect(isCoachOfTeam(profile, 'team-1')).toBe(false);
  });

  it('returns true for admin regardless of teamId (bypass)', () => {
    const admin = makeProfile({
      role: 'admin',
      memberships: [makeMembership({ role: 'admin', isPrimary: true })],
    });
    expect(isCoachOfTeam(admin, 'any-team')).toBe(true);
  });

  it('returns false for player even when they belong to the team', () => {
    const profile = makeProfile({
      role: 'player',
      memberships: [makeMembership({ role: 'player', teamId: 'team-1', isPrimary: true })],
    });
    expect(isCoachOfTeam(profile, 'team-1')).toBe(false);
  });

  it('returns true when coach membership is not the primary membership', () => {
    const profile = makeProfile({
      role: 'parent',
      memberships: [
        makeMembership({ role: 'parent', teamId: 'team-3', isPrimary: true }),
        makeMembership({ role: 'coach', teamId: 'team-1', isPrimary: false }),
      ],
    });
    expect(isCoachOfTeam(profile, 'team-1')).toBe(true);
  });
});

// ── isManagerOfLeague ─────────────────────────────────────────────────────────

describe('isManagerOfLeague', () => {
  it('returns false when profile is null', () => {
    expect(isManagerOfLeague(null, 'league-1')).toBe(false);
  });

  it('returns true when league_manager has the matching leagueId', () => {
    const profile = makeProfile({
      role: 'league_manager',
      memberships: [makeMembership({ role: 'league_manager', leagueId: 'league-1', isPrimary: true })],
    });
    expect(isManagerOfLeague(profile, 'league-1')).toBe(true);
  });

  it('returns false when league_manager has a different leagueId', () => {
    const profile = makeProfile({
      role: 'league_manager',
      memberships: [makeMembership({ role: 'league_manager', leagueId: 'league-2', isPrimary: true })],
    });
    expect(isManagerOfLeague(profile, 'league-1')).toBe(false);
  });

  it('returns true for admin regardless of leagueId', () => {
    const admin = makeProfile({
      role: 'admin',
      memberships: [makeMembership({ role: 'admin', isPrimary: true })],
    });
    expect(isManagerOfLeague(admin, 'any-league')).toBe(true);
  });

  it('returns false for coach even if leagueId matches', () => {
    const profile = makeProfile({
      role: 'coach',
      memberships: [makeMembership({ role: 'coach', leagueId: 'league-1', isPrimary: true })],
    });
    expect(isManagerOfLeague(profile, 'league-1')).toBe(false);
  });
});

// ── isMemberOfTeam ────────────────────────────────────────────────────────────

describe('isMemberOfTeam', () => {
  it('returns false when profile is null', () => {
    expect(isMemberOfTeam(null, 'team-1')).toBe(false);
  });

  it('returns true for any role with the matching teamId', () => {
    for (const role of ['coach', 'player', 'parent'] as const) {
      const profile = makeProfile({
        role,
        memberships: [makeMembership({ role, teamId: 'team-1', isPrimary: true })],
      });
      expect(isMemberOfTeam(profile, 'team-1')).toBe(true);
    }
  });

  it('returns false when teamId does not match', () => {
    const profile = makeProfile({
      role: 'player',
      memberships: [makeMembership({ role: 'player', teamId: 'team-2', isPrimary: true })],
    });
    expect(isMemberOfTeam(profile, 'team-1')).toBe(false);
  });

  it('returns true for admin regardless of teamId', () => {
    const admin = makeProfile({
      role: 'admin',
      memberships: [makeMembership({ role: 'admin', isPrimary: true })],
    });
    expect(isMemberOfTeam(admin, 'any-team')).toBe(true);
  });

  it('returns true when the matching teamId is in a non-primary membership', () => {
    const profile = makeProfile({
      role: 'coach',
      memberships: [
        makeMembership({ role: 'coach', teamId: 'team-X', isPrimary: true }),
        makeMembership({ role: 'parent', teamId: 'team-1', isPrimary: false }),
      ],
    });
    expect(isMemberOfTeam(profile, 'team-1')).toBe(true);
  });
});

// ── getAccessibleTeamIds ──────────────────────────────────────────────────────

describe('getAccessibleTeamIds', () => {
  it('returns [] when profile is null', () => {
    expect(getAccessibleTeamIds(null, [])).toEqual([]);
  });

  it('returns null for admin (meaning all teams)', () => {
    const admin = makeProfile({
      role: 'admin',
      memberships: [makeMembership({ role: 'admin', isPrimary: true })],
    });
    const result = getAccessibleTeamIds(admin, [makeTeam('t1'), makeTeam('t2')]);
    expect(result).toBeNull();
  });

  it('returns only the coach\'s team', () => {
    const profile = makeProfile({
      uid: 'uid-1',
      role: 'coach',
      memberships: [makeMembership({ role: 'coach', teamId: 'team-1', isPrimary: true })],
    });
    const allTeams = [
      makeTeam('team-1', { id: 'team-1' }),
      makeTeam('team-2', { id: 'team-2' }),
    ];
    const result = getAccessibleTeamIds(profile, allTeams);
    expect(result).toContain('team-1');
    expect(result).not.toContain('team-2');
  });

  it('returns teams created by the coach even without membership teamId', () => {
    const profile = makeProfile({
      uid: 'uid-1',
      role: 'coach',
      memberships: [makeMembership({ role: 'coach', teamId: undefined, isPrimary: true })],
    });
    const allTeams = [
      makeTeam('team-1', { createdBy: 'uid-1' }),
      makeTeam('team-2', { createdBy: 'uid-other' }),
    ];
    const result = getAccessibleTeamIds(profile, allTeams);
    expect(result).toContain('team-1');
    expect(result).not.toContain('team-2');
  });

  it('returns teams in the league_manager\'s league', () => {
    const profile = makeProfile({
      uid: 'uid-1',
      role: 'league_manager',
      memberships: [makeMembership({ role: 'league_manager', leagueId: 'league-A', isPrimary: true })],
    });
    const allTeams = [
      makeTeam('team-1', { leagueIds: ['league-A'] }),
      makeTeam('team-2', { leagueIds: ['league-B'] }),
      makeTeam('team-3', { leagueIds: ['league-A', 'league-B'] }),
    ];
    const result = getAccessibleTeamIds(profile, allTeams);
    expect(result).toContain('team-1');
    expect(result).toContain('team-3');
    expect(result).not.toContain('team-2');
  });

  it('returns only the player\'s own teamId for player role', () => {
    const profile = makeProfile({
      uid: 'uid-1',
      role: 'player',
      memberships: [makeMembership({ role: 'player', teamId: 'team-1', isPrimary: true })],
    });
    const allTeams = [makeTeam('team-1'), makeTeam('team-2')];
    const result = getAccessibleTeamIds(profile, allTeams);
    expect(result).toEqual(['team-1']);
  });

  it('returns only the parent\'s teamId for parent role', () => {
    const profile = makeProfile({
      uid: 'uid-1',
      role: 'parent',
      memberships: [makeMembership({ role: 'parent', teamId: 'team-3', isPrimary: true })],
    });
    const allTeams = [makeTeam('team-1'), makeTeam('team-3')];
    const result = getAccessibleTeamIds(profile, allTeams);
    expect(result).toEqual(['team-3']);
  });

  it('deduplicates team ids across multiple coach memberships covering the same team', () => {
    const profile = makeProfile({
      uid: 'uid-1',
      role: 'coach',
      memberships: [
        makeMembership({ role: 'coach', teamId: 'team-1', isPrimary: true }),
        makeMembership({ role: 'coach', teamId: 'team-1', isPrimary: false }),
      ],
    });
    const allTeams = [makeTeam('team-1')];
    const result = getAccessibleTeamIds(profile, allTeams);
    // Set dedup: team-1 should appear exactly once
    expect(result?.filter(id => id === 'team-1')).toHaveLength(1);
  });

  it('returns empty array when player has no teamId', () => {
    const profile = makeProfile({
      uid: 'uid-1',
      role: 'player',
      memberships: [makeMembership({ role: 'player', teamId: undefined, isPrimary: true })],
    });
    const result = getAccessibleTeamIds(profile, [makeTeam('t1')]);
    expect(result).toEqual([]);
  });

  it('league_manager also sees teams they created (may not be in a league yet)', () => {
    const profile = makeProfile({
      uid: 'uid-1',
      role: 'league_manager',
      memberships: [makeMembership({ role: 'league_manager', leagueId: 'league-A', isPrimary: true })],
    });
    const allTeams = [
      makeTeam('team-created', { createdBy: 'uid-1', leagueIds: [] }),
      makeTeam('team-other', { createdBy: 'uid-other', leagueIds: [] }),
    ];
    const result = getAccessibleTeamIds(profile, allTeams);
    expect(result).toContain('team-created');
    expect(result).not.toContain('team-other');
  });
});
