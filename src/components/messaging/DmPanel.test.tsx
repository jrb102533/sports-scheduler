/**
 * DmPanel — smoke tests (FW-106)
 *
 * Covers:
 *  1. Mounts without crashing
 *  2. Renders "Direct Messages" header in the default (list) view
 *  3. Renders the DmList empty state when threads array is empty
 *  4. Renders thread contact names when threads are provided
 *  5. Does not throw when optional profile fields are absent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DmThread } from '@/types';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {} }));

// scrollIntoView is not implemented in jsdom; stub to avoid errors from
// ThreadView (rendered when a thread is active — not exercised in these tests,
// but the import still happens).
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Stub lucide-react icons used by DmPanel / DmList
vi.mock('lucide-react', () => ({
  ChevronLeft: () => <span data-testid="icon-chevron-left" />,
  MessageCircle: () => <span data-testid="icon-message-circle" />,
  Send: () => <span data-testid="icon-send" />,
}));

// ── useTeamStore ──────────────────────────────────────────────────────────────

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector: (s: { teams: unknown[] }) => unknown) =>
    selector({ teams: [] }),
}));

// ── usePlayerStore ────────────────────────────────────────────────────────────

vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (selector: (s: { players: unknown[] }) => unknown) =>
    selector({ players: [] }),
}));

// ── useAuthStore ──────────────────────────────────────────────────────────────

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: { profile: unknown }) => unknown) =>
    selector({ profile: null }),
}));

// ── useDmStore ────────────────────────────────────────────────────────────────

// Mutable state exposed so individual tests can set threads.
const dmStoreState: {
  threads: DmThread[];
  messages: unknown[];
  activeThreadId: string | null;
  loadingThreads: boolean;
  loadingMessages: boolean;
  sendDm: ReturnType<typeof vi.fn>;
  subscribeThreads: ReturnType<typeof vi.fn>;
} = {
  threads: [],
  messages: [],
  activeThreadId: null,
  loadingThreads: false,
  loadingMessages: false,
  sendDm: vi.fn(),
  subscribeThreads: vi.fn(() => vi.fn()),
};

vi.mock('@/store/useDmStore', () => {
  const selector = (
    sel: (s: typeof dmStoreState) => unknown,
  ) => sel(dmStoreState);
  selector.getState = () => ({
    subscribeThreads: dmStoreState.subscribeThreads,
    subscribeMessages: vi.fn(() => vi.fn()),
  });
  return {
    useDmStore: selector,
    dmThreadId: (a: string, b: string) => [a, b].sort().join('_'),
  };
});

// ── dmCoachLed helpers ────────────────────────────────────────────────────────

vi.mock('@/lib/dmCoachLed', () => ({
  filterCoachLedThreads: (_threads: DmThread[]) => _threads,
  filterCoachLedContacts: (uids: string[]) => uids,
  findCoachLedTeamId: () => null,
}));

// ── messagingUnread ───────────────────────────────────────────────────────────

vi.mock('@/lib/messagingUnread', () => ({
  markThreadRead: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { DmPanel } from './DmPanel';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MY_UID = 'uid-me';
const OTHER_UID = 'uid-other';

function makeThread(overrides: Partial<DmThread> = {}): DmThread {
  return {
    id: `${MY_UID}_${OTHER_UID}`,
    participants: [MY_UID, OTHER_UID],
    participantNames: { [MY_UID]: 'Me', [OTHER_UID]: 'Alice' },
    lastMessage: 'Hey!',
    lastMessageAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  dmStoreState.threads = [];
  dmStoreState.messages = [];
  dmStoreState.activeThreadId = null;
  dmStoreState.loadingThreads = false;
  dmStoreState.loadingMessages = false;
  dmStoreState.subscribeThreads.mockReset();
  dmStoreState.subscribeThreads.mockReturnValue(vi.fn());
  dmStoreState.sendDm.mockReset();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DmPanel — smoke', () => {
  it('mounts without crashing', () => {
    // If this throws, the component has a fatal render error.
    expect(() =>
      render(<DmPanel myUid={MY_UID} myName="Me" />),
    ).not.toThrow();
  });

  it('renders the Direct Messages header in the default list view', () => {
    render(<DmPanel myUid={MY_UID} myName="Me" />);
    expect(screen.getByText('Direct Messages')).toBeInTheDocument();
  });

  it('renders the DmList empty state when threads is an empty array', () => {
    dmStoreState.threads = [];
    render(<DmPanel myUid={MY_UID} myName="Me" />);
    expect(screen.getByText('No conversations yet')).toBeInTheDocument();
  });

  it('renders thread contact names when threads are provided', () => {
    dmStoreState.threads = [
      makeThread({ participantNames: { [MY_UID]: 'Me', [OTHER_UID]: 'Alice' } }),
    ];
    render(<DmPanel myUid={MY_UID} myName="Me" />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('renders multiple threads without crashing', () => {
    const uid2 = 'uid-bob';
    const uid3 = 'uid-carol';
    dmStoreState.threads = [
      makeThread({ id: `${MY_UID}_${uid2}`, participants: [MY_UID, uid2], participantNames: { [MY_UID]: 'Me', [uid2]: 'Bob' } }),
      makeThread({ id: `${MY_UID}_${uid3}`, participants: [MY_UID, uid3], participantNames: { [MY_UID]: 'Me', [uid3]: 'Carol' } }),
    ];
    render(<DmPanel myUid={MY_UID} myName="Me" />);
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
  });

  it('does not throw when profile is null (missing optional prop)', () => {
    // useAuthStore returns profile: null — component must handle it gracefully
    expect(() =>
      render(<DmPanel myUid={MY_UID} myName="Me" />),
    ).not.toThrow();
  });

  it('shows a "+ New" button to compose a new DM', () => {
    render(<DmPanel myUid={MY_UID} myName="Me" />);
    expect(screen.getByRole('button', { name: '+ New' })).toBeInTheDocument();
  });

  it('shows loading state when loadingThreads is true', () => {
    dmStoreState.loadingThreads = true;
    render(<DmPanel myUid={MY_UID} myName="Me" />);
    expect(screen.getByText('Loading conversations…')).toBeInTheDocument();
  });
});
