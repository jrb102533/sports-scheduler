/**
 * MessagingPage — DmPanel profile-fetch cache (fix/firestore-read-optimizations)
 *
 * The DmPanel caches fetched UserProfile documents in a useRef Map keyed by UID.
 * Behavioural contracts under test:
 *   1. UIDs already in the cache are NOT re-fetched when the effect re-fires.
 *   2. A new UID (new team member) DOES trigger a getDoc call.
 *   3. The effect does NOT fire when the set of team IDs is unchanged
 *      (membershipKey is stable across store refreshes that don't add/remove teams).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ─── vi.hoisted: spy refs that are referenced inside vi.mock factories ────────
// Must use vi.hoisted() so the refs are available when the factory executes.

const { mockGetDoc, mockGetDocs, mockSubscribeThreads, mockSubscribeMessages, mockSubscribeTeamChat } =
  vi.hoisted(() => ({
    mockGetDoc: vi.fn(),
    mockGetDocs: vi.fn(),
    mockSubscribeThreads: vi.fn(() => () => {}),
    mockSubscribeMessages: vi.fn(() => () => {}),
    mockSubscribeTeamChat: vi.fn(() => () => {}),
  }));

// ─── Firebase mocks ───────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({
  db: {},
  functions: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  doc: vi.fn((_db: unknown, _col: string, uid: string) => ({ id: uid })),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => vi.fn()),
}));

// ─── Heavy sub-components — stub so we don't need their store dependencies ────

vi.mock('@/components/messaging/ThreadView', () => ({
  ThreadView: () => <div data-testid="thread-view" />,
}));

vi.mock('@/components/messaging/DmList', () => ({
  DmList: ({ onSelectThread }: { onSelectThread: (t: unknown) => void }) => (
    <button onClick={() => onSelectThread({
      id: 'thread-1',
      participants: ['my-uid', 'uid-b'],
      participantNames: { 'my-uid': 'Me', 'uid-b': 'Bob' },
      lastMessage: '',
      lastMessageAt: '',
      updatedAt: '',
    })}>
      Open Thread
    </button>
  ),
}));

// ─── Store mocks ──────────────────────────────────────────────────────────────

/**
 * Mutable store state — tests mutate these between renders to simulate
 * live Zustand store updates (e.g. new team member arrives).
 */
let teamStoreState = { teams: [{ id: 'team-alpha', name: 'Alpha', coachId: 'uid-coach' }] };
let playerStoreState = { players: [{ id: 'p1', teamId: 'team-alpha', linkedUid: 'uid-a' }] };
let authStoreState = {
  user: { uid: 'my-uid' },
  profile: {
    uid: 'my-uid',
    email: 'me@example.com',
    displayName: 'Me',
    role: 'coach' as const,
    memberships: [{ role: 'coach' as const, teamId: 'team-alpha', isPrimary: true }],
    createdAt: '2024-01-01T00:00:00.000Z',
  },
};

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector: (s: typeof teamStoreState) => unknown) =>
    selector(teamStoreState),
}));

vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (selector: (s: typeof playerStoreState) => unknown) =>
    selector(playerStoreState),
}));

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: typeof authStoreState) => unknown) =>
    selector(authStoreState),
  getMemberships: (profile: { memberships?: Array<{ teamId?: string; isPrimary?: boolean }> }) =>
    profile?.memberships ?? [],
  isMemberOfTeam: (profile: { memberships?: Array<{ teamId?: string }> }, teamId: string) =>
    profile?.memberships?.some(m => m.teamId === teamId) ?? false,
}));

vi.mock('@/store/useTeamChatStore', () => {
  const subscribe = mockSubscribeTeamChat;
  const store = (selector: (s: {
    messages: never[];
    loading: boolean;
    subscribe: typeof mockSubscribeTeamChat;
    sendMessage: () => void;
  }) => unknown) =>
    selector({ messages: [], loading: false, subscribe, sendMessage: vi.fn() });
  store.getState = () => ({ subscribe });
  return { useTeamChatStore: store };
});

vi.mock('@/store/useDmStore', () => {
  const subscribeThreads = mockSubscribeThreads;
  const subscribeMessages = mockSubscribeMessages;
  const store = (selector: (s: {
    threads: never[];
    messages: never[];
    activeThreadId: null;
    loadingThreads: boolean;
    loadingMessages: boolean;
    sendDm: () => void;
  }) => unknown) =>
    selector({
      threads: [],
      messages: [],
      activeThreadId: null,
      loadingThreads: false,
      loadingMessages: false,
      sendDm: vi.fn(),
    });
  store.getState = () => ({ subscribeThreads, subscribeMessages });
  return {
    useDmStore: store,
    dmThreadId: (a: string, b: string) => [a, b].sort().join('_'),
  };
});

// ─── Import after mocks ───────────────────────────────────────────────────────

import { MessagingPage } from '@/pages/MessagingPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeUserSnap(uid: string, displayName: string) {
  return {
    exists: () => true,
    data: () => ({
      uid,
      displayName,
      email: `${uid}@example.com`,
      role: 'coach',
      createdAt: '2024-01-01T00:00:00.000Z',
    }),
  };
}

function navigateToDms() {
  const dmTab = screen.getByRole('tab', { name: /direct messages/i });
  fireEvent.click(dmTab);
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Reset store state to baseline
  teamStoreState = { teams: [{ id: 'team-alpha', name: 'Alpha', coachId: 'uid-coach' }] };
  playerStoreState = { players: [{ id: 'p1', teamId: 'team-alpha', linkedUid: 'uid-a' }] };
  authStoreState = {
    user: { uid: 'my-uid' },
    profile: {
      uid: 'my-uid',
      email: 'me@example.com',
      displayName: 'Me',
      role: 'coach' as const,
      memberships: [{ role: 'coach' as const, teamId: 'team-alpha', isPrimary: true }],
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  };

  mockGetDoc.mockResolvedValue(makeUserSnap('uid-a', 'Alice'));
  mockGetDocs.mockResolvedValue({ docs: [] });
  mockSubscribeThreads.mockReturnValue(() => {});
  mockSubscribeMessages.mockReturnValue(() => {});
  mockSubscribeTeamChat.mockReturnValue(() => {});
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DmPanel — profile fetch cache: no redundant Firestore reads', () => {

  it('fetches profiles from Firestore on the first render', async () => {
    render(<MessagingPage />);
    navigateToDms();

    // "+ New" button in the DM panel header confirms the panel rendered
    await screen.findByRole('button', { name: /\+ new/i });

    expect(mockGetDoc).toHaveBeenCalled();
    const calledUids = mockGetDoc.mock.calls.map(
      (call: [{ id: string }]) => call[0].id
    );
    expect(calledUids).toContain('uid-a');
  });

  it('does NOT re-fetch a UID that was already loaded into the cache', async () => {
    const { rerender } = render(<MessagingPage />);
    navigateToDms();

    await screen.findByRole('button', { name: /\+ new/i });

    const callsAfterFirstRender = mockGetDoc.mock.calls.length;

    // Re-render with identical store state — membershipKey is unchanged,
    // uid-a is already cached, so no new getDoc call should fire.
    rerender(<MessagingPage />);

    expect(mockGetDoc).toHaveBeenCalledTimes(callsAfterFirstRender);
  });

  it('fetches the new UID when a new team is added (new membershipKey triggers effect)', async () => {
    // Note: adding a player to an *existing* team does NOT re-trigger the effect
    // because membershipKey only tracks team IDs, not player lists.
    // A new member on a NEW team does trigger it (membershipKey changes).

    // Use UID-keyed mock so concurrent Promise.all calls get the right profile back.
    const profiles: Record<string, ReturnType<typeof makeUserSnap>> = {
      'uid-a': makeUserSnap('uid-a', 'Alice'),
      'uid-coach': makeUserSnap('uid-coach', 'Coach'),
      'uid-new-coach': makeUserSnap('uid-new-coach', 'Carol'),
    };
    mockGetDoc.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(profiles[id] ?? { exists: () => false, data: () => ({}) })
    );

    // Start with no coachId on team-alpha so only uid-a is fetched initially
    teamStoreState = {
      teams: [{ id: 'team-alpha', name: 'Alpha' }],
    };

    const { rerender } = render(<MessagingPage />);
    navigateToDms();

    await screen.findByRole('button', { name: /\+ new/i });

    // After mount: uid-a should be fetched and in cache
    const callsAfterMount = mockGetDoc.mock.calls.map(
      (call: [{ id: string }]) => call[0].id
    );
    expect(callsAfterMount).toContain('uid-a');

    // Reset call tracking so we can cleanly observe what happens after the rerender
    mockGetDoc.mockClear();
    mockGetDoc.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(profiles[id] ?? { exists: () => false, data: () => ({}) })
    );

    // Add a new team with uid-new-coach as coach. membershipKey changes.
    teamStoreState = {
      teams: [
        { id: 'team-alpha', name: 'Alpha' },
        { id: 'team-beta', name: 'Beta', coachId: 'uid-new-coach' },
      ],
    };
    authStoreState = {
      ...authStoreState,
      profile: {
        ...authStoreState.profile,
        memberships: [
          { role: 'coach' as const, teamId: 'team-alpha', isPrimary: true },
          { role: 'coach' as const, teamId: 'team-beta', isPrimary: false },
        ],
      },
    };

    await act(async () => {
      rerender(<MessagingPage />);
    });

    const calledUidsAfterRerender = mockGetDoc.mock.calls.map(
      (call: [{ id: string }]) => call[0].id
    );
    // uid-a is already in cache → must NOT be fetched again
    expect(calledUidsAfterRerender).not.toContain('uid-a');
    // uid-new-coach is new → must be fetched
    expect(calledUidsAfterRerender).toContain('uid-new-coach');
  });

});

describe('DmPanel — membershipKey stability: effect does not fire on unrelated store refreshes', () => {

  it('does not re-fetch when the team list re-renders with the same team IDs', async () => {
    const { rerender } = render(<MessagingPage />);
    navigateToDms();

    await screen.findByRole('button', { name: /\+ new/i });
    const callsAfterMount = mockGetDoc.mock.calls.length;

    // Simulate a Zustand store re-render that produces the same team state
    // (membershipKey is sorted so order does not matter)
    teamStoreState = {
      teams: [{ id: 'team-alpha', name: 'Alpha', coachId: 'uid-coach' }],
    };

    rerender(<MessagingPage />);

    // No additional getDoc calls
    expect(mockGetDoc).toHaveBeenCalledTimes(callsAfterMount);
  });

  it('DOES re-fetch when a new team with a new coach UID is added', async () => {
    mockGetDoc.mockResolvedValue(makeUserSnap('uid-a', 'Alice'));

    const { rerender } = render(<MessagingPage />);
    navigateToDms();

    await screen.findByRole('button', { name: /\+ new/i });
    const callsAfterMount = mockGetDoc.mock.calls.length;

    // Add a second team whose coach is a new UID not yet in the cache
    teamStoreState = {
      teams: [
        { id: 'team-alpha', name: 'Alpha', coachId: 'uid-coach' },
        { id: 'team-beta', name: 'Beta', coachId: 'uid-new-coach' },
      ],
    };
    authStoreState = {
      ...authStoreState,
      profile: {
        ...authStoreState.profile,
        memberships: [
          { role: 'coach' as const, teamId: 'team-alpha', isPrimary: true },
          { role: 'coach' as const, teamId: 'team-beta', isPrimary: false },
        ],
      },
    };
    playerStoreState = {
      players: [
        { id: 'p1', teamId: 'team-alpha', linkedUid: 'uid-a' },
        { id: 'p2', teamId: 'team-beta', linkedUid: 'uid-new-coach' },
      ],
    };

    await act(async () => {
      rerender(<MessagingPage />);
    });

    // Effect must have fired again because membershipKey changed
    expect(mockGetDoc.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

});

describe('DmPanel — self-exclusion: current user UID is not fetched', () => {

  it('does not call getDoc for the current user\'s own UID', async () => {
    // Include the viewer's own UID in the player list
    playerStoreState = {
      players: [
        { id: 'p1', teamId: 'team-alpha', linkedUid: 'my-uid' }, // self
        { id: 'p2', teamId: 'team-alpha', linkedUid: 'uid-a' },  // other
      ],
    };

    render(<MessagingPage />);
    navigateToDms();

    await screen.findByRole('button', { name: /\+ new/i });

    const calledUids = mockGetDoc.mock.calls.map(
      (call: [{ id: string }]) => call[0].id
    );
    expect(calledUids).not.toContain('my-uid');
    expect(calledUids).toContain('uid-a');
  });

});
