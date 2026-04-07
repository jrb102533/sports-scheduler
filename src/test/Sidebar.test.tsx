/**
 * Sidebar — union-role nav derivation
 *
 * Behaviors under test:
 *
 *   Nav derivation from union of ALL memberships
 *     - Player-only user shows player/parent nav (My Team, not Calendar/Teams)
 *     - Coach user shows coach nav (Calendar, Teams, Venues)
 *     - Admin user shows admin nav (Calendar, Teams, Leagues, Venues, Manage Users)
 *     - league_manager user shows LM nav (Calendar, Teams, Leagues, Venues)
 *     - User with BOTH player and coach memberships sees elevated (coach) nav
 *
 *   Legacy fallback (no memberships array)
 *     - Legacy user with profile.role='coach' and no memberships array gets coach nav
 *     - Legacy user with profile.role='player' and no memberships array gets player nav
 *
 *   Null/undefined profile
 *     - Sidebar renders without crashing when profile is null
 *
 *   ProfilePage — Edit button visibility
 *     - Edit button is hidden for coach users (only admin can self-edit memberships)
 *     - Edit button is hidden for player users
 *     - Edit button is hidden for parent users
 *     - "Roles are assigned by your league administrator." note shown to player
 *     - Note NOT shown to coach
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile, Team } from '@/types';

// ── Firebase stub ─────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
}));

// ── Router ────────────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// ── Auth store ────────────────────────────────────────────────────────────────
// useAuthStore in Sidebar is called WITHOUT a selector (destructuring), so the
// mock must return the state object directly. We also re-export the REAL
// getMemberships and getActiveMembership so the derivation logic runs as-is.
let currentProfile: UserProfile | null = null;
const mockUpdateProfile = vi.fn().mockResolvedValue(undefined);
const mockLogout = vi.fn();

vi.mock('@/store/useAuthStore', async () => {
  const real = await vi.importActual<typeof import('@/store/useAuthStore')>('@/store/useAuthStore');
  return {
    ...real,
    useAuthStore: (selector?: (s: object) => unknown) => {
      const state = { user: { uid: 'uid-1', email: 'user@example.com' }, profile: currentProfile, logout: mockLogout, updateProfile: mockUpdateProfile };
      return selector ? selector(state) : state;
    },
  };
});

// ── Notification store ────────────────────────────────────────────────────────
vi.mock('@/store/useNotificationStore', () => ({
  useNotificationStore: (sel: (s: { notifications: never[] }) => unknown) =>
    sel({ notifications: [] }),
}));

// ── Settings store ────────────────────────────────────────────────────────────
vi.mock('@/store/useSettingsStore', () => ({
  useSettingsStore: (sel: (s: { settings: { kidsSportsMode: boolean } }) => unknown) =>
    sel({ settings: { kidsSportsMode: false } }),
}));

// ── Event store ───────────────────────────────────────────────────────────────
vi.mock('@/store/useEventStore', () => ({
  useEventStore: (sel: (s: { events: never[] }) => unknown) =>
    sel({ events: [] }),
}));

// ── Team / League stores ──────────────────────────────────────────────────────
let currentTeams: Team[] = [];

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (sel: (s: { teams: Team[] }) => unknown) =>
    sel({ teams: currentTeams }),
}));

vi.mock('@/store/useLeagueStore', () => ({
  useLeagueStore: (sel: (s: { leagues: never[] }) => unknown) =>
    sel({ leagues: [] }),
}));

// ── Feature flags ─────────────────────────────────────────────────────────────
vi.mock('@/lib/flags', () => ({
  FLAGS: { KIDS_MODE: false },
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { Sidebar } from '@/components/layout/Sidebar';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeProfile(role: UserProfile['role'], overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'uid-1',
    email: 'user@example.com',
    displayName: 'Jane Coach',
    role,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTeam(id: string, name: string): Team {
  return {
    id,
    name,
    sportType: 'soccer',
    color: '#1d4ed8',
    createdBy: 'uid-1',
    ownerName: 'Jane Coach',
    coachId: 'uid-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>
  );
}

// ── Reset ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = null;
  currentTeams = [];
});

// ── Tests: nav derivation from union of memberships ──────────────────────────

describe('Sidebar — nav derivation from union of memberships', () => {
  it('shows "My Team" nav item for a player active context', () => {
    currentProfile = makeProfile('player', {
      memberships: [{ role: 'player', teamId: 't1', isPrimary: true }],
      activeContext: 0,
    });
    renderSidebar();

    expect(screen.getByRole('link', { name: /my team/i })).toBeTruthy();
  });

  it('does NOT show Calendar or Teams nav items for a player active context', () => {
    currentProfile = makeProfile('player', {
      memberships: [{ role: 'player', teamId: 't1', isPrimary: true }],
      activeContext: 0,
    });
    renderSidebar();

    expect(screen.queryByRole('link', { name: /^calendar$/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^teams$/i })).toBeNull();
  });

  it('shows Calendar and Teams nav items for a coach active context', () => {
    currentProfile = makeProfile('coach', {
      memberships: [{ role: 'coach', teamId: 't1', isPrimary: true }],
      activeContext: 0,
    });
    renderSidebar();

    expect(screen.getByRole('link', { name: /^calendar$/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^teams$/i })).toBeTruthy();
  });

  it('shows Venues nav item for coach active context', () => {
    currentProfile = makeProfile('coach', {
      memberships: [{ role: 'coach', teamId: 't1', isPrimary: true }],
      activeContext: 0,
    });
    renderSidebar();

    expect(screen.getByRole('link', { name: /^venues$/i })).toBeTruthy();
  });

  it('does NOT show Venues nav item for a player active context', () => {
    currentProfile = makeProfile('player', {
      memberships: [{ role: 'player', teamId: 't1', isPrimary: true }],
      activeContext: 0,
    });
    renderSidebar();

    expect(screen.queryByRole('link', { name: /^venues$/i })).toBeNull();
  });

  it('shows Leagues nav item for admin active context', () => {
    currentProfile = makeProfile('admin', {
      memberships: [{ role: 'admin', isPrimary: true }],
      activeContext: 0,
    });
    renderSidebar();

    expect(screen.getByRole('link', { name: /^leagues$/i })).toBeTruthy();
  });

  it('shows Manage Users nav item for admin active context', () => {
    currentProfile = makeProfile('admin', {
      memberships: [{ role: 'admin', isPrimary: true }],
      activeContext: 0,
    });
    renderSidebar();

    expect(screen.getByRole('link', { name: /manage users/i })).toBeTruthy();
  });

  it('does NOT show Manage Users for a coach active context', () => {
    currentProfile = makeProfile('coach', {
      memberships: [{ role: 'coach', teamId: 't1', isPrimary: true }],
      activeContext: 0,
    });
    renderSidebar();

    expect(screen.queryByRole('link', { name: /manage users/i })).toBeNull();
  });

  it('shows Leagues nav item for league_manager active context', () => {
    currentProfile = makeProfile('league_manager', {
      memberships: [{ role: 'league_manager', leagueId: 'l1', isPrimary: true }],
      activeContext: 0,
    });
    renderSidebar();

    expect(screen.getByRole('link', { name: /^leagues$/i })).toBeTruthy();
  });

  it('does NOT show Manage Users for a league_manager active context', () => {
    currentProfile = makeProfile('league_manager', {
      memberships: [{ role: 'league_manager', leagueId: 'l1', isPrimary: true }],
      activeContext: 0,
    });
    renderSidebar();

    expect(screen.queryByRole('link', { name: /manage users/i })).toBeNull();
  });

  /**
   * Union-role behavior: a user holding BOTH player and coach memberships
   * always sees elevated (coach) nav regardless of activeContext, because the
   * nav is derived from the union of ALL memberships.
   */
  it('shows elevated nav when user holds both player and coach memberships', () => {
    currentProfile = makeProfile('player', {
      role: 'player',
      memberships: [
        { role: 'player', teamId: 't1', isPrimary: true },
        { role: 'coach', teamId: 't2' },
      ],
      activeContext: 0,
    });
    renderSidebar();

    // Coach nav items present (coach is in the union)
    expect(screen.getByRole('link', { name: /^calendar$/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^teams$/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^venues$/i })).toBeTruthy();

    // Player-only item absent (elevated nav takes over)
    expect(screen.queryByRole('link', { name: /my team/i })).toBeNull();

    // Admin-only items absent
    expect(screen.queryByRole('link', { name: /manage users/i })).toBeNull();
  });
});

// ── Tests: legacy fallback (no memberships array) ─────────────────────────────

describe('Sidebar — legacy fallback (profile.role, no memberships array)', () => {
  it('gives coach nav to a legacy user with profile.role=coach and no memberships array', () => {
    // No memberships field — getMemberships() synthesises one from profile.role
    currentProfile = makeProfile('coach', { teamId: 't1' });
    // Explicitly ensure no memberships key
    delete (currentProfile as Partial<UserProfile>).memberships;
    renderSidebar();

    expect(screen.getByRole('link', { name: /^calendar$/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^teams$/i })).toBeTruthy();
  });

  it('gives player nav to a legacy user with profile.role=player and no memberships array', () => {
    currentProfile = makeProfile('player', { teamId: 't1' });
    delete (currentProfile as Partial<UserProfile>).memberships;
    renderSidebar();

    expect(screen.getByRole('link', { name: /my team/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^calendar$/i })).toBeNull();
  });

  it('falls back to player nav when profile is null (activeRole defaults to player)', () => {
    currentProfile = null;
    renderSidebar();

    // Should not throw; player-mode nav renders
    expect(screen.queryByRole('link', { name: /^calendar$/i })).toBeNull();
  });
});

// ── Tests: no context switcher (removed) ─────────────────────────────────────

describe('Sidebar — context switcher removed', () => {
  it('does not render any "Active" badge text regardless of membership count', () => {
    currentTeams = [makeTeam('t1', 'U10 Red'), makeTeam('t2', 'U12 Blue')];
    currentProfile = makeProfile('coach', {
      memberships: [
        { role: 'coach', teamId: 't1', isPrimary: true },
        { role: 'parent', teamId: 't2' },
      ],
      activeContext: 0,
    });
    renderSidebar();

    expect(screen.queryByText('Active')).toBeNull();
  });

  it('does not render a team-name context toggle button for multi-membership users', () => {
    currentTeams = [makeTeam('t1', 'U10 Red'), makeTeam('t2', 'U12 Blue')];
    currentProfile = makeProfile('coach', {
      memberships: [
        { role: 'coach', teamId: 't1', isPrimary: true },
        { role: 'parent', teamId: 't2' },
      ],
      activeContext: 0,
    });
    renderSidebar();

    const buttons = screen.getAllByRole('button');
    const contextToggle = buttons.find(btn =>
      btn.textContent?.toLowerCase().includes('u10 red')
    );
    expect(contextToggle).toBeUndefined();
  });
});

// ── Tests: ProfilePage Edit button visibility ─────────────────────────────────
// These tests cover the canEditRoles guard added in ProfilePage.tsx.
// ProfilePage.tsx is already mocked via vi.mock in other test files, but here
// we test the Sidebar-adjacent behaviour: that the guard is based on
// profile.role (primary role field), not activeMembership.role.

describe('ProfilePage — Edit button visibility (canEditRoles guard)', () => {
  // We re-use the ProfilePage module directly here with a targeted mock.
  // Set up a second minimal mock context for ProfilePage.

  let ProfilePage: typeof import('@/pages/ProfilePage').ProfilePage;

  const mockUpdateProfilePP = vi.fn().mockResolvedValue(undefined);
  const mockLogoutPP = vi.fn();
  let ppProfile: UserProfile | null;

  beforeEach(async () => {
    ppProfile = null;
    vi.doMock('@/store/useAuthStore', async () => {
      const real = await vi.importActual<typeof import('@/store/useAuthStore')>('@/store/useAuthStore');
      return {
        ...real,
        useAuthStore: (selector?: (s: object) => unknown) => {
          const state = { profile: ppProfile, updateProfile: mockUpdateProfilePP, logout: mockLogoutPP };
          return selector ? selector(state) : state;
        },
      };
    });
    vi.doMock('@/store/useTeamStore', () => ({
      useTeamStore: (sel: (s: { teams: never[] }) => unknown) => sel({ teams: [] }),
    }));
    vi.doMock('@/store/useLeagueStore', () => ({
      useLeagueStore: (sel: (s: { leagues: never[] }) => unknown) => sel({ leagues: [] }),
    }));
    vi.doMock('@/store/usePlayerStore', () => ({
      usePlayerStore: (sel: (s: { players: never[] }) => unknown) => sel({ players: [] }),
    }));
    vi.doMock('@/components/auth/RoleCardPicker', () => ({
      ROLE_DEFINITIONS: [],
      RoleCardPicker: () => null,
    }));
    ({ ProfilePage } = await import('@/pages/ProfilePage'));
  });

  function renderProfilePage() {
    return render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    );
  }

  it('hides the Edit button in My Roles for a coach user', () => {
    ppProfile = makeProfile('coach', {
      memberships: [{ role: 'coach', isPrimary: true }],
    });
    renderProfilePage();

    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
  });

  it('does not show an Edit button in My Roles for an admin user (role editor removed in #279)', () => {
    ppProfile = makeProfile('admin', {
      memberships: [{ role: 'admin', isPrimary: true }],
    });
    renderProfilePage();

    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
  });

  it('hides the Edit button in My Roles for a player user', () => {
    ppProfile = makeProfile('player', {
      memberships: [{ role: 'player', teamId: 't1', isPrimary: true }],
    });
    renderProfilePage();

    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
  });

  it('hides the Edit button in My Roles for a parent user', () => {
    ppProfile = makeProfile('parent', {
      memberships: [{ role: 'parent', teamId: 't1', isPrimary: true }],
    });
    renderProfilePage();

    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
  });

  it('does not show the admin note for a player user (note removed in #279)', () => {
    ppProfile = makeProfile('player', {
      memberships: [{ role: 'player', teamId: 't1', isPrimary: true }],
    });
    renderProfilePage();

    expect(
      screen.queryByText(/roles are assigned by your league administrator/i)
    ).toBeNull();
  });

  it('does not show the admin note for a coach user (note removed in #279)', () => {
    ppProfile = makeProfile('coach', {
      memberships: [{ role: 'coach', isPrimary: true }],
    });
    renderProfilePage();

    expect(
      screen.queryByText(/roles are assigned by your league administrator/i)
    ).toBeNull();
  });

  it('does not show the admin note for a parent user when memberships is empty (note removed in #279)', () => {
    ppProfile = makeProfile('parent');
    delete (ppProfile as Partial<UserProfile>).memberships;
    renderProfilePage();

    expect(
      screen.queryByText(/roles are assigned by your league administrator/i)
    ).toBeNull();
  });
});
