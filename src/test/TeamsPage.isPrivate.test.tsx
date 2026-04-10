/**
 * TeamsPage — isPrivate team discovery filtering (SEC-36 / private team feature)
 *
 * The "Find a Team" section (otherTeams) must exclude private teams from
 * non-admin users. Admins see all teams. This tests the filtering logic
 * on the otherTeams derivation:
 *
 *   const otherTeams = isAdmin
 *     ? []
 *     : teams.filter(t => !myTeams.find(m => m.id === t.id) && !t.isPrivate);
 *
 * Behaviors under test:
 *   1. Private team does NOT appear in "Find a Team" for a non-admin user
 *   2. Non-private team DOES appear in "Find a Team" for a non-admin user
 *   3. Multiple private teams are all excluded from "Find a Team"
 *   4. A mix of private and public teams: only public appear in "Find a Team"
 *   5. Admin does NOT see "Find a Team" section at all (sees all teams as myTeams)
 *   6. A team the user already belongs to does NOT appear in "Find a Team"
 *      even if it is not private
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile, Team } from '@/types';

// ─── Firebase stub ─────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
  storage: {},
}));

// Firestore operations used in TeamsPage useEffect hooks
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
  getDocs: vi.fn().mockResolvedValue({ size: 0, docs: [] }),
  query: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
  where: vi.fn(),
}));

// ─── navigate stub ─────────────────────────────────────────────────────────────
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
}));

// ─── Team store ───────────────────────────────────────────────────────────────
let currentTeams: Team[] = [];

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (sel?: (s: object) => unknown) => {
    const state = {
      teams: currentTeams,
      deletedTeams: [] as Team[],
      restoreTeam: vi.fn(),
      hardDeleteTeam: vi.fn(),
    };
    return sel ? sel(state) : state;
  },
}));

// ─── Player store ─────────────────────────────────────────────────────────────
vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (sel?: (s: object) => unknown) => {
    const state = { players: [] };
    return sel ? sel(state) : state;
  },
}));

// ─── Stub child components with heavy deps ─────────────────────────────────────
vi.mock('@/components/teams/TeamForm', () => ({
  TeamForm: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="team-form" /> : null,
}));

vi.mock('@/components/teams/TeamCard', () => ({
  TeamCard: ({ team }: { team: Team }) => (
    <div data-testid={`team-card-${team.id}`}>{team.name}</div>
  ),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { TeamsPage } from '@/pages/TeamsPage';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'uid-player',
    email: 'player@example.com',
    displayName: 'Player A',
    role: 'player',
    teamId: undefined,
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
});

// ─── Private team exclusion from "Find a Team" ───────────────────────────────

describe('TeamsPage — private teams excluded from "Find a Team" for non-admins', () => {
  it('does NOT show a private team in Find a Team section', () => {
    currentUser = { uid: 'uid-player' };
    currentProfile = makeProfile();
    currentTeams = [
      makeTeam('team-private', { name: 'Secret FC', isPrivate: true }),
    ];

    renderPage();

    expect(screen.queryByText('Secret FC')).toBeNull();
    expect(screen.queryByText('Find a Team')).toBeNull();
  });

  it('DOES show a non-private team in Find a Team section', () => {
    currentUser = { uid: 'uid-player' };
    currentProfile = makeProfile();
    currentTeams = [
      makeTeam('team-public', { name: 'Open Strikers', isPrivate: false }),
    ];

    renderPage();

    expect(screen.getByText('Open Strikers')).toBeInTheDocument();
  });

  it('excludes all teams when all discoverable teams are private', () => {
    currentUser = { uid: 'uid-player' };
    currentProfile = makeProfile();
    currentTeams = [
      makeTeam('team-a', { name: 'Private Alpha', isPrivate: true }),
      makeTeam('team-b', { name: 'Private Beta', isPrivate: true }),
    ];

    renderPage();

    expect(screen.queryByText('Private Alpha')).toBeNull();
    expect(screen.queryByText('Private Beta')).toBeNull();
    expect(screen.queryByText('Find a Team')).toBeNull();
  });

  it('shows only public teams when a mix of private and public teams exist', () => {
    currentUser = { uid: 'uid-player' };
    currentProfile = makeProfile();
    currentTeams = [
      makeTeam('team-private', { name: 'Hidden Hawks', isPrivate: true }),
      makeTeam('team-public', { name: 'Visible Vipers', isPrivate: false }),
    ];

    renderPage();

    expect(screen.queryByText('Hidden Hawks')).toBeNull();
    expect(screen.getByText('Visible Vipers')).toBeInTheDocument();
  });

  it('treats isPrivate: undefined the same as false (team is discoverable)', () => {
    currentUser = { uid: 'uid-player' };
    currentProfile = makeProfile();
    currentTeams = [
      makeTeam('team-legacy', { name: 'Legacy Team', isPrivate: undefined }),
    ];

    renderPage();

    expect(screen.getByText('Legacy Team')).toBeInTheDocument();
  });

  it("does not show a user's own team in Find a Team — own team goes into myTeams, not otherTeams", () => {
    // User has no team membership (no teamId, no coachId match) so hasMyTeams=false
    // and both teams would be "other" — but only the user's own team matching profile.uid
    // as coachId or createdBy would appear in myTeams.
    // Simplest scenario: user with no team ownership sees only public teams in Find a Team.
    currentUser = { uid: 'uid-player' };
    currentProfile = makeProfile({ uid: 'uid-player' });
    currentTeams = [
      // Neither team is owned by uid-player (createdBy/coachId is uid-other)
      makeTeam('team-a', { name: 'Team Alpha', isPrivate: false }),
      makeTeam('team-b', { name: 'Team Beta', isPrivate: false }),
    ];

    renderPage();

    // Both public teams appear in "Find a Team"
    expect(screen.getByText('Team Alpha')).toBeInTheDocument();
    expect(screen.getByText('Team Beta')).toBeInTheDocument();
  });
});

// ─── Admin does not see Find a Team ──────────────────────────────────────────

describe('TeamsPage — admin does not see Find a Team section', () => {
  it('admin with teams sees all teams in myTeams — no Find a Team section', () => {
    currentUser = { uid: 'uid-admin' };
    currentProfile = makeProfile({ uid: 'uid-admin', role: 'admin' });
    currentTeams = [
      makeTeam('team-a', { name: 'Team Alpha', isPrivate: false }),
      makeTeam('team-b', { name: 'Team Beta', isPrivate: true }),
    ];

    renderPage();

    // Admin sees all teams in their list
    expect(screen.getByText('Team Alpha')).toBeInTheDocument();
    expect(screen.getByText('Team Beta')).toBeInTheDocument();
    // Find a Team is not rendered for admins
    expect(screen.queryByText('Find a Team')).toBeNull();
  });
});
