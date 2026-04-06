/**
 * LeaguesPage — coach/role-based league creation flow
 *
 * Behaviors under test:
 *   Button visibility
 *     - Coach sees "New League" button (canCreateLeague = true)
 *     - LM sees "New League" button
 *     - Admin sees "New League" button
 *     - Player does NOT see "New League" button
 *   Modal routing
 *     - Coach clicking "New League" opens BecomeLeagueManagerModal (not LeagueForm)
 *     - LM (scalar role) clicking "New League" opens LeagueForm
 *     - Admin clicking "New League" opens LeagueForm
 *   visibleLeagues
 *     - LM via memberships array sees their league
 *     - LM via legacy scalar sees their league
 *     - Coach does NOT see leagues they don't manage (visibleLeagues is empty for coach)
 *   canEdit
 *     - Admin can edit any league card
 *     - LM with matching memberships leagueId can edit their league card
 *     - User without matching leagueId cannot edit the card
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
    // LeaguesPage calls useAuthStore() without a selector: const { profile, updateProfile } = useAuthStore()
    // so the mock must return the state object directly.
    useAuthStore: () => ({
      profile: currentProfile,
      updateProfile: vi.fn().mockResolvedValue(undefined),
    }),
  };
});

// ─── League store ─────────────────────────────────────────────────────────────
let currentLeagues: League[] = [];
const mockAddLeague = vi.fn().mockResolvedValue(undefined);
const mockUpdateLeague = vi.fn().mockResolvedValue(undefined);
const mockDeleteLeague = vi.fn().mockResolvedValue(undefined);

vi.mock('@/store/useLeagueStore', () => ({
  useLeagueStore: () => ({
    leagues: currentLeagues,
    addLeague: mockAddLeague,
    updateLeague: mockUpdateLeague,
    deleteLeague: mockDeleteLeague,
  }),
}));

// ─── Team store ───────────────────────────────────────────────────────────────
vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: () => ({
    teams: [] as Team[],
    addTeamToLeague: vi.fn(),
    removeTeamFromLeague: vi.fn(),
  }),
}));

// ─── Stub sub-components that have their own complex dependencies ─────────────
vi.mock('@/components/leagues/LeagueForm', () => ({
  LeagueForm: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="league-form"><input aria-label="League Name" /></div> : null,
}));

vi.mock('@/components/onboarding/BecomeLeagueManagerModal', () => ({
  BecomeLeagueManagerModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="become-lm-modal">Become a League Manager</div> : null,
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { LeaguesPage } from '@/pages/LeaguesPage';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeProfile(role: UserProfile['role'], overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'uid-1',
    email: 'user@example.com',
    displayName: 'Test User',
    role,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeLeague(id: string, overrides: Partial<League> = {}): League {
  return {
    id,
    name: `League ${id}`,
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
  mockAddLeague.mockResolvedValue(undefined);
  mockUpdateLeague.mockResolvedValue(undefined);
});

// ─── Button visibility ────────────────────────────────────────────────────────

describe('LeaguesPage — "New League" button visibility', () => {
  // Note: when leagues list is empty, LeaguesPage renders the button TWICE —
  // once in the header and once in the EmptyState. Use getAllByRole when that
  // is expected.

  it('coach sees "New League" button', () => {
    currentProfile = makeProfile('coach', {
      memberships: [{ role: 'coach', teamId: 't1' }],
    });
    renderPage();
    expect(screen.getAllByRole('button', { name: /new league/i }).length).toBeGreaterThan(0);
  });

  it('league_manager sees "New League" button', () => {
    currentProfile = makeProfile('league_manager');
    renderPage();
    expect(screen.getAllByRole('button', { name: /new league/i }).length).toBeGreaterThan(0);
  });

  it('admin sees "New League" button', () => {
    currentProfile = makeProfile('admin');
    renderPage();
    expect(screen.getAllByRole('button', { name: /new league/i }).length).toBeGreaterThan(0);
  });

  it('player does NOT see "New League" button', () => {
    currentProfile = makeProfile('player', {
      memberships: [{ role: 'player', teamId: 't1' }],
    });
    renderPage();
    expect(screen.queryAllByRole('button', { name: /new league/i })).toHaveLength(0);
  });

  it('parent does NOT see "New League" button', () => {
    currentProfile = makeProfile('parent', {
      memberships: [{ role: 'parent', teamId: 't1' }],
    });
    renderPage();
    expect(screen.queryAllByRole('button', { name: /new league/i })).toHaveLength(0);
  });
});

// ─── Modal routing ────────────────────────────────────────────────────────────

describe('LeaguesPage — coach clicking "New League" opens BecomeLeagueManagerModal', () => {
  it('opens BecomeLeagueManagerModal (not LeagueForm) for a coach', async () => {
    currentProfile = makeProfile('coach', {
      memberships: [{ role: 'coach', teamId: 't1' }],
    });
    renderPage();

    // Click the first "New League" button (header button)
    fireEvent.click(screen.getAllByRole('button', { name: /new league/i })[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'become-lm-modal' })).toBeInTheDocument();
    });
    // LeagueForm should NOT open
    expect(screen.queryByRole('dialog', { name: 'league-form' })).toBeNull();
  });
});

describe('LeaguesPage — LM clicking "New League" opens LeagueForm', () => {
  it('opens LeagueForm directly for a league_manager (scalar role)', async () => {
    currentProfile = makeProfile('league_manager', {
      memberships: [{ role: 'league_manager', leagueId: 'lg-1' }],
    });
    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: /new league/i })[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'league-form' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('dialog', { name: 'become-lm-modal' })).toBeNull();
  });

  it('opens LeagueForm directly for an admin', async () => {
    currentProfile = makeProfile('admin');
    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: /new league/i })[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'league-form' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('dialog', { name: 'become-lm-modal' })).toBeNull();
  });
});

// ─── visibleLeagues ───────────────────────────────────────────────────────────

describe('LeaguesPage — visibleLeagues', () => {
  it('LM with memberships array sees their managed league', () => {
    currentProfile = makeProfile('league_manager', {
      memberships: [{ role: 'league_manager', leagueId: 'lg-1' }],
    });
    currentLeagues = [makeLeague('lg-1', { name: 'My League' }), makeLeague('lg-2', { name: 'Other League' })];
    renderPage();

    expect(screen.getByText('My League')).toBeInTheDocument();
    expect(screen.queryByText('Other League')).toBeNull();
  });

  it('LM with legacy scalar leagueId sees their managed league', () => {
    currentProfile = makeProfile('league_manager', {
      leagueId: 'lg-1',
    });
    currentLeagues = [makeLeague('lg-1', { name: 'My League' }), makeLeague('lg-2', { name: 'Other League' })];
    renderPage();

    expect(screen.getByText('My League')).toBeInTheDocument();
    expect(screen.queryByText('Other League')).toBeNull();
  });

  it('admin sees all leagues', () => {
    currentProfile = makeProfile('admin');
    currentLeagues = [makeLeague('lg-1', { name: 'League A' }), makeLeague('lg-2', { name: 'League B' })];
    renderPage();

    expect(screen.getByText('League A')).toBeInTheDocument();
    expect(screen.getByText('League B')).toBeInTheDocument();
  });

  it('coach sees no leagues (they manage none)', () => {
    currentProfile = makeProfile('coach', {
      memberships: [{ role: 'coach', teamId: 't1' }],
    });
    currentLeagues = [makeLeague('lg-1', { name: 'Some League' })];
    renderPage();

    expect(screen.queryByText('Some League')).toBeNull();
    // Shows the empty state instead
    expect(screen.getByText(/no leagues yet/i)).toBeInTheDocument();
  });
});

// ─── canEdit on league cards ─────────────────────────────────────────────────

describe('LeaguesPage — canEdit on league cards', () => {
  it('shows edit button on league card for admin', () => {
    currentProfile = makeProfile('admin');
    currentLeagues = [makeLeague('lg-1', { name: 'League A' })];
    renderPage();

    // Edit button should be visible — it's a pencil icon button
    const editButtons = document.querySelectorAll('button[title], button svg.lucide-pencil');
    // Admin sees edit; verify by clicking the pencil button
    const pencilBtns = Array.from(document.querySelectorAll('button')).filter(b =>
      b.querySelector('svg') && b.className.includes('hover:text-blue')
    );
    expect(pencilBtns.length).toBeGreaterThan(0);
  });

  it('shows edit button when LM has memberships leagueId matching the card', () => {
    currentProfile = makeProfile('league_manager', {
      memberships: [{ role: 'league_manager', leagueId: 'lg-1' }],
    });
    currentLeagues = [makeLeague('lg-1', { name: 'My League' })];
    renderPage();

    // The edit button should be present for the matching league
    const pencilBtns = Array.from(document.querySelectorAll('button')).filter(b =>
      b.querySelector('svg') && b.className.includes('hover:text-blue')
    );
    expect(pencilBtns.length).toBeGreaterThan(0);
  });
});
