/**
 * LeaguesPage — private team filtering in LeagueForm allTeams prop
 *
 * When opening a league's edit form, LeaguesPage passes:
 *   allTeams={teams.filter(t => !t.isPrivate || isAdmin)}
 *
 * This means:
 *   - Non-admins (LMs) must NOT see private teams in the league assignment list
 *   - Admins CAN see private teams in the league assignment list
 *
 * Behaviors under test:
 *   1. LM opening LeagueForm receives allTeams without private teams
 *   2. Admin opening LeagueForm receives allTeams including private teams
 *   3. Non-private teams are always included in allTeams for LMs
 *   4. Mix: LM sees public teams but not private teams in allTeams
 *
 * Note: LeagueForm is stubbed. We inspect the prop passed to it rather
 * than the internal rendered state, because the filter is on the prop.
 * We capture allTeams via the mock's props.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile, League, Team } from '@/types';

// ─── Firebase stub ─────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
}));

// ─── navigate stub ─────────────────────────────────────────────────────────────
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

// ─── Auth store ───────────────────────────────────────────────────────────────
let currentProfile: UserProfile | null = null;

vi.mock('@/store/useAuthStore', async () => {
  const real = await vi.importActual<typeof import('@/store/useAuthStore')>('@/store/useAuthStore');
  return {
    ...real,
    useAuthStore: (selector?: (s: object) => unknown) => {
      const state = { profile: currentProfile, updateProfile: vi.fn().mockResolvedValue(undefined) };
      return selector ? selector(state) : state;
    },
  };
});

// ─── League store ─────────────────────────────────────────────────────────────
let currentLeagues: League[] = [];

vi.mock('@/store/useLeagueStore', () => ({
  useLeagueStore: (selector?: (s: object) => unknown) => {
    const state = {
      leagues: currentLeagues,
      addLeague: vi.fn().mockResolvedValue(undefined),
      updateLeague: vi.fn().mockResolvedValue(undefined),
      deleteLeague: vi.fn().mockResolvedValue(undefined),
    };
    return selector ? selector(state) : state;
  },
}));

// ─── Team store ───────────────────────────────────────────────────────────────
let currentTeams: Team[] = [];

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector?: (s: object) => unknown) => {
    const state = {
      teams: currentTeams,
      addTeamToLeague: vi.fn(),
      removeTeamFromLeague: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

// ─── LeagueForm: capture the allTeams prop ───────────────────────────────────
let capturedAllTeams: Team[] = [];

vi.mock('@/components/leagues/LeagueForm', () => ({
  LeagueForm: ({ open, allTeams }: { open: boolean; allTeams: Team[] }) => {
    if (open) capturedAllTeams = allTeams;
    return open ? <div role="dialog" aria-label="league-form" /> : null;
  },
}));

vi.mock('@/components/onboarding/BecomeLeagueManagerModal', () => ({
  BecomeLeagueManagerModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="become-lm-modal" /> : null,
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { LeaguesPage } from '@/pages/LeaguesPage';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeProfile(role: UserProfile['role'], uid = 'uid-lm', overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid,
    email: 'user@example.com',
    displayName: 'Test User',
    role,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeLeague(id: string, uid: string): League {
  return {
    id,
    name: `League ${id}`,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    managerIds: [uid],
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
      <LeaguesPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = null;
  currentLeagues = [];
  currentTeams = [];
  capturedAllTeams = [];
});

// ─── allTeams prop filtering ───────────────────────────────────────────────────

describe('LeaguesPage — allTeams prop excludes private teams for non-admins', () => {
  it('LM opening a league form does not receive private teams in allTeams', async () => {
    const uid = 'uid-lm';
    currentProfile = makeProfile('league_manager', uid, {
      memberships: [{ role: 'league_manager', leagueId: 'lg-1' }],
    });
    currentLeagues = [makeLeague('lg-1', uid)];
    currentTeams = [
      makeTeam('team-public', { name: 'Public Team', isPrivate: false }),
      makeTeam('team-private', { name: 'Private Team', isPrivate: true }),
    ];

    renderPage();

    // Open the edit form via the pencil button — find it by svg + blue hover class
    const pencilBtns = Array.from(document.querySelectorAll('button')).filter(b =>
      b.querySelector('svg') && b.className.includes('hover:text-blue')
    );
    fireEvent.click(pencilBtns[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'league-form' })).toBeInTheDocument();
    });

    const ids = capturedAllTeams.map(t => t.id);
    expect(ids).toContain('team-public');
    expect(ids).not.toContain('team-private');
  });

  it('Admin opening a league form receives both private and public teams in allTeams', async () => {
    const uid = 'uid-admin';
    currentProfile = makeProfile('admin', uid);
    currentLeagues = [makeLeague('lg-1', uid)];
    currentTeams = [
      makeTeam('team-public', { name: 'Public Team', isPrivate: false }),
      makeTeam('team-private', { name: 'Private Team', isPrivate: true }),
    ];

    renderPage();

    // Admin has edit access, open via pencil button
    const pencilBtns = Array.from(document.querySelectorAll('button')).filter(b =>
      b.querySelector('svg') && b.className.includes('hover:text-blue')
    );
    fireEvent.click(pencilBtns[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'league-form' })).toBeInTheDocument();
    });

    const ids = capturedAllTeams.map(t => t.id);
    expect(ids).toContain('team-public');
    expect(ids).toContain('team-private');
  });

  it('LM sees only non-private teams in a mixed team list', async () => {
    const uid = 'uid-lm';
    currentProfile = makeProfile('league_manager', uid, {
      memberships: [{ role: 'league_manager', leagueId: 'lg-1' }],
    });
    currentLeagues = [makeLeague('lg-1', uid)];
    currentTeams = [
      makeTeam('team-a', { name: 'Alpha', isPrivate: false }),
      makeTeam('team-b', { name: 'Beta', isPrivate: true }),
      makeTeam('team-c', { name: 'Gamma', isPrivate: false }),
      makeTeam('team-d', { name: 'Delta', isPrivate: true }),
    ];

    renderPage();

    const pencilBtns = Array.from(document.querySelectorAll('button')).filter(b =>
      b.querySelector('svg') && b.className.includes('hover:text-blue')
    );
    fireEvent.click(pencilBtns[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'league-form' })).toBeInTheDocument();
    });

    const ids = capturedAllTeams.map(t => t.id);
    expect(ids).toEqual(expect.arrayContaining(['team-a', 'team-c']));
    expect(ids).not.toContain('team-b');
    expect(ids).not.toContain('team-d');
  });

  it('treats isPrivate: undefined as public — team is included for LMs', async () => {
    const uid = 'uid-lm';
    currentProfile = makeProfile('league_manager', uid, {
      memberships: [{ role: 'league_manager', leagueId: 'lg-1' }],
    });
    currentLeagues = [makeLeague('lg-1', uid)];
    currentTeams = [
      makeTeam('team-legacy', { name: 'Legacy Team', isPrivate: undefined }),
    ];

    renderPage();

    const pencilBtns = Array.from(document.querySelectorAll('button')).filter(b =>
      b.querySelector('svg') && b.className.includes('hover:text-blue')
    );
    fireEvent.click(pencilBtns[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'league-form' })).toBeInTheDocument();
    });

    const ids = capturedAllTeams.map(t => t.id);
    expect(ids).toContain('team-legacy');
  });
});
