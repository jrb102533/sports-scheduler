/**
 * SeasonDashboard — TD #111: divisionId prop wiring
 *
 * Tests that SeasonDashboard passes `divisionId` to ScheduleWizardModal
 * correctly based on the number of divisions in the store:
 *   - exactly 1 division → passes divisions[0].id
 *   - 0 divisions        → passes undefined
 *   - 2+ divisions       → passes undefined
 *
 * Two layers of coverage:
 *
 * 1. Pure unit tests on the conditional expression in isolation — fast, zero
 *    dependencies. These lock down the logic even if the component is refactored.
 *
 * 2. Integration render tests — render SeasonDashboard with mocked stores and
 *    a mocked ScheduleWizardModal. Open the wizard and assert the captured
 *    divisionId prop matches expectations.
 *
 * Mocking notes:
 *   - useSeasonStore and useDivisionStore are called WITHOUT selectors
 *     (destructured), so those mocks return the state object directly.
 *   - useTeamStore, useLeagueStore, useVenueStore, useAuthStore all use the
 *     selector pattern and their mocks call the selector with a state object.
 *
 * NOTE — saveFixtures divisionId gap:
 * The `...(divisionId ? { divisionId } : {})` spread inside saveFixtures
 * cannot be meaningfully tested without the Firebase Emulator because addEvent
 * calls setDoc directly. A backend emulator test should be added to verify
 * that events written by saveFixtures include divisionId when the prop is set
 * and omit it when undefined. Track as a coverage gap until the emulator
 * test suite for ScheduleWizardModal is written.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Division, Season, League, Team, Venue } from '@/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDivision(id: string): Division {
  return {
    id,
    name: `Division ${id}`,
    teamIds: [],
    scheduleStatus: 'none',
    seasonId: 'season-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function makeTeam(id: string): Team {
  return {
    id,
    name: `Team ${id}`,
    leagueId: 'league-1',
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

const LEAGUE: League = {
  id: 'league-1',
  name: 'Test League',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

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

// A venue with generous availability windows so canGenerate evaluates to true.
// availabilityWindows on the venue aren't read by SeasonDashboard directly —
// the availableSlots calculation uses defaultAvailabilityWindows on the Venue.
// With 0 windows the estimate falls back to 2*2*weeks which is plenty for our
// 8-game season with 2 teams (requiredSlots = ceil(8*2/2) = 8).
const MOCK_VENUE: Venue = {
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
};

// ── Mutable state ─────────────────────────────────────────────────────────────

let currentDivisions: Division[] = [];
let currentTeams: Team[] = [makeTeam('t1'), makeTeam('t2')];

const mockFetchSeasons = vi.fn(() => () => {});
const mockFetchDivisions = vi.fn(() => () => {});
const mockSubscribeVenues = vi.fn(() => () => {});

// ── Module mocks ──────────────────────────────────────────────────────────────
// Note the call pattern differences:
//   useSeasonStore()  → no selector, returns state object
//   useDivisionStore() → no selector, returns state object
//   useTeamStore(s => s.teams) → selector, must be called with state
//   useVenueStore(s => s.venues) → selector pattern (called twice with diff selectors)
//   useLeagueStore(s => s.leagues) → selector
//   useAuthStore(s => s.profile) → selector

vi.mock('@/store/useLeagueStore', () => ({
  useLeagueStore: (selector: (s: { leagues: League[] }) => unknown) =>
    selector({ leagues: [LEAGUE] }),
}));

vi.mock('@/store/useSeasonStore', () => ({
  useSeasonStore: () => ({
    seasons: [SEASON],
    fetchSeasons: mockFetchSeasons,
  }),
}));

vi.mock('@/store/useDivisionStore', () => ({
  useDivisionStore: () => ({
    divisions: currentDivisions,
    fetchDivisions: mockFetchDivisions,
  }),
}));

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector: (s: { teams: Team[] }) => unknown) =>
    selector({ teams: currentTeams }),
}));

vi.mock('@/store/useVenueStore', () => ({
  // useVenueStore is called twice with different selectors (s.venues and s.subscribe).
  // We provide one venue so canGenerate === true, enabling the Open Wizard button.
  useVenueStore: (selector: (s: { venues: Venue[]; subscribe: typeof mockSubscribeVenues }) => unknown) =>
    selector({ venues: [MOCK_VENUE], subscribe: mockSubscribeVenues }),
}));

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: { profile: { uid: string; role: string; leagueId: string } }) => unknown) =>
    selector({ profile: { uid: 'uid-1', role: 'admin', leagueId: 'league-1' } }),
}));

// ── ScheduleWizardModal mock ──────────────────────────────────────────────────

const capturedWizardProps: Array<{ divisionId?: string }> = [];

vi.mock('@/components/leagues/ScheduleWizardModal', () => ({
  ScheduleWizardModal: (props: { divisionId?: string; open: boolean }) => {
    // Only record when the modal is actually open (wizardOpen === true).
    if (props.open) {
      capturedWizardProps.push({ divisionId: props.divisionId });
    }
    return <div data-testid="schedule-wizard-modal" />;
  },
}));

// ── Render helper ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let SeasonDashboard: typeof import('@/pages/SeasonDashboard').SeasonDashboard;

beforeEach(async () => {
  currentDivisions = [];
  currentTeams = [makeTeam('t1'), makeTeam('t2')];
  capturedWizardProps.length = 0;
  vi.clearAllMocks();
  ({ SeasonDashboard } = await import('@/pages/SeasonDashboard'));
});

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/leagues/league-1/seasons/season-1']}>
      <Routes>
        <Route
          path="/leagues/:leagueId/seasons/:seasonId"
          element={<SeasonDashboard />}
        />
      </Routes>
    </MemoryRouter>
  );
}

function clickOpenWizard() {
  fireEvent.click(screen.getByRole('button', { name: /open wizard/i }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — Pure unit tests on the conditional expression
// These lock down the divisionId selection logic independent of React.
// ─────────────────────────────────────────────────────────────────────────────

describe('divisionId selection logic — pure unit tests', () => {
  /** Mirrors the exact conditional in SeasonDashboard line 535. */
  function selectDivisionId(divisions: Division[]): string | undefined {
    return divisions.length === 1 ? divisions[0].id : undefined;
  }

  it('returns the division id when exactly one division exists', () => {
    expect(selectDivisionId([makeDivision('div-abc')])).toBe('div-abc');
  });

  it('returns undefined when zero divisions exist', () => {
    expect(selectDivisionId([])).toBeUndefined();
  });

  it('returns undefined when exactly two divisions exist', () => {
    expect(selectDivisionId([makeDivision('d1'), makeDivision('d2')])).toBeUndefined();
  });

  it('returns undefined when three or more divisions exist', () => {
    expect(
      selectDivisionId([makeDivision('d1'), makeDivision('d2'), makeDivision('d3')])
    ).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2 — Integration render tests
// Verify the prop is threaded through correctly to ScheduleWizardModal.
// ─────────────────────────────────────────────────────────────────────────────

describe('SeasonDashboard — ScheduleWizardModal receives correct divisionId', () => {
  it('passes the division id when exactly one division exists', () => {
    currentDivisions = [makeDivision('div-xyz')];
    renderDashboard();
    clickOpenWizard();
    expect(capturedWizardProps.at(-1)?.divisionId).toBe('div-xyz');
  });

  it('passes undefined when zero divisions exist', () => {
    currentDivisions = [];
    renderDashboard();
    clickOpenWizard();
    expect(capturedWizardProps.at(-1)?.divisionId).toBeUndefined();
  });

  it('passes undefined when two divisions exist', () => {
    currentDivisions = [makeDivision('d1'), makeDivision('d2')];
    renderDashboard();
    clickOpenWizard();
    expect(capturedWizardProps.at(-1)?.divisionId).toBeUndefined();
  });

  it('passes undefined when three divisions exist', () => {
    currentDivisions = [makeDivision('d1'), makeDivision('d2'), makeDivision('d3')];
    renderDashboard();
    clickOpenWizard();
    expect(capturedWizardProps.at(-1)?.divisionId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 3 — Rendering smoke tests
// ─────────────────────────────────────────────────────────────────────────────

describe('SeasonDashboard — renders without error', () => {
  it('renders season name with zero divisions', () => {
    currentDivisions = [];
    renderDashboard();
    expect(screen.getByText('Spring 2026')).toBeInTheDocument();
  });

  it('renders division name when one division exists', () => {
    currentDivisions = [makeDivision('div-1')];
    renderDashboard();
    expect(screen.getByText('Division div-1')).toBeInTheDocument();
  });

  it('renders all division names when multiple divisions exist', () => {
    currentDivisions = [makeDivision('div-A'), makeDivision('div-B')];
    renderDashboard();
    expect(screen.getByText('Division div-A')).toBeInTheDocument();
    expect(screen.getByText('Division div-B')).toBeInTheDocument();
  });

  it('Open Wizard button is enabled when 2 or more teams are present and a venue is configured', () => {
    currentTeams = [makeTeam('t1'), makeTeam('t2')];
    currentDivisions = [];
    renderDashboard();
    expect(screen.getByRole('button', { name: /open wizard/i })).toBeEnabled();
  });

  it('Open Wizard button is disabled when fewer than 2 teams are present', () => {
    currentTeams = [makeTeam('t1')];
    renderDashboard();
    expect(screen.getByRole('button', { name: /open wizard/i })).toBeDisabled();
  });
});
