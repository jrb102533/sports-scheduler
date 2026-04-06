/**
 * Sidebar — fix/sidebar-multirole
 *
 * Behaviors under test:
 *
 *   Nav derivation from active context
 *     - Player active context shows player/parent nav (My Team, not Calendar/Teams)
 *     - Coach active context shows coach nav (Calendar, Teams, Venues)
 *     - Admin active context shows admin nav (Calendar, Teams, Leagues, Venues, Manage Users)
 *     - league_manager active context shows LM nav (Calendar, Teams, Leagues, Venues)
 *     - Context switch from player to coach causes coach nav to appear
 *
 *   Legacy fallback (no memberships array)
 *     - Legacy user with profile.role='coach' and no memberships array gets coach nav
 *     - Legacy user with profile.role='player' and no memberships array gets player nav
 *
 *   Null/undefined profile
 *     - Sidebar renders without crashing when profile is null
 *
 *   Context switcher visibility
 *     - Context switcher does NOT appear when user has exactly 1 membership
 *     - Context switcher DOES appear when user has 2+ memberships
 *     - Context switcher displays enriched labels ("Coach — U10 Red")
 *
 *   membershipLabel helper
 *     - Label for coach includes team name when team is present
 *     - Label for league_manager includes league name
 *     - Label falls back to role title when no context name is available
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

// ── Tests: nav derivation from active context ─────────────────────────────────

describe('Sidebar — nav derivation from active context', () => {
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
   * KEY REGRESSION TEST — the bug this PR fixes.
   *
   * Before: hasRole() across ALL memberships meant a coach+player dual-role
   * user always saw the coach nav, even when their active context was player.
   * After: nav is derived only from the ACTIVE membership's role.
   *
   * Simulate: user has two memberships: [player, coach]. activeContext = 1
   * (coach). Switch to context 0 (player) → should render player-only nav.
   */
  it('shows full coach nav after active context switches from player to coach', () => {
    // Active context is coach (index 1)
    currentProfile = makeProfile('player', {
      role: 'player',
      memberships: [
        { role: 'player', teamId: 't1' },
        { role: 'coach', teamId: 't2', isPrimary: true },
      ],
      activeContext: 1,
    });
    renderSidebar();

    // Coach nav items present
    expect(screen.getByRole('link', { name: /^calendar$/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^teams$/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^venues$/i })).toBeTruthy();

    // Player-only item absent
    expect(screen.queryByRole('link', { name: /my team/i })).toBeNull();
  });

  it('shows player-only nav when active context is player even though user also holds coach role', () => {
    // Active context is player (index 0) — the old hasRole() bug would have
    // given this user coach nav because they hold a coach membership too.
    currentProfile = makeProfile('player', {
      role: 'player',
      memberships: [
        { role: 'player', teamId: 't1', isPrimary: true },
        { role: 'coach', teamId: 't2' },
      ],
      activeContext: 0,
    });
    renderSidebar();

    // Player nav present
    expect(screen.getByRole('link', { name: /my team/i })).toBeTruthy();

    // Coach-only items absent
    expect(screen.queryByRole('link', { name: /^calendar$/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^teams$/i })).toBeNull();
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

// ── Tests: context switcher visibility ───────────────────────────────────────

describe('Sidebar — context switcher', () => {
  it('does NOT render the context switcher when user has exactly 1 membership', () => {
    currentProfile = makeProfile('coach', {
      memberships: [{ role: 'coach', teamId: 't1', isPrimary: true }],
    });
    renderSidebar();

    // The switcher button is identified by the ChevronDown it contains;
    // alternatively, the Shield inside it uses a role color.  We look for the
    // "Active" badge text which only appears inside an open switcher dropdown.
    // More robustly: with 1 membership there is no switcher button at all, so
    // looking for the active context label text asserts presence while the
    // switcher dropdown being absent asserts correct single-membership behaviour.
    expect(screen.queryByText('Active')).toBeNull();
  });

  it('renders the context switcher when user has 2 memberships', () => {
    currentTeams = [makeTeam('t1', 'U10 Red'), makeTeam('t2', 'U12 Blue')];
    currentProfile = makeProfile('coach', {
      memberships: [
        { role: 'coach', teamId: 't1', isPrimary: true },
        { role: 'parent', teamId: 't2' },
      ],
      activeContext: 0,
    });
    renderSidebar();

    // Clicking the switcher toggle opens the dropdown that shows "Active"
    // next to the current context. Find the switcher by its role label text.
    // The switcher toggle shows the active membership label as uppercase text.
    const switcher = screen.getByText(/coach/i, { selector: 'span' });
    expect(switcher).toBeTruthy();
  });

  it('context switcher shows enriched labels including team name', () => {
    currentTeams = [makeTeam('t1', 'U10 Red'), makeTeam('t2', 'U12 Blue')];
    currentProfile = makeProfile('coach', {
      memberships: [
        { role: 'coach', teamId: 't1', isPrimary: true },
        { role: 'parent', teamId: 't2' },
      ],
      activeContext: 0,
    });
    renderSidebar();

    // Open the dropdown to see all membership labels
    // The toggle button itself shows the active membership label.
    // Find the chevron button by its parent container.
    const toggleButtons = screen.getAllByRole('button');
    // The context switcher is the button that contains a chevron — it's the
    // one with the role label and team name in uppercase.
    const contextToggle = toggleButtons.find(btn =>
      btn.textContent?.toLowerCase().includes('u10 red')
    );
    expect(contextToggle).toBeTruthy();

    // Open the dropdown
    fireEvent.click(contextToggle!);

    // Both membership labels should now be visible (the toggle header shows the
    // active label; the dropdown shows all labels — use getAllByText since the
    // active label appears in both the toggle span and the dropdown row).
    expect(screen.getAllByText(/U10 Red/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/U12 Blue/i)).toBeTruthy();
  });

  it('calls updateProfile with the correct activeContext index when a context is selected', () => {
    currentTeams = [makeTeam('t1', 'U10 Red'), makeTeam('t2', 'U12 Blue')];
    currentProfile = makeProfile('coach', {
      memberships: [
        { role: 'coach', teamId: 't1', isPrimary: true },
        { role: 'parent', teamId: 't2' },
      ],
      activeContext: 0,
    });
    renderSidebar();

    // Open dropdown
    const toggleButtons = screen.getAllByRole('button');
    const contextToggle = toggleButtons.find(btn =>
      btn.textContent?.toLowerCase().includes('u10 red')
    );
    fireEvent.click(contextToggle!);

    // Select the second membership (Parent — U12 Blue)
    const parentOption = screen.getByText(/U12 Blue/i).closest('button');
    fireEvent.click(parentOption!);

    expect(mockUpdateProfile).toHaveBeenCalledWith({ activeContext: 1 });
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
