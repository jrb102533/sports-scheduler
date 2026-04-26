/**
 * TeamChatPanel — smoke + unread-clear tests
 *
 * The panel is intentionally simple: subscribe on mount, render via ThreadView,
 * mark the team as read whenever the visible state of `lastMessageAt` updates.
 *
 * Tests:
 *  1. Subscribes to the provided teamId on mount and unsubscribes on unmount
 *  2. Calls markTeamRead with the team's denormalized lastMessageAt on mount
 *  3. Re-marks read when lastMessageAt updates (new message arrived while open)
 *  4. Renders the ThreadView wrapper (smoke)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {} }));

// ThreadView uses scrollIntoView (not implemented in jsdom). Stub it — these
// tests only care about TeamChatPanel's subscription/markRead behavior.
vi.mock('@/components/messaging/ThreadView', () => ({
  ThreadView: () => <div data-testid="thread-view-stub" />,
}));

const mockSubscribe = vi.fn(() => vi.fn());
const mockSendMessage = vi.fn();

vi.mock('@/store/useTeamChatStore', () => {
  const store = (selector: (s: { messages: never[]; loading: boolean; sendMessage: typeof mockSendMessage }) => unknown) =>
    selector({ messages: [], loading: false, sendMessage: mockSendMessage });
  store.getState = () => ({ subscribe: mockSubscribe });
  return { useTeamChatStore: store };
});

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: { user: { uid: string } | null; profile: { displayName: string } | null }) => unknown) =>
    selector({ user: { uid: 'uid-1' }, profile: { displayName: 'Alice' } }),
}));

let teamLastMessageAt: string | undefined = '2026-04-26T12:00:00Z';
vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector: (s: { teams: Array<{ id: string; lastMessageAt?: string }> }) => unknown) =>
    selector({ teams: [{ id: 'team-1', lastMessageAt: teamLastMessageAt }] }),
}));

const mockMarkTeamRead = vi.fn();
vi.mock('@/lib/messagingUnread', () => ({
  markTeamRead: (...args: unknown[]) => mockMarkTeamRead(...args),
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import { TeamChatPanel } from '../components/teams/TeamChatPanel';

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockSubscribe.mockClear();
  mockSendMessage.mockClear();
  mockMarkTeamRead.mockClear();
  teamLastMessageAt = '2026-04-26T12:00:00Z';
});

describe('TeamChatPanel', () => {
  it('subscribes to the provided teamId on mount', () => {
    render(<TeamChatPanel teamId="team-1" />);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledWith('team-1');
  });

  it('unsubscribes on unmount', () => {
    const unsub = vi.fn();
    mockSubscribe.mockReturnValueOnce(unsub);

    const { unmount } = render(<TeamChatPanel teamId="team-1" />);
    expect(unsub).not.toHaveBeenCalled();
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('marks the team as read on mount with the denormalized lastMessageAt', () => {
    render(<TeamChatPanel teamId="team-1" />);
    expect(mockMarkTeamRead).toHaveBeenCalledWith('team-1', '2026-04-26T12:00:00Z');
  });

  it('marks the team as read again when lastMessageAt updates while panel is open', () => {
    const { rerender } = render(<TeamChatPanel teamId="team-1" />);
    expect(mockMarkTeamRead).toHaveBeenCalledTimes(1);
    expect(mockMarkTeamRead).toHaveBeenLastCalledWith('team-1', '2026-04-26T12:00:00Z');

    // Simulate a new message arriving while the panel is mounted
    teamLastMessageAt = '2026-04-26T12:05:00Z';
    rerender(<TeamChatPanel teamId="team-1" />);

    expect(mockMarkTeamRead).toHaveBeenCalledTimes(2);
    expect(mockMarkTeamRead).toHaveBeenLastCalledWith('team-1', '2026-04-26T12:05:00Z');
  });

  it('passes a sane fallback to markTeamRead when team has no lastMessageAt yet', () => {
    teamLastMessageAt = undefined;
    render(<TeamChatPanel teamId="team-1" />);
    expect(mockMarkTeamRead).toHaveBeenCalledWith('team-1', undefined);
  });
});
