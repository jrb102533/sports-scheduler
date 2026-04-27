/**
 * TeamsPage — League Manager visibility regression
 *
 * Bug: LM users with no personal coach memberships saw zero teams on the
 * Teams page, with no path to navigate into a team detail page (and thus
 * no path to the new Chat tab). The page treated `isAdmin` as the only
 * unscoped path; LMs fell through to the personal-membership filter.
 *
 * Fix: a new `isAdminOrLM` derived flag mirrors the existing
 * `useTeamStore.subscribe` admin/LM bypass — LMs see every team in the
 * store (which is already populated for them via the store-level bypass).
 *
 * These tests lock in:
 *   1. An LM with NO personal team memberships sees all teams in the store
 *   2. An LM with a single coach membership still sees all teams (not just
 *      the one team they coach)
 *   3. An LM does NOT see the "Find a Team" public-discovery section
 *      (consistent with admin behavior — they have no need to browse + join)
 *   4. The deleted-teams admin-only block stays admin-only (LM is excluded)
 *   5. A regular coach (not LM) still sees only personal-membership teams
 *      (regression guard against accidentally widening too far)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile, Team } from '@/types';

// ─── Firebase stub ─────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({
  app: {}, auth: {}, db: {}, functions: {}, storage: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
  getDocs: vi.fn().mockResolvedValue({ size: 0, docs: [] }),
  query: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
  where: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

// ─── Auth store ───────────────────────────────────────────────────────────────
let currentProfile: UserProfile | null = null;
let currentUser: { uid: string } | null = null;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (sel?: (s: object) => unknown) => {
    const state = { profile: currentProfile, user: currentUser };
    return sel ? sel(state) : state;
  },
  hasRole: (profile: UserProfile | null, ...roles: string[]) => {
    if (!profile) return false;
    if (profile.role && roles.includes(profile.role)) return true;
    const memberships = profile.memberships ?? [];
    return memberships.some((m: { role: string }) => roles.includes(m.role));
  },
  isMemberOfTeam: (profile: UserProfile | null, teamId: string) => {
    if (!profile) return false;
    const memberships = profile.memberships && profile.memberships.length > 0
      ? profile.memberships
      : [{ role: profile.role, isPrimary: true, teamId: profile.teamId }];
    if (memberships.some((m: { role: string }) => m.role === 'admin')) return true;
    return memberships.some((m: { teamId?: string }) => m.teamId === teamId);
  },
}));

// ─── Team store ───────────────────────────────────────────────────────────────
let currentTeams: Team[] = [];
let currentDeletedTeams: Team[] = [];

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (sel?: (s: object) => unknown) => {
    const state = {
      teams: currentTeams,
      deletedTeams: currentDeletedTeams,
      restoreTeam: vi.fn(),
      hardDeleteTeam: vi.fn(),
    };
    return sel ? sel(state) : state;
  },
}));

vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (sel?: (s: object) => unknown) => sel ? sel({ players: [] }) : { players: [] },
}));

vi.mock('@/components/teams/TeamForm', () => ({
  TeamForm: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="team-form" /> : null,
}));

vi.mock('@/components/teams/TeamCard', () => ({
  TeamCard: ({ team }: { team: Team }) => (
    <div data-testid={`team-card-${team.id}`}>{team.name}</div>
  ),
}));

import { TeamsPage } from '@/pages/TeamsPage';

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'uid-test',
    email: 'test@example.com',
    displayName: 'Test',
    role: 'player',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTeam(id: string, overrides: Partial<Team> = {}): Team {
  return {
    id,
    name: `Team ${id}`,
    sportType: 'soccer',
    color: '#ef4444',
    createdBy: 'uid-other',
    ownerName: 'Other Coach',
    attendanceWarningsEnabled: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <TeamsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = null;
  currentUser = null;
  currentTeams = [];
  currentDeletedTeams = [];
});

// ─── LM with no personal memberships ─────────────────────────────────────────

describe('TeamsPage — League Manager visibility', () => {
  it('LM with no personal memberships sees ALL teams in the store', () => {
    currentUser = { uid: 'uid-lm' };
    currentProfile = makeProfile({
      uid: 'uid-lm',
      role: 'league_manager',
      memberships: [{ role: 'league_manager', leagueId: 'league-1', isPrimary: true }],
    });
    currentTeams = [
      makeTeam('team-A', { name: 'Lions', leagueIds: ['league-1'] }),
      makeTeam('team-B', { name: 'Tigers', leagueIds: ['league-1'] }),
      makeTeam('team-C', { name: 'Bears', leagueIds: ['league-2'] }),
    ];

    renderPage();

    // All three rendered as team cards (the store-level bypass already
    // makes them all visible; this test locks in the page-level filter
    // doesn't drop them again)
    expect(screen.getByText('Lions')).toBeInTheDocument();
    expect(screen.getByText('Tigers')).toBeInTheDocument();
    expect(screen.getByText('Bears')).toBeInTheDocument();
    // Count summary uses teams.length (the unscoped count) for LM
    expect(screen.getByText('3 teams')).toBeInTheDocument();
  });

  it('LM with one personal coach membership still sees ALL teams', () => {
    currentUser = { uid: 'uid-lm' };
    currentProfile = makeProfile({
      uid: 'uid-lm',
      role: 'league_manager',
      memberships: [
        { role: 'league_manager', leagueId: 'league-1', isPrimary: true },
        { role: 'coach', teamId: 'team-A' },
      ],
    });
    currentTeams = [
      makeTeam('team-A', { name: 'Lions', coachId: 'uid-lm' }),
      makeTeam('team-B', { name: 'Tigers' }),
    ];

    renderPage();

    expect(screen.getByText('Lions')).toBeInTheDocument();
    expect(screen.getByText('Tigers')).toBeInTheDocument();
  });

  it('LM does NOT see the "Find a Team" discovery section', () => {
    currentUser = { uid: 'uid-lm' };
    currentProfile = makeProfile({
      uid: 'uid-lm',
      role: 'league_manager',
      memberships: [{ role: 'league_manager', leagueId: 'league-1', isPrimary: true }],
    });
    // Some public teams that would normally show in "Find a Team" for a non-elevated user
    currentTeams = [
      makeTeam('team-public', { name: 'Public FC', isPrivate: false }),
    ];

    renderPage();

    // LM treats all teams as "myTeams" — the public team appears as a card,
    // not under the "Find a Team" section heading
    expect(screen.queryByText('Find a Team')).toBeNull();
  });

  it('LM does NOT see the admin-only Deleted Teams section', () => {
    currentUser = { uid: 'uid-lm' };
    currentProfile = makeProfile({
      uid: 'uid-lm',
      role: 'league_manager',
      memberships: [{ role: 'league_manager', leagueId: 'league-1', isPrimary: true }],
    });
    currentDeletedTeams = [
      makeTeam('team-old', { name: 'Old Team', isDeleted: true }),
    ];

    renderPage();

    // The Deleted Teams accordion is admin-only; LM should not see it even
    // though their store hypothetically might surface deletedTeams.
    expect(screen.queryByText(/Deleted Teams/i)).toBeNull();
  });
});

// ─── Regression guard: coach-only role does NOT get the unscoped path ───────

describe('TeamsPage — coach role unchanged', () => {
  it('a plain coach still only sees teams they personally coach (not the LM bypass)', () => {
    currentUser = { uid: 'uid-coach' };
    currentProfile = makeProfile({
      uid: 'uid-coach',
      role: 'coach',
      memberships: [{ role: 'coach', teamId: 'team-A', isPrimary: true }],
    });
    currentTeams = [
      makeTeam('team-A', { name: 'Lions', coachId: 'uid-coach' }),
      makeTeam('team-B', { name: 'Tigers', isPrivate: true }), // private — never in otherTeams
    ];

    renderPage();

    expect(screen.getByText('Lions')).toBeInTheDocument();
    // Tigers is private — coach not on it — should not see it
    expect(screen.queryByText('Tigers')).toBeNull();
  });
});
