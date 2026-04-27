/**
 * EventCard — RSVP subcollection migration (FW-97)
 *
 * Verifies that EventCard:
 *   A) Calls submitRsvp (not setDoc) when a player RSVPs
 *   B) Reads RSVP state from useRsvpStore.rsvps[eventId] instead of event.rsvps
 *   C) Falls back to event.rsvps when store has no entry for the event
 *   D) Coach going-count reads from store, not event.rsvps
 *   E) submitRsvp receives the correct (eventId, uid, name, response, playerId) args
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScheduledEvent, UserProfile } from '@/types';
import type { RsvpEntry } from '@/store/useRsvpStore';

// ── Firebase stub ─────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {}, functions: {} }));

// Confirm setDoc is NOT imported or called (regression guard)
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn().mockImplementation(() => {
    throw new Error('setDoc should never be called — use submitRsvp CF instead');
  }),
}));

// ── RSVP store mock ───────────────────────────────────────────────────────────

const mockSubmitRsvp = vi.fn().mockResolvedValue(undefined);
let mockStoreRsvps: Record<string, RsvpEntry[]> = {};

vi.mock('@/store/useRsvpStore', () => ({
  useRsvpStore: (selector: (s: { rsvps: Record<string, RsvpEntry[]>; submitRsvp: typeof mockSubmitRsvp }) => unknown) =>
    selector({ rsvps: mockStoreRsvps, submitRsvp: mockSubmitRsvp }),
}));

// ── Auth store mock ───────────────────────────────────────────────────────────

let currentUser: { uid: string } | null = null;
let currentProfile: UserProfile | null = null;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (s: (state: { user: typeof currentUser; profile: typeof currentProfile }) => unknown) =>
    s({ user: currentUser, profile: currentProfile }),
  getActiveMembership: vi.fn(() => null),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { EventCard } from './EventCard';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    id: 'event-1',
    title: 'Spring Game',
    type: 'game',
    status: 'scheduled',
    date: '2026-07-01',
    startTime: '10:00',
    teamIds: ['t1'],
    isRecurring: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ScheduledEvent;
}

function makePlayerProfile(uid = 'uid-alice', playerId = 'player-123'): UserProfile {
  return {
    uid,
    email: 'alice@example.com',
    displayName: 'Alice Smith',
    role: 'player',
    teamId: 't1',
    playerId,
    createdAt: '2024-01-01T00:00:00.000Z',
  } as UserProfile;
}

function makeCoachProfile(uid = 'uid-coach'): UserProfile {
  return {
    uid,
    email: 'coach@example.com',
    displayName: 'Coach Bob',
    role: 'coach',
    teamId: 't1',
    createdAt: '2024-01-01T00:00:00.000Z',
  } as UserProfile;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreRsvps = {};
  currentUser = null;
  currentProfile = null;
});

// ── A. submitRsvp called instead of setDoc ────────────────────────────────────

describe('EventCard — RSVP write uses submitRsvp (FW-97)', () => {
  beforeEach(() => {
    currentUser = { uid: 'uid-alice' };
    currentProfile = makePlayerProfile();
    // No store entry → RSVP button will appear
    mockStoreRsvps = {};
  });

  it('calls submitRsvp when player clicks RSVP then Yes', async () => {
    const user = userEvent.setup();
    render(<EventCard event={makeEvent()} teams={[]} />);

    // Open RSVP panel
    await user.click(screen.getByRole('button', { name: /rsvp/i }));
    // Click Yes
    await user.click(screen.getByRole('button', { name: /^yes$/i }));

    await waitFor(() => {
      expect(mockSubmitRsvp).toHaveBeenCalledOnce();
    });

    const [eventId, uid, , response] = mockSubmitRsvp.mock.calls[0] as [string, string, string, string, string?];
    expect(eventId).toBe('event-1');
    expect(uid).toBe('uid-alice');
    expect(response).toBe('yes');
  });

  it('passes playerId to submitRsvp when profile.playerId differs from uid', async () => {
    const user = userEvent.setup();
    render(<EventCard event={makeEvent()} teams={[]} />);

    await user.click(screen.getByRole('button', { name: /rsvp/i }));
    await user.click(screen.getByRole('button', { name: /^yes$/i }));

    await waitFor(() => {
      expect(mockSubmitRsvp).toHaveBeenCalledOnce();
    });

    const [, , , , playerId] = mockSubmitRsvp.mock.calls[0] as [string, string, string, string, string?];
    expect(playerId).toBe('player-123');
  });

  it('omits playerId from submitRsvp when profile.playerId equals uid (self-RSVP)', async () => {
    currentUser = { uid: 'uid-self' };
    currentProfile = makePlayerProfile('uid-self', 'uid-self');
    const user = userEvent.setup();
    render(<EventCard event={makeEvent()} teams={[]} />);

    await user.click(screen.getByRole('button', { name: /rsvp/i }));
    await user.click(screen.getByRole('button', { name: /^yes$/i }));

    await waitFor(() => {
      expect(mockSubmitRsvp).toHaveBeenCalledOnce();
    });

    const [, , , , playerId] = mockSubmitRsvp.mock.calls[0] as [string, string, string, string, string?];
    expect(playerId).toBeUndefined();
  });
});

// ── B. RSVP state read from store ─────────────────────────────────────────────

describe('EventCard — RSVP display reads from store (FW-97)', () => {
  beforeEach(() => {
    currentUser = { uid: 'uid-alice' };
    currentProfile = makePlayerProfile();
  });

  it('shows Going badge when store has a yes entry for the current player', () => {
    mockStoreRsvps = {
      'event-1': [
        { uid: 'uid-alice', playerId: 'player-123', name: 'Alice Smith', response: 'yes', updatedAt: '2026-01-01' },
      ],
    };
    render(<EventCard event={makeEvent({ rsvps: [] })} teams={[]} />);
    expect(screen.getByText(/going/i)).toBeInTheDocument();
  });

  it('shows Maybe badge when store has a maybe entry for the current player', () => {
    mockStoreRsvps = {
      'event-1': [
        { uid: 'uid-alice', playerId: 'player-123', name: 'Alice Smith', response: 'maybe', updatedAt: '2026-01-01' },
      ],
    };
    render(<EventCard event={makeEvent({ rsvps: [] })} teams={[]} />);
    expect(screen.getByText(/maybe/i)).toBeInTheDocument();
  });

  it('shows RSVP button (no response) when store entry is absent for this event', () => {
    // Store has entries for a different event, not event-1
    mockStoreRsvps = {
      'event-99': [
        { uid: 'uid-alice', playerId: 'player-123', name: 'Alice Smith', response: 'yes', updatedAt: '2026-01-01' },
      ],
    };
    render(<EventCard event={makeEvent({ rsvps: [] })} teams={[]} />);
    expect(screen.getByRole('button', { name: /rsvp/i })).toBeInTheDocument();
  });
});

// ── C. Legacy event.rsvps fallback ────────────────────────────────────────────

describe('EventCard — falls back to event.rsvps when store is empty (FW-97)', () => {
  beforeEach(() => {
    currentUser = { uid: 'uid-alice' };
    currentProfile = makePlayerProfile();
    mockStoreRsvps = {};
  });

  it('shows Going badge using event.rsvps when store has no entry for the event', () => {
    const event = makeEvent({
      rsvps: [
        { playerId: 'player-123', name: 'Alice Smith', email: 'alice@example.com', response: 'yes', respondedAt: '2026-01-01' },
      ],
    });
    render(<EventCard event={event} teams={[]} />);
    expect(screen.getByText(/going/i)).toBeInTheDocument();
  });
});

// ── D. Coach going-count reads from store ────────────────────────────────────

describe('EventCard — coach going count reads from store (FW-97)', () => {
  beforeEach(() => {
    currentUser = { uid: 'uid-coach' };
    currentProfile = makeCoachProfile();
  });

  it('shows going count from store entries for a coach', () => {
    mockStoreRsvps = {
      'event-1': [
        { uid: 'uid-a', name: 'Alice', response: 'yes', updatedAt: '2026-01-01' },
        { uid: 'uid-b', name: 'Bob', response: 'yes', updatedAt: '2026-01-01' },
        { uid: 'uid-c', name: 'Charlie', response: 'no', updatedAt: '2026-01-01' },
      ],
    };
    render(<EventCard event={makeEvent({ rsvps: [] })} teams={[]} />);
    expect(screen.getByText(/2 going/i)).toBeInTheDocument();
  });
});
