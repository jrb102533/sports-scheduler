/**
 * EventDetailPanel — Results & Standings tests (PR #125)
 *
 * Two behaviours under test:
 *   A) Date gate — coach "Submit Result" section shows for past/today,
 *      hidden for future and cancelled.
 *   B) Dispute resolution UI — visible only to LM / Admin when a dispute
 *      document exists in Firestore.
 *
 * EventDetailPanel calls:
 *   useAuthStore(s => s.profile)      — selector pattern
 *   useTeamStore(s => s.teams)        — selector pattern
 *   usePlayerStore(s => s.players)    — selector pattern
 *   useVenueStore(s => s.venues)      — selector pattern (twice: venues + subscribe)
 *   useEventStore destructured        — no-selector, returns object
 *
 * onSnapshot is mocked module-wide; the __firestoreSnapshotCb variable lets
 * individual tests push a snapshot into the running component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import type { ScheduledEvent, Team, Venue } from '@/types';
import type { UserProfile } from '@/types';

// ── Firebase mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {} }));

let __snapshotCb: ((snap: unknown) => void) | null = null;

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void) => {
    __snapshotCb = cb;
    return () => { __snapshotCb = null; };
  }),
  doc: vi.fn(),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  deleteField: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  getDoc: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(() => vi.fn()),
}));

// ── Mutable auth state ────────────────────────────────────────────────────────

let currentProfile: UserProfile | null = null;

// ── Store mocks ───────────────────────────────────────────────────────────────

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: { user: null; profile: typeof currentProfile }) => unknown) =>
    selector({ user: null, profile: currentProfile }),
  getActiveMembership: vi.fn(() => null),
  hasRole: vi.fn((profile: UserProfile | null, ...roles: string[]) => {
    if (!profile) return false;
    return roles.includes(profile.role);
  }),
}));

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector: (s: { teams: Team[] }) => unknown) =>
    selector({ teams: [makeTeam('t1'), makeTeam('t2')] }),
}));

vi.mock('@/store/useEventStore', () => ({
  useEventStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
    updateEvent: vi.fn(),
    events: [],
    deleteEvent: vi.fn(),
    recordResult: vi.fn(),
    deleteEventsByGroupId: vi.fn(),
  }),
}));

vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (selector: (s: { players: [] }) => unknown) =>
    selector({ players: [] }),
}));

vi.mock('@/store/useVenueStore', () => {
  const subscribe = vi.fn(() => () => {});
  return {
    useVenueStore: (selector: (s: { venues: Venue[]; subscribe: typeof subscribe }) => unknown) =>
      selector({ venues: [], subscribe }),
  };
});

// ── Sub-component stubs ───────────────────────────────────────────────────────

vi.mock('@/components/attendance/AttendanceTracker', () => ({
  AttendanceTracker: () => null,
}));
vi.mock('@/components/events/SnackVolunteerForm', () => ({
  SnackVolunteerForm: () => null,
}));
vi.mock('@/components/events/RsvpInviteModal', () => ({
  RsvpInviteModal: () => null,
}));
vi.mock('@/components/events/PostGameBroadcastModal', () => ({
  PostGameBroadcastModal: () => null,
}));
vi.mock('@/components/events/EventForm', () => ({
  EventForm: () => null,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTeam(id: string): Team {
  return {
    id,
    name: `Team ${id}`,
    sportType: 'soccer',
    color: '#000000',
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

function makeEvent(overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    id: 'event-1',
    title: 'Team t1 vs Team t2',
    type: 'game',
    status: 'scheduled',
    date: '2026-03-20',
    startTime: '10:00',
    teamIds: ['t1', 't2'],
    homeTeamId: 't1',
    awayTeamId: 't2',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ScheduledEvent;
}

function makeCoachProfile(teamId: string): UserProfile {
  return {
    uid: 'coach-1',
    email: 'coach@example.com',
    displayName: 'Coach One',
    role: 'coach',
    teamId,
    createdAt: '2024-01-01T00:00:00.000Z',
  } as UserProfile;
}

// ─────────────────────────────────────────────────────────────────────────────
// A. Date gate — coach submit-result section visibility
// ─────────────────────────────────────────────────────────────────────────────

describe('EventDetailPanel — coach submit-result date gate', () => {
  let EventDetailPanel: typeof import('@/components/events/EventDetailPanel').EventDetailPanel;

  beforeEach(async () => {
    vi.useRealTimers();
    __snapshotCb = null;
    ({ EventDetailPanel } = await import('@/components/events/EventDetailPanel'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderPanel(event: ScheduledEvent, profile: UserProfile | null = null) {
    currentProfile = profile;
    return render(<EventDetailPanel event={event} onClose={() => {}} />);
  }

  it("shows Submit Result section for a coach on today's game", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00'));
    renderPanel(
      makeEvent({ date: '2026-03-29', status: 'scheduled', teamIds: ['t1', 't2'], homeTeamId: 't1', awayTeamId: 't2' }),
      makeCoachProfile('t1')
    );
    expect(screen.getByRole('heading', { name: /submit result/i })).toBeInTheDocument();
  });

  it('shows Submit Result section for a coach on a past game', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00'));
    renderPanel(
      makeEvent({ date: '2026-03-01', status: 'scheduled', teamIds: ['t1', 't2'], homeTeamId: 't1', awayTeamId: 't2' }),
      makeCoachProfile('t1')
    );
    expect(screen.getByRole('heading', { name: /submit result/i })).toBeInTheDocument();
  });

  it('does not show Submit Result section for a future game', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00'));
    renderPanel(
      makeEvent({ date: '2026-04-15', status: 'scheduled', teamIds: ['t1', 't2'], homeTeamId: 't1', awayTeamId: 't2' }),
      makeCoachProfile('t1')
    );
    expect(screen.queryByRole('heading', { name: /submit result/i })).not.toBeInTheDocument();
  });

  it('does not show Submit Result section for a cancelled game', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00'));
    renderPanel(
      makeEvent({ date: '2026-03-01', status: 'cancelled', teamIds: ['t1', 't2'], homeTeamId: 't1', awayTeamId: 't2' }),
      makeCoachProfile('t1')
    );
    expect(screen.queryByRole('heading', { name: /submit result/i })).not.toBeInTheDocument();
  });

  it('does not show Submit Result section when coach is not on either team', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00'));
    renderPanel(
      makeEvent({ date: '2026-03-01', status: 'scheduled', teamIds: ['t1', 't2'], homeTeamId: 't1', awayTeamId: 't2' }),
      makeCoachProfile('t99') // not t1 or t2
    );
    expect(screen.queryByRole('heading', { name: /submit result/i })).not.toBeInTheDocument();
  });

  it('does not show Submit Result section for a player', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00'));
    const playerProfile: UserProfile = {
      uid: 'player-1',
      email: 'player@example.com',
      displayName: 'Player One',
      role: 'player',
      teamId: 't1',
      createdAt: '2024-01-01T00:00:00.000Z',
    } as UserProfile;
    renderPanel(
      makeEvent({ date: '2026-03-01', status: 'scheduled', teamIds: ['t1', 't2'], homeTeamId: 't1', awayTeamId: 't2' }),
      playerProfile
    );
    expect(screen.queryByRole('heading', { name: /submit result/i })).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Dispute resolution UI — role gating
// ─────────────────────────────────────────────────────────────────────────────

const OPEN_DISPUTE_SNAP = {
  exists: () => true,
  data: () => ({
    status: 'open',
    createdAt: '2026-03-20T10:00:00.000Z',
    updatedAt: '2026-03-20T10:00:00.000Z',
    firstSubmission: {
      homeScore: 3,
      awayScore: 1,
      submittedBy: 'coach-home',
      submittedAt: '2026-03-20T10:00:00.000Z',
      side: 'home',
    },
    secondSubmission: {
      homeScore: 2,
      awayScore: 1,
      submittedBy: 'coach-away',
      submittedAt: '2026-03-20T10:05:00.000Z',
      side: 'away',
    },
  }),
};

const NO_DISPUTE_SNAP = { exists: () => false, data: () => null };

// Helpers that fire the module-level __snapshotCb directly.
// Use these in tests where you don't need the local-capture pattern.
function makeEventWithLeague(): ScheduledEvent {
  return {
    ...makeEvent({ date: '2026-03-20', status: 'completed', disputeStatus: 'open' }),
    leagueId: 'league-1',
  } as ScheduledEvent & { leagueId: string };
}

describe('EventDetailPanel — dispute resolution UI role gating', () => {
  let EventDetailPanel: typeof import('@/components/events/EventDetailPanel').EventDetailPanel;

  beforeEach(async () => {
    vi.useRealTimers();
    __snapshotCb = null;
    ({ EventDetailPanel } = await import('@/components/events/EventDetailPanel'));
  });

  afterEach(() => {
    __snapshotCb = null;
  });

  it('shows Score Dispute section for league_manager when dispute is open', async () => {
    currentProfile = {
      uid: 'lm-1', email: 'lm@example.com', displayName: 'LM',
      role: 'league_manager', createdAt: '2024-01-01T00:00:00.000Z',
    } as UserProfile;

    render(<EventDetailPanel event={makeEventWithLeague()} onClose={() => {}} />);
    const cb1 = await waitFor(() => {
      if (!__snapshotCb) throw new Error('onSnapshot not yet registered');
      return __snapshotCb;
    });
    await act(async () => { cb1(OPEN_DISPUTE_SNAP); });

    expect(await screen.findByText('Score Dispute')).toBeInTheDocument();
    expect(
      screen.getByText('Two different scores were submitted. Confirm the correct result below.')
    ).toBeInTheDocument();
  });

  it('shows Score Dispute section for admin when dispute is open', async () => {
    currentProfile = {
      uid: 'admin-1', email: 'admin@example.com', displayName: 'Admin',
      role: 'admin', createdAt: '2024-01-01T00:00:00.000Z',
    } as UserProfile;

    render(<EventDetailPanel event={makeEventWithLeague()} onClose={() => {}} />);
    const cb2 = await waitFor(() => {
      if (!__snapshotCb) throw new Error('onSnapshot not yet registered');
      return __snapshotCb;
    });
    await act(async () => { cb2(OPEN_DISPUTE_SNAP); });

    expect(await screen.findByText('Score Dispute')).toBeInTheDocument();
  });

  it('does not show Score Dispute section for a coach even when dispute is open', async () => {
    currentProfile = {
      uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach',
      role: 'coach', teamId: 't1', createdAt: '2024-01-01T00:00:00.000Z',
    } as UserProfile;

    // For a coach, onSnapshot is never subscribed (isLMOrAdmin is false)
    // so we render and assert immediately — no dispute UI should appear.
    render(<EventDetailPanel event={makeEventWithLeague()} onClose={() => {}} />);
    expect(screen.queryByText('Score Dispute')).not.toBeInTheDocument();
  });

  it('does not show Score Dispute section when there is no open dispute', async () => {
    currentProfile = {
      uid: 'lm-1', email: 'lm@example.com', displayName: 'LM',
      role: 'league_manager', createdAt: '2024-01-01T00:00:00.000Z',
    } as UserProfile;

    render(<EventDetailPanel event={makeEventWithLeague()} onClose={() => {}} />);
    const cb3 = await waitFor(() => {
      if (!__snapshotCb) throw new Error('onSnapshot not yet registered');
      return __snapshotCb;
    });
    await act(async () => { cb3(NO_DISPUTE_SNAP); });

    // After triggering a no-document snapshot the dispute state is null —
    // Score Dispute section must not appear.
    await waitFor(() =>
      expect(screen.queryByText('Score Dispute')).not.toBeInTheDocument()
    );
  });

  it('renders two "Confirm this score" buttons for the two submissions', async () => {
    currentProfile = {
      uid: 'lm-1', email: 'lm@example.com', displayName: 'LM',
      role: 'league_manager', createdAt: '2024-01-01T00:00:00.000Z',
    } as UserProfile;

    render(<EventDetailPanel event={makeEventWithLeague()} onClose={() => {}} />);

    // Wait for the dispute useEffect to run and register the onSnapshot callback.
    // Capture the reference locally so cleanup between awaits can't null it out.
    const cb = await waitFor(() => {
      if (!__snapshotCb) throw new Error('onSnapshot not yet registered');
      return __snapshotCb;
    });

    await act(async () => { cb(OPEN_DISPUTE_SNAP); });

    // The button's accessible name comes from its aria-label ("Confirm score: Home X Away Y"),
    // not its text content ("Confirm this score") — match the aria-label pattern.
    const confirmButtons = await screen.findAllByRole('button', { name: /^confirm score:/i });
    expect(confirmButtons).toHaveLength(2);
  });
});
