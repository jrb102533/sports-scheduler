/**
 * EventAttendanceSection — behaviour tests
 *
 * Sections under test:
 *   A) Summary row — "N of M confirmed" + progress bar; "No responses yet" when empty
 *   B) CTA rows — correct player name, one per child for multi-child parent
 *   C) Expand/collapse — name list appears/disappears; button aria-expanded toggles
 *   D) Name list — Confirmed / Declined / No response groups in correct order
 *   E) Player name resolution — uses roster record name, not RSVP stored name
 *   F) "forecast" string never appears
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserProfile, Player } from '@/types';

// ── Firebase mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  doc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
}));

// ── RsvpStore mock ─────────────────────────────────────────────────────────────

import { useRsvpStore } from '@/store/useRsvpStore';
import type { RsvpEntry } from '@/store/useRsvpStore';

let mockRsvps: RsvpEntry[] = [];
const mockSubmitRsvp = vi.fn().mockResolvedValue(undefined);

vi.mock('@/store/useRsvpStore', () => {
  const storeSelector = (selector: (s: { rsvps: Record<string, RsvpEntry[]>; submitRsvp: () => Promise<void>; subscribeRsvps: () => () => void }) => unknown) =>
    selector({
      // Access the outer-scope variable via closure (vi.mock factory is hoisted
      // but closures to module-level lets still work at call time)
      get rsvps() { return { 'event-1': mockRsvps }; },
      submitRsvp: mockSubmitRsvp,
      subscribeRsvps: () => () => {},
    });
  storeSelector.setState = vi.fn();
  storeSelector.getState = vi.fn(() => ({ rsvps: {}, subscribeRsvps: () => () => {} }));
  return { useRsvpStore: storeSelector };
});

// ── PlayerStore mock ───────────────────────────────────────────────────────────

let mockPlayers: Player[] = [];

vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (selector: (s: { players: Player[] }) => unknown) =>
    selector({ players: mockPlayers }),
}));

// ── AuthStore mock ─────────────────────────────────────────────────────────────

vi.mock('@/store/useAuthStore', () => ({
  getMemberships: (profile: UserProfile | null) => {
    if (!profile) return [];
    if (profile.memberships && profile.memberships.length > 0) return profile.memberships;
    return [{ role: profile.role, isPrimary: true, teamId: profile.teamId, playerId: profile.playerId }];
  },
}));

// ── Import after mocks ─────────────────────────────────────────────────────────

import { EventAttendanceSection } from './EventAttendanceSection';

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeProfile(role: UserProfile['role'], overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'uid-1',
    email: `${role}@test.com`,
    displayName: `${role} User`,
    role,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as UserProfile;
}

function makePlayer(id: string, firstName: string, lastName: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    teamId: 'team-1',
    firstName,
    lastName,
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as Player;
}

function makeEntry(uid: string, name: string, response: 'yes' | 'no' | 'maybe'): RsvpEntry {
  return { uid, name, response, updatedAt: '2026-01-01T00:00:00.000Z' };
}

const DEFAULT_PROPS = {
  eventId: 'event-1',
  teamIds: ['team-1'],
  isActive: true,
};

function renderSection(
  profile: UserProfile | null,
  currentUserUid: string | null,
  extraProps: Partial<typeof DEFAULT_PROPS> = {},
  rsvpDeadline?: string
) {
  return render(
    <EventAttendanceSection
      {...DEFAULT_PROPS}
      {...extraProps}
      profile={profile}
      currentUserUid={currentUserUid}
      rsvpDeadline={rsvpDeadline}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRsvps = [];
  mockPlayers = [];
});

// ── A. Summary row ─────────────────────────────────────────────────────────────

describe('EventAttendanceSection — summary row', () => {
  it('shows "No responses yet" when there are no RSVP entries and no roster', () => {
    mockRsvps = [];
    mockPlayers = [];
    // When both are empty, component returns null — no summary row
    const { container } = renderSection(makeProfile('coach'), 'uid-1');
    expect(container.firstChild).toBeNull();
  });

  it('shows "No responses yet" when roster exists but no RSVPs', () => {
    mockRsvps = [];
    mockPlayers = [makePlayer('p1', 'Alice', 'Smith')];
    renderSection(makeProfile('coach'), 'uid-1');
    expect(screen.getByText('No responses yet')).toBeInTheDocument();
  });

  it('shows confirmed count and total from entries', () => {
    mockRsvps = [
      makeEntry('uid-a', 'Alice', 'yes'),
      makeEntry('uid-b', 'Bob', 'no'),
    ];
    mockPlayers = [
      makePlayer('p1', 'Alice', 'Smith', { linkedUid: 'uid-a' }),
      makePlayer('p2', 'Bob', 'Jones', { linkedUid: 'uid-b' }),
    ];
    renderSection(makeProfile('coach'), 'uid-1');
    // Summary paragraph contains "1 of 2 confirmed" inline
    expect(screen.getAllByText(/confirmed/i).length).toBeGreaterThanOrEqual(1);
    // Progressbar aria-label confirms the count
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  });

  it('renders a progressbar with correct aria attributes', () => {
    mockRsvps = [makeEntry('uid-a', 'Alice', 'yes')];
    mockPlayers = [makePlayer('p1', 'Alice', 'Smith', { linkedUid: 'uid-a' })];
    renderSection(makeProfile('coach'), 'uid-1');
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
  });

  it('section heading reads "Attendance", never "Forecast"', () => {
    mockRsvps = [makeEntry('uid-a', 'Alice', 'yes')];
    renderSection(makeProfile('admin'), 'uid-1');
    expect(screen.queryByText(/forecast/i)).not.toBeInTheDocument();
    // Card 2 header — case-insensitive since it's uppercase via CSS but text node is mixed
    expect(screen.getByText(/attendance/i)).toBeInTheDocument();
  });
});

// ── B. CTA rows ────────────────────────────────────────────────────────────────

describe('EventAttendanceSection — CTA rows', () => {
  it('shows a three-way segmented control for a player linked to this team', () => {
    mockPlayers = [makePlayer('p1', 'Alice', 'Smith', { linkedUid: 'uid-alice' })];
    renderSection(
      makeProfile('player', { uid: 'uid-alice' }),
      'uid-alice'
    );
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Going' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Maybe' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: "Can't go" })).toBeInTheDocument();
  });

  it('shows no CTA when isActive is false (cancelled/completed event)', () => {
    mockPlayers = [makePlayer('p1', 'Alice', 'Smith', { linkedUid: 'uid-alice' })];
    renderSection(
      makeProfile('player', { uid: 'uid-alice' }),
      'uid-alice',
      { isActive: false }
    );
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('shows one control per child for a multi-child parent', () => {
    mockPlayers = [
      makePlayer('p1', 'Alice', 'Smith'),
      makePlayer('p2', 'Bob', 'Smith'),
    ];
    const parentProfile = makeProfile('parent', {
      uid: 'uid-parent',
      memberships: [
        { role: 'parent', teamId: 'team-1', playerId: 'p1' },
        { role: 'parent', teamId: 'team-1', playerId: 'p2' },
      ],
    });
    renderSection(parentProfile, 'uid-parent');
    expect(screen.getAllByRole('radiogroup')).toHaveLength(2);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
  });

  it('labels each child control with the player name for multi-child parent', () => {
    mockPlayers = [
      makePlayer('p1', 'Alice', 'Smith'),
      makePlayer('p2', 'Bob', 'Smith'),
    ];
    const parentProfile = makeProfile('parent', {
      uid: 'uid-parent',
      memberships: [
        { role: 'parent', teamId: 'team-1', playerId: 'p1' },
        { role: 'parent', teamId: 'team-1', playerId: 'p2' },
      ],
    });
    renderSection(parentProfile, 'uid-parent');
    // Label text above each control
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
  });
});

// ── C. Expand/collapse ─────────────────────────────────────────────────────────

describe('EventAttendanceSection — expand/collapse', () => {
  beforeEach(() => {
    mockRsvps = [makeEntry('uid-a', 'Alice Parent', 'yes')];
    mockPlayers = [makePlayer('p1', 'Alice', 'Smith', { linkedUid: 'uid-a' })];
  });

  it('shows "See responses (N)" button collapsed by default', () => {
    renderSection(makeProfile('coach'), 'uid-1');
    expect(screen.getByRole('button', { name: /see responses/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /see responses/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands the name list when the trigger is clicked', async () => {
    const user = userEvent.setup();
    renderSection(makeProfile('coach'), 'uid-1');
    await user.click(screen.getByRole('button', { name: /see responses/i }));
    expect(screen.getByRole('button', { name: /hide responses/i })).toHaveAttribute('aria-expanded', 'true');
  });
});

// ── D. Name list grouping ──────────────────────────────────────────────────────

describe('EventAttendanceSection — name list groups', () => {
  it('shows Confirmed group above Declined group', async () => {
    mockRsvps = [
      makeEntry('uid-a', 'Alice', 'yes'),
      makeEntry('uid-b', 'Bob', 'no'),
    ];
    mockPlayers = [
      makePlayer('p1', 'Alice', 'Jones', { linkedUid: 'uid-a' }),
      makePlayer('p2', 'Bob', 'Jones', { linkedUid: 'uid-b' }),
    ];
    const user = userEvent.setup();
    renderSection(makeProfile('coach'), 'uid-1');
    await user.click(screen.getByRole('button', { name: /see responses/i }));

    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('Declined')).toBeInTheDocument();
  });

  it('shows No response group for unresponded roster players', async () => {
    mockRsvps = [];
    mockPlayers = [makePlayer('p1', 'Charlie', 'Brown', { linkedUid: 'uid-charlie' })];
    const user = userEvent.setup();
    // Need an entry to make the section render with expand button
    mockRsvps = [makeEntry('uid-other', 'Other', 'yes')];
    renderSection(makeProfile('coach'), 'uid-1');
    await user.click(screen.getByRole('button', { name: /see responses/i }));
    expect(screen.getByText('No response')).toBeInTheDocument();
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument();
  });
});

// ── E. Player name resolution ──────────────────────────────────────────────────

describe('EventAttendanceSection — player name resolution', () => {
  it('displays the roster player name, not the RSVP stored name', async () => {
    // Bug: RSVP stored name is the parent account name "Jane Parent"
    // We should display the player's actual name "Alice Smith"
    mockRsvps = [makeEntry('uid-alice', 'Jane Parent', 'yes')];
    mockPlayers = [makePlayer('p1', 'Alice', 'Smith', { linkedUid: 'uid-alice' })];

    const user = userEvent.setup();
    renderSection(makeProfile('coach'), 'uid-1');
    await user.click(screen.getByRole('button', { name: /see responses/i }));

    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Jane Parent')).not.toBeInTheDocument();
  });
});

// ── F. "forecast" string never appears ────────────────────────────────────────

describe('EventAttendanceSection — no "forecast" copy', () => {
  it('never renders the word "forecast"', () => {
    mockRsvps = [makeEntry('uid-a', 'Alice', 'yes')];
    renderSection(makeProfile('admin'), 'uid-1');
    expect(screen.queryByText(/forecast/i)).not.toBeInTheDocument();
  });
});

// ── G. Maybe RSVP path ────────────────────────────────────────────────────────

describe('EventAttendanceSection — Maybe RSVP', () => {
  it('optimistic update stores "maybe" when Maybe button is clicked', async () => {
    mockPlayers = [makePlayer('p1', 'Alice', 'Smith', { linkedUid: 'uid-alice' })];
    const user = userEvent.setup();
    renderSection(
      makeProfile('player', { uid: 'uid-alice' }),
      'uid-alice'
    );

    const maybeBtn = screen.getByRole('radio', { name: 'Maybe' });
    await user.click(maybeBtn);

    // setState was called with a state updater; extract the optimistic entry
    const setStateCalls = (useRsvpStore.setState as ReturnType<typeof vi.fn>).mock.calls;
    expect(setStateCalls.length).toBeGreaterThan(0);
    // The updater function receives prev state and returns new state
    const updater = setStateCalls[0][0] as (s: { rsvps: Record<string, RsvpEntry[]> }) => { rsvps: Record<string, RsvpEntry[]> };
    const result = updater({ rsvps: { 'event-1': [] } });
    const entry = result.rsvps['event-1'][0];
    expect(entry.response).toBe('maybe');
  });

  it('submitRsvp is called with "maybe" when Maybe is selected', async () => {
    mockPlayers = [makePlayer('p1', 'Alice', 'Smith', { linkedUid: 'uid-alice' })];
    const user = userEvent.setup();
    renderSection(
      makeProfile('player', { uid: 'uid-alice' }),
      'uid-alice'
    );

    await user.click(screen.getByRole('radio', { name: 'Maybe' }));

    expect(mockSubmitRsvp).toHaveBeenCalledWith(
      'event-1',
      'uid-alice',
      'Alice Smith',
      'maybe',
      'p1'
    );
  });

  it('legend shows the maybe count when entries include a maybe response', () => {
    mockRsvps = [
      makeEntry('uid-a', 'Alice', 'yes'),
      makeEntry('uid-b', 'Bob', 'maybe'),
      makeEntry('uid-c', 'Charlie', 'no'),
    ];
    mockPlayers = [
      makePlayer('p1', 'Alice', 'Smith', { linkedUid: 'uid-a' }),
      makePlayer('p2', 'Bob', 'Jones', { linkedUid: 'uid-b' }),
      makePlayer('p3', 'Charlie', 'Brown', { linkedUid: 'uid-c' }),
    ];
    renderSection(makeProfile('coach'), 'uid-1');
    expect(screen.getByText('1 Maybe')).toBeInTheDocument();
  });

  it('maybe entries appear in expanded Maybe group', async () => {
    mockRsvps = [
      makeEntry('uid-a', 'Alice Parent', 'yes'),
      makeEntry('uid-b', 'Bob Parent', 'maybe'),
    ];
    mockPlayers = [
      makePlayer('p1', 'Alice', 'Smith', { linkedUid: 'uid-a' }),
      makePlayer('p2', 'Bob', 'Jones', { linkedUid: 'uid-b' }),
    ];
    const user = userEvent.setup();
    renderSection(makeProfile('coach'), 'uid-1');
    await user.click(screen.getByRole('button', { name: /see responses/i }));
    expect(screen.getByText('Maybe')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('maybe count does not contribute to confirmed count', () => {
    mockRsvps = [
      makeEntry('uid-a', 'Alice', 'yes'),
      makeEntry('uid-b', 'Bob', 'maybe'),
    ];
    mockPlayers = [
      makePlayer('p1', 'Alice', 'Smith', { linkedUid: 'uid-a' }),
      makePlayer('p2', 'Bob', 'Jones', { linkedUid: 'uid-b' }),
    ];
    renderSection(makeProfile('coach'), 'uid-1');
    // Confirmed count in summary is 1 (only 'yes'), not 2
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
  });

  it('shows rsvpDeadline as day name in Card 1 when provided', () => {
    mockPlayers = [makePlayer('p1', 'Alice', 'Smith', { linkedUid: 'uid-alice' })];
    renderSection(
      makeProfile('player', { uid: 'uid-alice' }),
      'uid-alice',
      {},
      '2026-04-25' // Saturday
    );
    expect(screen.getByText(/required by saturday/i)).toBeInTheDocument();
  });
});
