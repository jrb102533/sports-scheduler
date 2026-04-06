/**
 * HomePage — Get Started CTA role visibility (PR fix/user-journey-blocks)
 *
 * The "Get started" card shows:
 *   - "Create a Team" button: all non-admins (coaches, LMs, parents, players)
 *   - "Create a League" button: shown unless the user already has an LM membership
 *   - Both CTAs: hidden for admins
 *
 * Behaviors under test:
 *   - Coach sees both "Create a Team" AND "Create a League" CTAs
 *   - LM (who already has an LM membership) sees "Create a Team" but NOT "Create a League"
 *   - Admin sees NEITHER CTA (entire CTA section hidden)
 *   - Parent/player sees both buttons (non-elevated users can request both roles)
 *   - Multi-role user who is already LM does not see the "Create a League" button
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile } from '@/types';

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
    useAuthStore: (selector: (s: { profile: UserProfile | null }) => unknown) =>
      selector({ profile: currentProfile }),
  };
});

// ─── Team / Event stores — empty, not relevant to CTA tests ──────────────────
vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector: (s: { teams: []; loading: boolean }) => unknown) =>
    selector({ teams: [], loading: false }),
}));

vi.mock('@/store/useEventStore', () => ({
  useEventStore: (selector: (s: { events: []; loading: boolean }) => unknown) =>
    selector({ events: [], loading: false }),
}));

// ─── Stub heavy sub-components ────────────────────────────────────────────────
vi.mock('@/components/events/EventDetailPanel', () => ({ EventDetailPanel: () => null }));
vi.mock('@/components/events/EventCard', () => ({ EventCard: () => null }));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { HomePage } from '@/pages/HomePage';

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

function renderPage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = null;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HomePage — "Get Started" CTA visibility by role', () => {
  it('coach sees "Create a Team" CTA', () => {
    currentProfile = makeProfile('coach', {
      memberships: [{ role: 'coach', teamId: 't1' }],
    });
    renderPage();

    expect(screen.getByRole('button', { name: /create a team/i })).toBeInTheDocument();
  });

  it('coach sees "Create a League" CTA (no existing LM membership)', () => {
    currentProfile = makeProfile('coach', {
      memberships: [{ role: 'coach', teamId: 't1' }],
    });
    renderPage();

    expect(screen.getByRole('button', { name: /create a league/i })).toBeInTheDocument();
  });

  it('LM (who already has LM membership) sees "Create a Team" CTA', () => {
    currentProfile = makeProfile('league_manager', {
      memberships: [{ role: 'league_manager', leagueId: 'lg-1' }],
    });
    renderPage();

    expect(screen.getByRole('button', { name: /create a team/i })).toBeInTheDocument();
  });

  it('LM with existing membership does NOT see "Create a League" CTA', () => {
    currentProfile = makeProfile('league_manager', {
      memberships: [{ role: 'league_manager', leagueId: 'lg-1' }],
    });
    renderPage();

    expect(screen.queryByRole('button', { name: /create a league/i })).toBeNull();
  });

  it('admin sees NEITHER "Create a Team" nor "Create a League" CTA', () => {
    currentProfile = makeProfile('admin');
    renderPage();

    expect(screen.queryByRole('button', { name: /create a team/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /create a league/i })).toBeNull();
  });

  it('parent (no LM membership) sees both CTAs', () => {
    currentProfile = makeProfile('parent', {
      memberships: [{ role: 'parent', teamId: 't1' }],
    });
    renderPage();

    expect(screen.getByRole('button', { name: /create a team/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create a league/i })).toBeInTheDocument();
  });

  it('multi-role user who is BOTH coach and LM does NOT see "Create a League"', () => {
    // User has an LM membership — the hasLMMembership guard should hide the league CTA
    currentProfile = makeProfile('coach', {
      memberships: [
        { role: 'coach', teamId: 't1' },
        { role: 'league_manager', leagueId: 'lg-1' },
      ],
    });
    renderPage();

    expect(screen.getByRole('button', { name: /create a team/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create a league/i })).toBeNull();
  });

  it('user with no profile sees the full CTA section (treated as non-admin)', () => {
    currentProfile = null;
    renderPage();

    // Null profile → isAdminUser = false → CTA section renders
    // (getMemberships returns [] → hasLMMembership = false → league button also shows)
    expect(screen.getByRole('button', { name: /create a team/i })).toBeInTheDocument();
  });
});
