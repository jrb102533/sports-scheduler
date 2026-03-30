/**
 * StandingsTable — Results & Standings tests (PR #125)
 *
 * Covers:
 *   1. Loading state before snapshot arrives (Firestore path)
 *   2. Empty state when Firestore collection is empty
 *   3. Rows rendered sorted by rank when data arrives
 *   4. Override buttons visible only to LM/Admin
 *   5. OverrideModal — save blocked when note is empty
 *   6. OverrideModal — save blocked when rank is out of range
 *   7. Local fallback (no leagueId/seasonId) — does not show loading spinner
 *
 * The __firestoreSnapshotCb module-level variable lets each test push a
 * snapshot into the running component via onSnapshot.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Team, Venue } from '@/types';
import type { StandingsDocument } from '@/types/standings';
import type { UserProfile } from '@/types';

// ── Firebase mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {} }));

let __snapshotCb: ((snap: unknown) => void) | null = null;

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void, _err?: unknown) => {
    __snapshotCb = cb;
    return () => { __snapshotCb = null; };
  }),
  doc: vi.fn(),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  deleteField: vi.fn(),
}));

// ── Mutable auth state ────────────────────────────────────────────────────────

let currentProfile: UserProfile | null = null;

// ── Store mocks ───────────────────────────────────────────────────────────────

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: { profile: UserProfile | null }) => unknown) =>
    selector({ profile: currentProfile }),
  hasRole: vi.fn((profile: UserProfile | null, ...roles: string[]) => {
    if (!profile) return false;
    return roles.includes(profile.role);
  }),
}));

// Stable team fixtures — defined inside the factory so the same array reference
// is returned on every selector call, preventing allTeams dep churn in useEffect.
vi.mock('@/store/useTeamStore', () => {
  const STABLE_TEAMS = [
    {
      id: 't1', name: 'Team t1', sportType: 'soccer', color: '#3b82f6',
      homeVenue: '', coachName: '', coachEmail: '', coachPhone: '',
      ageGroup: 'U12', createdBy: 'user1', isDeleted: false,
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 't2', name: 'Team t2', sportType: 'soccer', color: '#3b82f6',
      homeVenue: '', coachName: '', coachEmail: '', coachPhone: '',
      ageGroup: 'U12', createdBy: 'user1', isDeleted: false,
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ];
  return {
    useTeamStore: (selector: (s: { teams: unknown[] }) => unknown) =>
      selector({ teams: STABLE_TEAMS }),
  };
});

vi.mock('@/store/useEventStore', () => ({
  useEventStore: (selector: (s: { events: [] }) => unknown) =>
    selector({ events: [] }),
}));

vi.mock('@/store/useVenueStore', () => {
  const subscribe = vi.fn(() => () => {});
  return {
    useVenueStore: (selector: (s: { venues: Venue[]; subscribe: typeof subscribe }) => unknown) =>
      selector({ venues: [], subscribe }),
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTeam(id: string): Team {
  return {
    id,
    name: `Team ${id}`,
    sportType: 'soccer',
    color: '#3b82f6',
    homeVenue: '',
    coachName: '',
    coachEmail: '',
    coachPhone: '',
    ageGroup: 'U12',
    createdBy: 'user1',
    isDeleted: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as Team;
}

function makeDoc(teamId: string, rank: number, points: number): StandingsDocument {
  return {
    teamId,
    played: 5,
    won: 3,
    drawn: 0,
    lost: 2,
    goalsFor: 9,
    goalsAgainst: 5,
    points,
    winPct: 0.6,
    rank,
    updatedAt: '2026-03-01T00:00:00.000Z',
  };
}

function lmProfile(): UserProfile {
  return {
    uid: 'lm-1',
    email: 'lm@example.com',
    displayName: 'LM',
    role: 'league_manager',
    createdAt: '2024-01-01T00:00:00.000Z',
  } as UserProfile;
}

function coachProfile(): UserProfile {
  return {
    uid: 'coach-1',
    email: 'coach@example.com',
    displayName: 'Coach',
    role: 'coach',
    teamId: 't1',
    createdAt: '2024-01-01T00:00:00.000Z',
  } as UserProfile;
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe('StandingsTable (Firestore path)', () => {
  let StandingsTable: typeof import('@/components/standings/StandingsTable').StandingsTable;

  beforeEach(async () => {
    __snapshotCb = null;
    currentProfile = lmProfile();
    ({ StandingsTable } = await import('@/components/standings/StandingsTable'));
  });

  afterEach(() => {
    __snapshotCb = null;
  });

  // Push snapshot data through the callback. findByText/findAllByRole will
  // wait for the resulting React state updates to propagate to the DOM.
  function triggerEmpty() {
    __snapshotCb?.({ docs: [] });
  }

  function triggerTwoTeams() {
    __snapshotCb?.({
      docs: [
        { data: () => makeDoc('t1', 1, 12) },
        { data: () => makeDoc('t2', 2, 7) },
      ],
    });
  }

  it('shows loading state before snapshot arrives', () => {
    render(<StandingsTable leagueId="league-1" seasonId="season-1" />);
    expect(screen.getByText(/loading standings/i)).toBeInTheDocument();
  });

  it('shows "No results recorded yet" when Firestore collection is empty', async () => {
    render(<StandingsTable leagueId="league-1" seasonId="season-1" />);
    await triggerEmpty();
    expect(await screen.findByText(/no results recorded yet/i)).toBeInTheDocument();
  });

  it('renders a row for each team when data arrives', async () => {
    render(<StandingsTable leagueId="league-1" seasonId="season-1" />);
    await triggerTwoTeams();

    // header + 2 data rows = 3
    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(3);
  });

  it('places the rank-1 team row before the rank-2 team row', async () => {
    render(<StandingsTable leagueId="league-1" seasonId="season-1" />);
    await triggerTwoTeams();

    const rows = await screen.findAllByRole('row');
    // rows[0] = header; rows[1] = rank-1 (12 pts); rows[2] = rank-2 (7 pts)
    expect(rows[1]).toHaveTextContent('12');
    expect(rows[2]).toHaveTextContent('7');
  });

  it('shows override buttons for LM in Firestore mode', async () => {
    render(<StandingsTable leagueId="league-1" seasonId="season-1" />);
    await triggerTwoTeams();

    const overrideButtons = await screen.findAllByRole('button', { name: /override rank/i });
    expect(overrideButtons.length).toBeGreaterThan(0);
  });

  it('does not show override buttons for a coach', async () => {
    currentProfile = coachProfile();
    render(<StandingsTable leagueId="league-1" seasonId="season-1" />);
    await triggerTwoTeams();

    expect(screen.queryByRole('button', { name: /override rank/i })).not.toBeInTheDocument();
  });
});

describe('StandingsTable (local fallback path)', () => {
  let StandingsTable: typeof import('@/components/standings/StandingsTable').StandingsTable;

  beforeEach(async () => {
    currentProfile = lmProfile();
    ({ StandingsTable } = await import('@/components/standings/StandingsTable'));
  });

  it('does not show a loading spinner when leagueId/seasonId are absent', () => {
    render(<StandingsTable />);
    expect(screen.queryByText(/loading standings/i)).not.toBeInTheDocument();
  });

  it('renders a standings table in the local path when teams exist', () => {
    // useTeamStore mock returns [t1, t2]; useEventStore returns [];
    // computeStandings produces rows → table renders
    render(<StandingsTable />);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});

describe('StandingsTable — OverrideModal save validation', () => {
  let StandingsTable: typeof import('@/components/standings/StandingsTable').StandingsTable;

  beforeEach(async () => {
    __snapshotCb = null;
    currentProfile = lmProfile();
    ({ StandingsTable } = await import('@/components/standings/StandingsTable'));
  });

  afterEach(() => {
    __snapshotCb = null;
  });

  async function openOverrideModal() {
    render(<StandingsTable leagueId="league-1" seasonId="season-1" />);

    // Fire the snapshot synchronously. findByRole will poll until the resulting
    // state update (setFirestoreEntries + setLoadingFirestore(false)) propagates.
    __snapshotCb?.({ docs: [{ data: () => makeDoc('t1', 1, 9) }] });

    // At this point the data table is rendered. The override button is
    // opacity-0 by default but present in the accessibility tree via aria-label.
    const overrideButton = await screen.findByRole('button', {
      name: /override rank for Team t1/i,
    });

    await userEvent.click(overrideButton);
  }

  it('shows a validation error and does not call updateDoc when note is empty', async () => {
    const { updateDoc } = await import('firebase/firestore');
    (updateDoc as ReturnType<typeof vi.fn>).mockClear();

    await openOverrideModal();

    const rankInput = screen.getByLabelText(/rank position/i);
    await userEvent.clear(rankInput);
    await userEvent.type(rankInput, '1');

    // Leave note empty and click Save
    await userEvent.click(screen.getByRole('button', { name: /save override/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/reason for the override is required/i);
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('shows a validation error when rank is out of range', async () => {
    const { updateDoc } = await import('firebase/firestore');
    (updateDoc as ReturnType<typeof vi.fn>).mockClear();

    await openOverrideModal();

    const rankInput = screen.getByLabelText(/rank position/i);
    await userEvent.clear(rankInput);
    await userEvent.type(rankInput, '99'); // 1 team present → max rank is 1

    const noteInput = screen.getByLabelText(/reason for override/i);
    await userEvent.type(noteInput, 'Some valid reason');

    await userEvent.click(screen.getByRole('button', { name: /save override/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/rank must be a number between 1 and/i);
    expect(updateDoc).not.toHaveBeenCalled();
  });
});
