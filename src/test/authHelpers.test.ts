import { describe, it, expect, vi } from 'vitest';

// Prevent Firebase SDK initialization during pure helper tests
vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@/lib/buildInfo', () => ({
  buildInfo: { version: 'test', sha: 'test', time: '', branch: '', pr: null, env: 'development' },
}));

import { hasRole, canEdit, isReadOnly, getAccessibleTeamIds, getMemberships, getActiveMembership } from '@/store/useAuthStore';
import type { UserProfile, Team } from '@/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'user1',
    email: 'user@example.com',
    displayName: 'Test User',
    role: 'coach',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team1',
    name: 'Lions',
    sportType: 'soccer',
    color: '#000',
    homeVenue: '',
    coachName: '',
    coachEmail: '',
    coachPhone: '',
    ageGroup: 'U12',
    createdBy: 'other-user',
    isDeleted: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as Team;
}

// ── hasRole ───────────────────────────────────────────────────────────────────

describe('hasRole', () => {
  it('returns false when profile is null', () => {
    expect(hasRole(null, 'admin')).toBe(false);
  });

  it('returns true when profile role matches', () => {
    expect(hasRole(makeProfile({ role: 'admin' }), 'admin')).toBe(true);
  });

  it('returns true when profile role is one of many checked roles', () => {
    expect(hasRole(makeProfile({ role: 'coach' }), 'admin', 'coach')).toBe(true);
  });

  it('returns false when profile role does not match', () => {
    expect(hasRole(makeProfile({ role: 'player' }), 'admin', 'coach')).toBe(false);
  });
});

// ── canEdit ───────────────────────────────────────────────────────────────────

describe('canEdit', () => {
  it('returns false when profile is null', () => {
    expect(canEdit(null, makeTeam())).toBe(false);
  });

  it('returns true for admin regardless of team', () => {
    expect(canEdit(makeProfile({ role: 'admin' }), makeTeam())).toBe(true);
    expect(canEdit(makeProfile({ role: 'admin' }), null)).toBe(true);
  });

  it('returns false for non-admin when team is null', () => {
    expect(canEdit(makeProfile({ role: 'coach' }), null)).toBe(false);
  });

  it('returns true when user created the team', () => {
    const profile = makeProfile({ uid: 'user1' });
    const team = makeTeam({ createdBy: 'user1' });
    expect(canEdit(profile, team)).toBe(true);
  });

  it('returns true when user is the coach of the team', () => {
    const profile = makeProfile({ uid: 'user1' });
    const team = makeTeam({ coachId: 'user1' });
    expect(canEdit(profile, team)).toBe(true);
  });

  it('returns true for league_manager whose leagueId matches team leagueId', () => {
    const profile = makeProfile({ role: 'league_manager', uid: 'lm1', leagueId: 'league1' });
    const team = makeTeam({ leagueId: 'league1' });
    expect(canEdit(profile, team)).toBe(true);
  });

  it('returns false for league_manager with mismatched leagueId', () => {
    const profile = makeProfile({ role: 'league_manager', uid: 'lm1', leagueId: 'league1' });
    const team = makeTeam({ leagueId: 'league2' });
    expect(canEdit(profile, team)).toBe(false);
  });

  it('returns false for league_manager without a leagueId', () => {
    const profile = makeProfile({ role: 'league_manager', uid: 'lm1' });
    const team = makeTeam({ leagueId: 'league1' });
    expect(canEdit(profile, team)).toBe(false);
  });

  it('returns false for coach who neither created nor coaches the team', () => {
    const profile = makeProfile({ uid: 'user1', role: 'coach' });
    const team = makeTeam({ createdBy: 'other', coachId: 'other' });
    expect(canEdit(profile, team)).toBe(false);
  });
});

// ── isReadOnly ────────────────────────────────────────────────────────────────

describe('isReadOnly', () => {
  it('returns false when profile is null', () => {
    expect(isReadOnly(null)).toBe(false);
  });

  it('returns true for player role', () => {
    expect(isReadOnly(makeProfile({ role: 'player' }))).toBe(true);
  });

  it('returns true for parent role', () => {
    expect(isReadOnly(makeProfile({ role: 'parent' }))).toBe(true);
  });

  it('returns false for admin', () => {
    expect(isReadOnly(makeProfile({ role: 'admin' }))).toBe(false);
  });

  it('returns false for coach', () => {
    expect(isReadOnly(makeProfile({ role: 'coach' }))).toBe(false);
  });

  it('returns false for league_manager', () => {
    expect(isReadOnly(makeProfile({ role: 'league_manager' }))).toBe(false);
  });
});

// ── getAccessibleTeamIds ──────────────────────────────────────────────────────

describe('getAccessibleTeamIds', () => {
  const teams = [
    makeTeam({ id: 't1', leagueId: 'league1', createdBy: 'coach1', coachId: 'coach1' }),
    makeTeam({ id: 't2', leagueId: 'league1', createdBy: 'coach2', coachId: 'coach2' }),
    makeTeam({ id: 't3', leagueId: 'league2', createdBy: 'coach3', coachId: 'coach3' }),
  ];

  it('returns an empty array when profile is null', () => {
    expect(getAccessibleTeamIds(null, teams)).toEqual([]);
  });

  it('returns null for admin (all teams)', () => {
    expect(getAccessibleTeamIds(makeProfile({ role: 'admin' }), teams)).toBeNull();
  });

  it('returns teams in the manager\'s league for league_manager', () => {
    const profile = makeProfile({ role: 'league_manager', leagueId: 'league1' });
    expect(getAccessibleTeamIds(profile, teams)).toEqual(['t1', 't2']);
  });

  it('returns empty array for league_manager with no leagueId', () => {
    const profile = makeProfile({ role: 'league_manager' });
    expect(getAccessibleTeamIds(profile, teams)).toEqual([]);
  });

  it('returns empty array for league_manager whose league has no teams', () => {
    const profile = makeProfile({ role: 'league_manager', leagueId: 'league99' });
    expect(getAccessibleTeamIds(profile, teams)).toEqual([]);
  });

  it('returns teams owned or coached by the coach', () => {
    const profile = makeProfile({ uid: 'coach1', role: 'coach' });
    expect(getAccessibleTeamIds(profile, teams)).toEqual(['t1']);
  });

  it('returns teams where coach is either createdBy or coachId', () => {
    const mixed = [
      makeTeam({ id: 'ta', createdBy: 'coach1', coachId: 'other' }),
      makeTeam({ id: 'tb', createdBy: 'other', coachId: 'coach1' }),
      makeTeam({ id: 'tc', createdBy: 'other', coachId: 'other' }),
    ];
    const profile = makeProfile({ uid: 'coach1', role: 'coach' });
    expect(getAccessibleTeamIds(profile, mixed)).toEqual(['ta', 'tb']);
  });

  it('returns [teamId] for a player with a teamId', () => {
    const profile = makeProfile({ role: 'player', teamId: 't2' });
    expect(getAccessibleTeamIds(profile, teams)).toEqual(['t2']);
  });

  it('returns empty array for a player without a teamId', () => {
    const profile = makeProfile({ role: 'player' });
    expect(getAccessibleTeamIds(profile, teams)).toEqual([]);
  });

  it('returns [teamId] for a parent with a teamId', () => {
    const profile = makeProfile({ role: 'parent', teamId: 't3' });
    expect(getAccessibleTeamIds(profile, teams)).toEqual(['t3']);
  });
});

// ── getMemberships ────────────────────────────────────────────────────────────

describe('getMemberships', () => {
  it('returns empty array for null profile', () => {
    expect(getMemberships(null)).toEqual([]);
  });

  it('returns synthetic membership from legacy fields when memberships absent', () => {
    const profile = makeProfile({ role: 'coach', teamId: 't1' });
    const result = getMemberships(profile);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('coach');
    expect(result[0].teamId).toBe('t1');
    expect(result[0].isPrimary).toBe(true);
  });

  it('returns memberships array when present', () => {
    const profile = makeProfile({
      role: 'coach',
      memberships: [
        { role: 'coach', teamId: 't1', isPrimary: true },
        { role: 'parent', teamId: 't2', playerId: 'p1' },
      ],
    });
    expect(getMemberships(profile)).toHaveLength(2);
  });
});

// ── getActiveMembership ───────────────────────────────────────────────────────

describe('getActiveMembership', () => {
  it('returns null for null profile', () => {
    expect(getActiveMembership(null)).toBeNull();
  });

  it('returns first membership by default', () => {
    const profile = makeProfile({
      role: 'coach',
      memberships: [
        { role: 'coach', teamId: 't1', isPrimary: true },
        { role: 'parent', teamId: 't2' },
      ],
      activeContext: 0,
    });
    expect(getActiveMembership(profile)?.role).toBe('coach');
  });

  it('returns membership at activeContext index', () => {
    const profile = makeProfile({
      role: 'coach',
      memberships: [
        { role: 'coach', teamId: 't1', isPrimary: true },
        { role: 'parent', teamId: 't2' },
      ],
      activeContext: 1,
    });
    expect(getActiveMembership(profile)?.role).toBe('parent');
  });
});

// ── multi-membership hasRole ──────────────────────────────────────────────────

describe('hasRole (multi-membership)', () => {
  it('returns true when any membership matches the role', () => {
    const profile = makeProfile({
      role: 'coach',
      memberships: [
        { role: 'coach', teamId: 't1', isPrimary: true },
        { role: 'parent', teamId: 't2' },
      ],
    });
    expect(hasRole(profile, 'parent')).toBe(true);
    expect(hasRole(profile, 'coach')).toBe(true);
    expect(hasRole(profile, 'admin')).toBe(false);
  });
});

// ── multi-membership isReadOnly ───────────────────────────────────────────────

describe('isReadOnly (multi-membership)', () => {
  it('returns false when user has a non-read-only membership alongside read-only ones', () => {
    const profile = makeProfile({
      role: 'coach',
      memberships: [
        { role: 'coach', teamId: 't1', isPrimary: true },
        { role: 'parent', teamId: 't2' },
      ],
    });
    expect(isReadOnly(profile)).toBe(false);
  });

  it('returns true when all memberships are read-only', () => {
    const profile = makeProfile({
      role: 'parent',
      memberships: [
        { role: 'parent', teamId: 't1', isPrimary: true },
        { role: 'player', teamId: 't2' },
      ],
    });
    expect(isReadOnly(profile)).toBe(true);
  });
});

// ── multi-membership getAccessibleTeamIds ─────────────────────────────────────

describe('getAccessibleTeamIds (multi-membership)', () => {
  const teams = [
    makeTeam({ id: 't1', leagueId: 'league1', createdBy: 'coach1', coachId: 'coach1' }),
    makeTeam({ id: 't2', leagueId: 'league2', createdBy: 'coach2', coachId: 'coach2' }),
    makeTeam({ id: 't3', leagueId: 'league2', createdBy: 'coach3', coachId: 'coach3' }),
  ];

  it('returns union of teams across all memberships', () => {
    const profile = makeProfile({
      uid: 'coach1',
      role: 'coach',
      memberships: [
        { role: 'coach', isPrimary: true },       // coach1 owns t1
        { role: 'parent', teamId: 't2' },          // child on t2
      ],
    });
    const result = getAccessibleTeamIds(profile, teams);
    expect(result).toContain('t1');
    expect(result).toContain('t2');
  });

  it('returns null (all teams) if any membership is admin', () => {
    const profile = makeProfile({
      role: 'admin',
      memberships: [
        { role: 'admin', isPrimary: true },
        { role: 'coach', teamId: 't1' },
      ],
    });
    expect(getAccessibleTeamIds(profile, teams)).toBeNull();
  });
});
