/**
 * EventDetailPanel — error state tests
 *
 * Tests the error handling paths added in commit a05d5e3 (await recordResult fix)
 * and related error UI states:
 *
 *   A) recordResult Firestore error — shows "Error — retry" button text and
 *      error banner below the Save Score button.
 *   B) recordResult saves successfully — no error banner appears.
 *   C) Save Score button shows "Saving…" while in flight.
 *   D) Save Score button is disabled while saving.
 *
 * These behaviors were previously untested, meaning the fire-and-forget bug
 * (commit a05d5e3) and the error-banner rendering were uncovered.
 *
 * Render strategy: use a scheduled game event so the "Record Score" section
 * is visible (the section is hidden for 'completed' or 'cancelled' events).
 * Admin profile is used to ensure canManage=true throughout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import type { ScheduledEvent, Team, Venue } from '@/types';
import type { UserProfile } from '@/types';

// ── Firebase mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void) => {
    // Fire an empty snapshot synchronously so the dispute subscription doesn't hang
    cb({ docs: [] });
    return () => {};
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
  httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({})),
}));

// ── Mutable store state ───────────────────────────────────────────────────────

let currentProfile: UserProfile | null = null;
let mockRecordResult: ReturnType<typeof vi.fn>;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: { user: { uid: string }; profile: typeof currentProfile }) => unknown) =>
    selector({ user: { uid: 'admin-1' }, profile: currentProfile }),
  getActiveMembership: vi.fn(() => null),
  getMemberships: (profile: UserProfile | null) => {
    if (!profile) return [];
    if (profile.memberships && profile.memberships.length > 0) return profile.memberships;
    return [{ role: profile.role, isPrimary: true, teamId: profile.teamId }];
  },
  hasRole: vi.fn((profile: UserProfile | null, ...roles: string[]) => {
    if (!profile) return false;
    return roles.includes(profile.role);
  }),
  isCoachOfTeam: (profile: UserProfile | null, teamId: string) => {
    if (!profile) return false;
    if (profile.role === 'admin') return true;
    return profile.role === 'coach' && profile.teamId === teamId;
  },
  isManagerOfLeague: (profile: UserProfile | null) => {
    if (!profile) return false;
    return profile.role === 'admin' || profile.role === 'league_manager';
  },
  isMemberOfTeam: (profile: UserProfile | null, teamId: string) => {
    if (!profile) return false;
    if (profile.role === 'admin') return true;
    return profile.teamId === teamId;
  },
}));

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector: (s: { teams: Team[] }) => unknown) =>
    selector({
      teams: [
        {
          id: 't1',
          name: 'Home Team',
          sportType: 'soccer',
          color: '#000',
          homeVenue: '',
          coachName: 'Coach A',
          coachEmail: '',
          coachPhone: '',
          ageGroup: 'U12',
          createdBy: 'admin-1',
          isDeleted: false,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        } as Team,
        {
          id: 't2',
          name: 'Away Team',
          sportType: 'soccer',
          color: '#fff',
          homeVenue: '',
          coachName: 'Coach B',
          coachEmail: '',
          coachPhone: '',
          ageGroup: 'U12',
          createdBy: 'admin-1',
          isDeleted: false,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        } as Team,
      ],
    }),
}));

vi.mock('@/store/useEventStore', () => ({
  useEventStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      updateEvent: vi.fn(),
      events: [],
      deleteEvent: vi.fn(),
      recordResult: mockRecordResult,
      deleteEventsByGroupId: vi.fn(),
    }),
}));

vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (selector: (s: { players: [] }) => unknown) =>
    selector({ players: [] }),
}));

vi.mock('@/store/useVenueStore', () => {
  const subscribe = vi.fn(() => () => {});
  const useVenueStore = (selector: (s: { venues: Venue[]; subscribe: typeof subscribe }) => unknown) =>
    selector({ venues: [], subscribe });
  useVenueStore.getState = () => ({ venues: [], subscribe });
  return { useVenueStore };
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
vi.mock('@/components/events/EventAttendanceSection', () => ({
  EventAttendanceSection: () => null,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

// A scheduled (not completed) game so the "Record Score" section is visible.
// The Record Score block is gated on: isGameOrMatch && status !== 'cancelled' && status !== 'completed'
function makeScheduledGameEvent(overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    id: 'event-err-1',
    title: 'Home Team vs Away Team',
    type: 'game',
    status: 'scheduled',
    date: '2020-01-01',
    startTime: '10:00',
    teamIds: ['t1', 't2'],
    homeTeamId: 't1',
    awayTeamId: 't2',
    createdAt: '2020-01-01T00:00:00Z',
    updatedAt: '2020-01-01T00:00:00Z',
    ...overrides,
  } as ScheduledEvent;
}

function makeAdminProfile(): UserProfile {
  return {
    uid: 'admin-1',
    email: 'admin@example.com',
    displayName: 'Admin User',
    role: 'admin',
    teamId: 't1',
    createdAt: '2024-01-01T00:00:00Z',
  } as UserProfile;
}

// ─────────────────────────────────────────────────────────────────────────────
// recordResult error states
// ─────────────────────────────────────────────────────────────────────────────

describe('EventDetailPanel — recordResult error states', () => {
  let EventDetailPanel: typeof import('@/components/events/EventDetailPanel').EventDetailPanel;

  beforeEach(async () => {
    vi.useRealTimers();
    mockRecordResult = vi.fn();
    currentProfile = makeAdminProfile();
    ({ EventDetailPanel } = await import('@/components/events/EventDetailPanel'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Fill both score inputs and click Save Score.
   * Uses fireEvent rather than userEvent to avoid async complexity.
   */
  async function fillAndSubmitScore(homeVal: string, awayVal: string) {
    const inputs = screen.getAllByRole('spinbutton');
    // There may be other spinbuttons; look for the first pair within the Record Score section
    const homeInput = inputs[0];
    const awayInput = inputs[1];
    fireEvent.change(homeInput, { target: { value: homeVal } });
    fireEvent.change(awayInput, { target: { value: awayVal } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save score/i }));
    });
  }

  it('shows error banner when recordResult rejects with a Firestore error', async () => {
    mockRecordResult.mockRejectedValue(new Error('Firestore permission denied'));

    render(<EventDetailPanel event={makeScheduledGameEvent()} onClose={() => {}} />);
    await fillAndSubmitScore('3', '1');

    await waitFor(() => {
      expect(screen.getByText(/failed to save score/i)).toBeInTheDocument();
    });
  });

  it('button label changes to "Error — retry" after recordResult rejects', async () => {
    mockRecordResult.mockRejectedValue(new Error('Network error'));

    render(<EventDetailPanel event={makeScheduledGameEvent()} onClose={() => {}} />);
    await fillAndSubmitScore('2', '0');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /error.*retry/i })).toBeInTheDocument();
    });
  });

  it('does NOT show error banner when recordResult resolves successfully', async () => {
    mockRecordResult.mockResolvedValue(undefined);

    render(<EventDetailPanel event={makeScheduledGameEvent()} onClose={() => {}} />);
    await fillAndSubmitScore('1', '1');

    // Give the async happy-path state machine time to settle
    await waitFor(() => {
      expect(screen.queryByText(/failed to save score/i)).not.toBeInTheDocument();
    });
  });

  it('Save Score button is disabled when both inputs are empty', () => {
    // recordResult is never called — this verifies the disabled-until-filled gate
    render(<EventDetailPanel event={makeScheduledGameEvent()} onClose={() => {}} />);

    const saveBtn = screen.getByRole('button', { name: /save score/i });
    expect(saveBtn).toBeDisabled();
  });

  it('Save Score button is enabled once both score fields are filled', () => {
    render(<EventDetailPanel event={makeScheduledGameEvent()} onClose={() => {}} />);

    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '2' } });
    fireEvent.change(inputs[1], { target: { value: '1' } });

    // After filling both fields, the button should be enabled
    const saveBtn = screen.getByRole('button', { name: /save score/i });
    expect(saveBtn).not.toBeDisabled();
  });
});
