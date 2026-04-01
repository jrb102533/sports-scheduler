/**
 * SeasonDashboard — standings section visibility (PR #125)
 *
 * Tests the hasPublishedDivision gate: the Standings section is rendered
 * when at least one division has scheduleStatus === 'published', and hidden
 * in all other cases.
 *
 * StandingsTable is mocked to a stub so this file does not conflict with
 * the real StandingsTable tests in StandingsTable.test.tsx.
 *
 * Store mock notes (mirrors SeasonDashboard.divisionId.test.tsx):
 *   useSeasonStore   — no selector (destructured), returns state object
 *   useDivisionStore — no selector (destructured), returns state object
 *   useTeamStore     — selector pattern
 *   useLeagueStore   — selector pattern
 *   useVenueStore    — selector pattern (called with s.venues and s.subscribe)
 *   useAuthStore     — selector pattern
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Division, Season, League, Team, Venue } from '@/types';
import type { UserProfile } from '@/types';

// ── Firebase mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  doc: vi.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SEASON: Season = {
  id: 'season-1',
  name: 'Spring 2026',
  startDate: '2026-03-01',
  endDate: '2026-06-30',
  gamesPerTeam: 8,
  homeAwayBalance: true,
  status: 'active',
  createdBy: 'uid-1',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const LEAGUE: League = {
  id: 'league-1',
  name: 'Test League',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
} as League;

const VENUE: Venue = {
  id: 'venue-1',
  ownerUid: 'uid-1',
  name: 'Test Ground',
  address: '1 Test St',
  isOutdoor: true,
  fields: [{ id: 'f1', name: 'Field 1' }],
  defaultAvailabilityWindows: [],
  defaultBlackoutDates: [],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
} as Venue;

function makeTeam(id: string): Team {
  return {
    id,
    name: `Team ${id}`,
    leagueIds: ['league-1'],
    sportType: 'soccer',
    color: '#000',
    homeVenue: '',
    coachName: '',
    coachEmail: '',
    coachPhone: '',
    ageGroup: 'U12',
    createdBy: 'uid-1',
    isDeleted: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as Team;
}

function makeDivision(id: string, scheduleStatus: Division['scheduleStatus']): Division {
  return {
    id,
    name: `Division ${id}`,
    teamIds: [],
    scheduleStatus,
    seasonId: 'season-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

// ── Mutable division state ────────────────────────────────────────────────────

let currentDivisions: Division[] = [];

// ── Store mocks ───────────────────────────────────────────────────────────────

const seasonState2 = () => ({ seasons: [SEASON], fetchSeasons: vi.fn(() => () => {}) });
vi.mock('@/store/useSeasonStore', () => ({
  useSeasonStore: Object.assign(
    (selector: (s: ReturnType<typeof seasonState2>) => unknown) => selector(seasonState2()),
    { getState: seasonState2 }
  ),
}));

const divisionState2 = () => ({ divisions: currentDivisions, fetchDivisions: vi.fn(() => () => {}) });
vi.mock('@/store/useDivisionStore', () => ({
  useDivisionStore: Object.assign(
    (selector: (s: ReturnType<typeof divisionState2>) => unknown) => selector(divisionState2()),
    { getState: divisionState2 }
  ),
}));

vi.mock('@/store/useLeagueStore', () => ({
  useLeagueStore: (selector: (s: { leagues: League[] }) => unknown) =>
    selector({ leagues: [LEAGUE] }),
}));

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector: (s: { teams: Team[] }) => unknown) =>
    selector({ teams: [makeTeam('t1'), makeTeam('t2')] }),
}));

const subscribe2 = vi.fn(() => () => {});
const venueState2 = () => ({ venues: [VENUE], subscribe: subscribe2 });
vi.mock('@/store/useVenueStore', () => ({
  useVenueStore: Object.assign(
    (selector: (s: ReturnType<typeof venueState2>) => unknown) => selector(venueState2()),
    { getState: venueState2 }
  ),
}));

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: { profile: UserProfile }) => unknown) =>
    selector({
      profile: {
        uid: 'lm-1',
        email: 'lm@example.com',
        displayName: 'LM',
        role: 'league_manager',
        leagueIds: ['league-1'],
        createdAt: '2024-01-01T00:00:00.000Z',
      } as UserProfile,
    }),
  hasRole: vi.fn((profile: UserProfile | null, ...roles: string[]) => {
    if (!profile) return false;
    return roles.includes(profile.role);
  }),
}));

// ── Stub StandingsTable so it doesn't fire Firestore listeners ────────────────

vi.mock('@/components/standings/StandingsTable', () => ({
  StandingsTable: () => <div data-testid="standings-table" />,
}));

vi.mock('@/components/leagues/ScheduleWizardModal', () => ({
  ScheduleWizardModal: () => null,
}));

// ── Render helper ─────────────────────────────────────────────────────────────

function renderDashboard(SeasonDashboard: React.ComponentType) {
  return render(
    <MemoryRouter initialEntries={['/leagues/league-1/seasons/season-1']}>
      <Routes>
        <Route path="/leagues/:leagueId/seasons/:seasonId" element={<SeasonDashboard />} />
      </Routes>
    </MemoryRouter>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SeasonDashboard — standings section visibility', () => {
  let SeasonDashboard: typeof import('@/pages/SeasonDashboard').SeasonDashboard;

  beforeEach(async () => {
    currentDivisions = [];
    ({ SeasonDashboard } = await import('@/pages/SeasonDashboard'));
  });

  it('renders the Standings section when at least one division has scheduleStatus "published"', () => {
    currentDivisions = [
      makeDivision('div-1', 'draft'),
      makeDivision('div-2', 'published'),
    ];
    renderDashboard(SeasonDashboard);
    expect(screen.getByText('Standings')).toBeInTheDocument();
    expect(screen.getByTestId('standings-table')).toBeInTheDocument();
  });

  it('renders the Standings section when the only division is published', () => {
    currentDivisions = [makeDivision('div-1', 'published')];
    renderDashboard(SeasonDashboard);
    expect(screen.getByTestId('standings-table')).toBeInTheDocument();
  });

  it('hides the Standings section when no division has scheduleStatus "published"', () => {
    currentDivisions = [
      makeDivision('div-1', 'none'),
      makeDivision('div-2', 'draft'),
    ];
    renderDashboard(SeasonDashboard);
    expect(screen.queryByTestId('standings-table')).not.toBeInTheDocument();
  });

  it('hides the Standings section when there are no divisions', () => {
    currentDivisions = [];
    renderDashboard(SeasonDashboard);
    expect(screen.queryByTestId('standings-table')).not.toBeInTheDocument();
  });
});
