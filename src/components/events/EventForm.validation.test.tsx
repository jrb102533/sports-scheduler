/**
 * EventForm — Validation and UI state tests
 *
 * Behaviours under test:
 *   A) Required field validation
 *      - Missing date shows error
 *      - Missing start time shows error
 *      - Missing team shows error (empty myTeams and no selection)
 *   B) Create vs Edit mode
 *      - Create mode shows "Create Event" button
 *      - Edit mode shows "Save Changes" button
 *      - Recurrence section present in create mode, absent in edit mode
 *   C) Valid form submission calls addEvent with correct shape
 *   D) Save error renders error banner without closing modal
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScheduledEvent, Team } from '@/types';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

// ── Firebase mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  doc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  query: vi.fn(),
  orderBy: vi.fn(),
  where: vi.fn(),
  getDoc: vi.fn(),
}));

// ── Store mocks ────────────────────────────────────────────────────────────────

const mockAddEvent = vi.fn().mockResolvedValue(undefined);
const mockUpdateEvent = vi.fn().mockResolvedValue(undefined);
const mockBulkAddEvents = vi.fn().mockResolvedValue(undefined);

// EventForm uses both useEventStore() (no selector, destructured) AND
// useEventStore(s => s.updateEvent) (selector). The mock must handle both.
vi.mock('@/store/useEventStore', () => ({
  useEventStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      addEvent: mockAddEvent,
      updateEvent: mockUpdateEvent,
      bulkAddEvents: mockBulkAddEvents,
      events: [],
    };
    return selector ? selector(state) : state;
  },
}));

const TEAM_A: Team = {
  id: 'team-a',
  name: 'City Hawks',
  sportType: 'soccer',
  color: '#ef4444',
  createdBy: 'uid-1',
  coachId: 'uid-1',
  attendanceWarningsEnabled: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
} as Team;

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector: (s: { teams: Team[] }) => unknown) =>
    selector({ teams: [TEAM_A] }),
}));

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: { profile: { uid: string; role: string; displayName: string; email: string }; user: { uid: string } }) => unknown) =>
    selector({
      profile: { uid: 'uid-1', role: 'coach', displayName: 'Jane Coach', email: 'jane@example.com' },
      user: { uid: 'uid-1' },
    }),
}));

vi.mock('@/store/useVenueStore', () => {
  const subscribe = vi.fn(() => () => {});
  const useVenueStore = (sel?: (s: { venues: never[]; subscribe: typeof subscribe }) => unknown) => {
    const state = { venues: [] as never[], subscribe };
    return sel ? sel(state) : state;
  };
  useVenueStore.getState = () => ({ venues: [] as never[], subscribe });
  return { useVenueStore };
});

// useOpponentStore is also destructured in EventForm (no selector)
vi.mock('@/store/useOpponentStore', () => ({
  useOpponentStore: (selector?: (s: { opponents: never[]; addOpponent: () => Promise<void> }) => unknown) => {
    const state = { opponents: [] as never[], addOpponent: vi.fn().mockResolvedValue(undefined) };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (selector: (s: { players: never[] }) => unknown) =>
    selector({ players: [] }),
}));

vi.mock('@/store/useAvailabilityStore', () => ({
  useAvailabilityStore: (selector: (s: { isPlayerAvailable: () => boolean }) => unknown) =>
    selector({ isPlayerAvailable: () => true }),
}));

// ── Import after mocks ─────────────────────────────────────────────────────────

import { EventForm } from './EventForm';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEditEvent(overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    id: 'event-1',
    title: 'Practice',
    type: 'practice',
    status: 'scheduled',
    date: '2026-06-01',
    startTime: '09:00',
    endTime: '10:30',
    duration: 90,
    teamIds: ['team-a'],
    isRecurring: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ScheduledEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── A. Required field validation ───────────────────────────────────────────────

describe('EventForm — required field validation', () => {
  it('shows date required error when date field is cleared and form submitted', async () => {
    const user = userEvent.setup();
    render(<EventForm open onClose={vi.fn()} />);

    // Clear the date field (it has a default value)
    const dateInput = screen.getByLabelText(/^date$/i);
    await user.clear(dateInput);

    await user.click(screen.getByRole('button', { name: /create event/i }));

    await waitFor(() => {
      expect(screen.getByText(/date is required/i)).toBeInTheDocument();
    });
    expect(mockAddEvent).not.toHaveBeenCalled();
  });

  it('shows start time required error when startTime field is cleared and form submitted', async () => {
    const user = userEvent.setup();
    render(<EventForm open onClose={vi.fn()} />);

    // Clear the start time field (it has a default value)
    const timeInput = screen.getByLabelText(/start time/i);
    await user.clear(timeInput);

    await user.click(screen.getByRole('button', { name: /create event/i }));

    await waitFor(() => {
      expect(screen.getByText(/start time is required/i)).toBeInTheDocument();
    });
    expect(mockAddEvent).not.toHaveBeenCalled();
  });

  it('does not call addEvent when validation fails', async () => {
    const user = userEvent.setup();
    render(<EventForm open onClose={vi.fn()} />);

    const dateInput = screen.getByLabelText(/^date$/i);
    await user.clear(dateInput);

    await user.click(screen.getByRole('button', { name: /create event/i }));

    await waitFor(() => {
      expect(screen.getByText(/date is required/i)).toBeInTheDocument();
    });
    expect(mockAddEvent).not.toHaveBeenCalled();
  });
});

// ── B. Create vs Edit mode ─────────────────────────────────────────────────────

describe('EventForm — create vs edit mode', () => {
  it('renders "Create Event" button in create mode', () => {
    render(<EventForm open onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /create event/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
  });

  it('renders "Save Changes" button in edit mode', () => {
    render(<EventForm open onClose={vi.fn()} editEvent={makeEditEvent()} />);
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create event/i })).not.toBeInTheDocument();
  });

  it('shows "New Event" modal title in create mode', () => {
    render(<EventForm open onClose={vi.fn()} />);
    expect(screen.getByText('New Event')).toBeInTheDocument();
  });

  it('shows "Edit Event" modal title in edit mode', () => {
    render(<EventForm open onClose={vi.fn()} editEvent={makeEditEvent()} />);
    expect(screen.getByText('Edit Event')).toBeInTheDocument();
  });

  it('shows recurrence section in create mode', () => {
    render(<EventForm open onClose={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: /repeats/i })).toBeInTheDocument();
  });

  it('hides recurrence section in edit mode', () => {
    render(<EventForm open onClose={vi.fn()} editEvent={makeEditEvent()} />);
    expect(screen.queryByRole('checkbox', { name: /repeats/i })).not.toBeInTheDocument();
  });
});

// ── C. Team selector renders with correct team options ─────────────────────────

describe('EventForm — team selector', () => {
  it('renders the team dropdown with the coach\'s team', () => {
    render(<EventForm open onClose={vi.fn()} />);
    // The team name should appear in the select options
    expect(screen.getByRole('combobox', { name: /^team$/i })).toBeInTheDocument();
    expect(screen.getByText('City Hawks')).toBeInTheDocument();
  });
});

// ── D. Successful submission calls addEvent ────────────────────────────────────

describe('EventForm — successful create submission', () => {
  it('calls addEvent after submitting a valid form', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<EventForm open onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /create event/i }));

    await waitFor(() => {
      expect(mockAddEvent).toHaveBeenCalledOnce();
    });
  });

  it('calls onClose after successful addEvent', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<EventForm open onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /create event/i }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it('passes correct shape to addEvent (has id, title, type, status, date, startTime, teamIds)', async () => {
    const user = userEvent.setup();
    render(<EventForm open onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /create event/i }));

    await waitFor(() => {
      expect(mockAddEvent).toHaveBeenCalledOnce();
    });

    const [event] = mockAddEvent.mock.calls[0] as [ScheduledEvent];
    expect(event.id).toBeDefined();
    expect(event.type).toBeDefined();
    expect(event.status).toBe('scheduled');
    expect(event.date).toBeDefined();
    expect(event.startTime).toBeDefined();
    expect(event.teamIds).toBeInstanceOf(Array);
    expect(event.teamIds.length).toBeGreaterThan(0);
  });
});

// ── E. Save error banner ──────────────────────────────────────────────────────

describe('EventForm — save error handling', () => {
  it('shows an error banner when addEvent rejects', async () => {
    mockAddEvent.mockRejectedValueOnce(new Error('Firestore write failed'));
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<EventForm open onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /create event/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to save/i)).toBeInTheDocument();
    });
    // Modal should still be open
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ── F. Cancel button always works ─────────────────────────────────────────────

describe('EventForm — cancel button', () => {
  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<EventForm open onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ── G. Saving state ──────────────────────────────────────────────────────────

describe('EventForm — saving state', () => {
  it('shows "Saving…" label on the submit button while save is in flight', async () => {
    let resolveAddEvent!: () => void;
    mockAddEvent.mockImplementationOnce(() => new Promise<void>(resolve => { resolveAddEvent = resolve; }));

    const user = userEvent.setup();
    render(<EventForm open onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /create event/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saving/i })).toBeInTheDocument();
    });

    // Release the pending save to clean up
    resolveAddEvent();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /saving/i })).not.toBeInTheDocument();
    });
  });
});
