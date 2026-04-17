/**
 * ParentHomePage — resolveParentTeams logic tests
 *
 * The resolveParentTeams function determines which teams a parent/player sees.
 * It has several resolution paths:
 *   1. Membership with teamId → include that team
 *   2. Membership with playerId but no teamId → resolve via player record
 *   3. Legacy top-level profile.teamId → include that team
 *   4. Legacy profile.playerId (no teamId, no memberships) → resolve via player record
 *
 * This file tests the rendered ParentHomePage output for these paths.
 * Mock stores are used; no Firebase connection required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { UserProfile, Team, Player } from '@/types';

// ── Firebase stub ──────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, functions: {}, storage: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), onSnapshot: vi.fn(() => () => {}),
  query: vi.fn(), where: vi.fn(), orderBy: vi.fn(),
}));

// ── Navigate stub ─────────────────────────────────────────────────────────────
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

// ── Store mocks ───────────────────────────────────────────────────────────────
let currentProfile: UserProfile | null = null;
let currentTeams: Team[] = [];
let currentPlayers: Player[] = [];
let currentEvents: import('@/types').ScheduledEvent[] = [];

vi.mock('@/store/useAuthStore', async () => {
  const real = await vi.importActual<typeof import('@/store/useAuthStore')>('@/store/useAuthStore');
  return {
    ...real,
    useAuthStore: (selector: (s: { profile: UserProfile | null; user: null }) => unknown) =>
      selector({ profile: currentProfile, user: null }),
  };
});

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (sel: (s: { teams: Team[]; loading: boolean }) => unknown) =>
    sel({ teams: currentTeams, loading: false }),
}));

vi.mock('@/store/useEventStore', () => ({
  useEventStore: (sel: (s: { events: import('@/types').ScheduledEvent[]; loading: boolean }) => unknown) =>
    sel({ events: currentEvents, loading: false }),
}));

vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (sel: (s: { players: Player[] }) => unknown) =>
    sel({ players: currentPlayers }),
}));

vi.mock('@/components/events/RsvpButton', () => ({
  RsvpButton: () => null,
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { ParentHomePage } from '@/pages/ParentHomePage';
import { MemoryRouter } from 'react-router-dom';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'parent-uid',
    email: 'parent@example.com',
    displayName: 'Parent User',
    role: 'parent',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTeam(id: string, name: string): Team {
  return {
    id,
    name,
    sportType: 'soccer',
    color: '#ef4444',
    createdBy: 'coach-uid',
    ownerName: 'Coach',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as Team;
}

function makePlayer(id: string, teamId: string): Player {
  return {
    id,
    name: `Player ${id}`,
    teamId,
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as Player;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ParentHomePage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = null;
  currentTeams = [];
  currentPlayers = [];
  currentEvents = [];
});

// ── resolveParentTeams — membership with teamId ────────────────────────────────

describe('ParentHomePage — team resolution via membership teamId', () => {
  it('shows the team when membership has a teamId', () => {
    currentProfile = makeProfile({
      memberships: [{ role: 'parent', teamId: 'team-1', isPrimary: true }],
    });
    currentTeams = [makeTeam('team-1', 'Thunder FC')];

    renderPage();
    expect(screen.getByText('Thunder FC')).toBeInTheDocument();
  });

  it('does not show teams the parent is not a member of', () => {
    currentProfile = makeProfile({
      memberships: [{ role: 'parent', teamId: 'team-1', isPrimary: true }],
    });
    currentTeams = [makeTeam('team-1', 'Thunder FC'), makeTeam('team-2', 'Lightning FC')];

    renderPage();
    expect(screen.getByText('Thunder FC')).toBeInTheDocument();
    expect(screen.queryByText('Lightning FC')).not.toBeInTheDocument();
  });

  it('shows the primary team in the header when parent has memberships in multiple teams', () => {
    // ParentHomePage renders only the first (primary) team in the hero header.
    // Both teams' events appear in the upcoming section (not tested here).
    currentProfile = makeProfile({
      memberships: [
        { role: 'parent', teamId: 'team-1', isPrimary: true },
        { role: 'parent', teamId: 'team-2', isPrimary: false },
      ],
    });
    currentTeams = [makeTeam('team-1', 'Thunder FC'), makeTeam('team-2', 'Lightning FC')];

    renderPage();
    // Primary team (team-1) is shown in the hero header
    expect(screen.getByText('Thunder FC')).toBeInTheDocument();
  });
});

// ── resolveParentTeams — playerId resolution ──────────────────────────────────

describe('ParentHomePage — team resolution via playerId', () => {
  it('resolves team from player record when membership has playerId but no teamId', () => {
    currentProfile = makeProfile({
      memberships: [{ role: 'parent', playerId: 'player-1', isPrimary: true }],
    });
    currentTeams = [makeTeam('team-A', 'Rockets FC')];
    currentPlayers = [makePlayer('player-1', 'team-A')];

    renderPage();
    expect(screen.getByText('Rockets FC')).toBeInTheDocument();
  });
});

// ── resolveParentTeams — legacy scalar fields ─────────────────────────────────

describe('ParentHomePage — legacy scalar field resolution', () => {
  it('shows team from top-level profile.teamId (legacy)', () => {
    currentProfile = makeProfile({
      teamId: 'team-legacy',
      memberships: undefined,
    });
    currentTeams = [makeTeam('team-legacy', 'Legacy FC')];

    renderPage();
    expect(screen.getByText('Legacy FC')).toBeInTheDocument();
  });
});

// ── Empty state ───────────────────────────────────────────────────────────────

describe('ParentHomePage — empty state', () => {
  it('renders without crashing when profile is null', () => {
    currentProfile = null;
    const { container } = renderPage();
    // Should not crash — renders an empty or loading state
    expect(container).toBeTruthy();
  });

  it('renders without crashing when parent has no teams', () => {
    currentProfile = makeProfile({ memberships: [] });
    currentTeams = [];
    renderPage();
    // No team card expected; page should still render
    expect(screen.queryByText('Thunder FC')).not.toBeInTheDocument();
  });
});

// ── Event filtering ───────────────────────────────────────────────────────────

describe('ParentHomePage — upcoming event filtering', () => {
  it('shows upcoming events for teams the parent belongs to', () => {
    currentProfile = makeProfile({
      memberships: [{ role: 'parent', teamId: 'team-1', isPrimary: true }],
    });
    currentTeams = [makeTeam('team-1', 'Thunder FC')];
    currentEvents = [{
      id: 'e1',
      title: 'Game vs Rivals',
      type: 'game',
      status: 'scheduled',
      date: '2099-01-01', // far future
      startTime: '10:00',
      teamIds: ['team-1'],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    } as import('@/types').ScheduledEvent];

    renderPage();
    expect(screen.getByText('Game vs Rivals')).toBeInTheDocument();
  });

  it('excludes cancelled events', () => {
    currentProfile = makeProfile({
      memberships: [{ role: 'parent', teamId: 'team-1', isPrimary: true }],
    });
    currentTeams = [makeTeam('team-1', 'Thunder FC')];
    currentEvents = [{
      id: 'e2',
      title: 'Cancelled Game',
      type: 'game',
      status: 'cancelled',
      date: '2099-01-01',
      startTime: '10:00',
      teamIds: ['team-1'],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    } as import('@/types').ScheduledEvent];

    renderPage();
    expect(screen.queryByText('Cancelled Game')).not.toBeInTheDocument();
  });

  it('excludes events for teams the parent does not belong to', () => {
    currentProfile = makeProfile({
      memberships: [{ role: 'parent', teamId: 'team-1', isPrimary: true }],
    });
    currentTeams = [makeTeam('team-1', 'Thunder FC'), makeTeam('team-2', 'Other FC')];
    currentEvents = [{
      id: 'e3',
      title: 'Other Team Game',
      type: 'game',
      status: 'scheduled',
      date: '2099-01-01',
      startTime: '10:00',
      teamIds: ['team-2'], // team-2 only
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    } as import('@/types').ScheduledEvent];

    renderPage();
    expect(screen.queryByText('Other Team Game')).not.toBeInTheDocument();
  });
});
