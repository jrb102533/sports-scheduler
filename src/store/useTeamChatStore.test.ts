/**
 * useTeamChatStore — unit tests
 *
 * Covers:
 *   subscribe():
 *     - populates messages from Firestore snapshot
 *     - maps createdAt Timestamp objects to ISO strings
 *     - falls back to current time when createdAt is missing
 *     - sets loading: false after snapshot fires
 *     - logs error and sets loading: false on snapshot error
 *     - skips re-subscribe when already subscribed to the same team with messages
 *     - returns an unsubscribe function
 *
 *   sendMessage():
 *     - calls addDoc with the correct path and fields
 *     - trims whitespace from message text before writing
 *     - propagates addDoc errors to the caller
 *
 * No emulator is needed — Firestore is mocked at the module boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firestore mock ────────────────────────────────────────────────────────────

// Capture onSnapshot callbacks so tests can push snapshots
type SnapCb = (snap: unknown) => void;
type ErrCb = (err: Error) => void;

const { _mockAddDoc, _mockOnSnapshot, _snapCallbacks } = vi.hoisted(() => {
  const snapCallbacks: Array<{ cb: SnapCb; errCb?: ErrCb }> = [];
  const mockOnSnapshot = vi.fn((_q: unknown, cb: SnapCb, errCb?: ErrCb) => {
    snapCallbacks.push({ cb, errCb });
    return () => {};
  });
  const mockAddDoc = vi.fn().mockResolvedValue({ id: 'msg-auto-id' });
  return { _mockAddDoc: mockAddDoc, _mockOnSnapshot: mockOnSnapshot, _snapCallbacks: snapCallbacks };
});

vi.mock('@/lib/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, ...pathSegments: string[]) => ({
    _path: pathSegments.join('/'),
  })),
  query: vi.fn((ref: unknown) => ref),
  orderBy: vi.fn(),
  limit: vi.fn(),
  onSnapshot: _mockOnSnapshot,
  addDoc: _mockAddDoc,
  serverTimestamp: vi.fn(() => ({ _type: 'serverTimestamp' })),
  Timestamp: class Timestamp {
    constructor(public seconds: number, public nanoseconds: number) {}
    toDate() {
      return new Date(this.seconds * 1000);
    }
  },
}));

// Convenience aliases
const mockAddDoc = _mockAddDoc;
const mockOnSnapshot = _mockOnSnapshot;

// ── Import store ──────────────────────────────────────────────────────────────

import { useTeamChatStore } from './useTeamChatStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSnap(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return {
    docs: docs.map(d => ({
      id: d.id,
      data: () => d.data,
    })),
  };
}

function getLastSnapCallback() {
  return _snapCallbacks[_snapCallbacks.length - 1];
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useTeamChatStore.setState({ messages: [], loading: false, teamId: null });
  _snapCallbacks.length = 0;
  vi.clearAllMocks();
  mockAddDoc.mockResolvedValue({ id: 'msg-auto-id' });
});

// ─────────────────────────────────────────────────────────────────────────────
// subscribe()
// ─────────────────────────────────────────────────────────────────────────────

describe('useTeamChatStore — subscribe', () => {

  it('populates messages from Firestore snapshot, displaying in ascending order', () => {
    // Query is orderBy('createdAt', 'desc') limit 25 — Firestore returns the
    // latest message first. The store reverses to ascending for display so
    // the oldest visible message is at index 0.
    useTeamChatStore.getState().subscribe('team-abc');

    const { cb } = getLastSnapCallback();
    cb(makeSnap([
      { id: 'msg-2', data: { teamId: 'team-abc', senderId: 'u2', senderName: 'Bob', text: 'Hi', createdAt: '2026-01-01T00:01:00.000Z' } },
      { id: 'msg-1', data: { teamId: 'team-abc', senderId: 'u1', senderName: 'Alice', text: 'Hello', createdAt: '2026-01-01T00:00:00.000Z' } },
    ]));

    const { messages } = useTeamChatStore.getState();
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe('msg-1');
    expect(messages[0].text).toBe('Hello');
    expect(messages[1].id).toBe('msg-2');
  });

  it('maps Firestore Timestamp createdAt to ISO string', async () => {
    const { Timestamp } = await import('firebase/firestore');
    useTeamChatStore.getState().subscribe('team-abc');

    const { cb } = getLastSnapCallback();
    const ts = new Timestamp(1_700_000_000, 0); // 2023-11-14T22:13:20Z
    cb(makeSnap([
      { id: 'msg-ts', data: { senderId: 'u1', senderName: 'Alice', text: 'TS test', createdAt: ts } },
    ]));

    const { messages } = useTeamChatStore.getState();
    expect(messages[0].createdAt).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it('falls back to a string when createdAt is already a string', () => {
    useTeamChatStore.getState().subscribe('team-abc');

    const { cb } = getLastSnapCallback();
    cb(makeSnap([
      { id: 'msg-str', data: { senderId: 'u1', senderName: 'Alice', text: 'String', createdAt: '2026-01-01T10:00:00.000Z' } },
    ]));

    const { messages } = useTeamChatStore.getState();
    expect(messages[0].createdAt).toBe('2026-01-01T10:00:00.000Z');
  });

  it('sets loading: false after snapshot fires', () => {
    useTeamChatStore.getState().subscribe('team-abc');
    expect(useTeamChatStore.getState().loading).toBe(true);

    const { cb } = getLastSnapCallback();
    cb(makeSnap([]));

    expect(useTeamChatStore.getState().loading).toBe(false);
  });

  it('logs error and sets loading: false on snapshot error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    useTeamChatStore.getState().subscribe('team-abc');

    const { errCb } = getLastSnapCallback();
    errCb!(new Error('Firestore permission denied'));

    expect(useTeamChatStore.getState().loading).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[useTeamChatStore]'),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('skips re-subscribe when already subscribed to the same team with messages', () => {
    // Pre-seed state to simulate an active subscription
    useTeamChatStore.setState({
      teamId: 'team-abc',
      messages: [{ id: 'm1', teamId: 'team-abc', senderId: 'u1', senderName: 'A', text: 'Hi', createdAt: '2026-01-01T00:00:00Z' }],
      loading: false,
    });

    useTeamChatStore.getState().subscribe('team-abc');

    // onSnapshot should NOT have been called again — early return
    expect(mockOnSnapshot).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe function', () => {
    const unsubFn = vi.fn();
    mockOnSnapshot.mockReturnValueOnce(unsubFn);

    const unsub = useTeamChatStore.getState().subscribe('team-xyz');
    expect(typeof unsub).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sendMessage()
// ─────────────────────────────────────────────────────────────────────────────

describe('useTeamChatStore — sendMessage', () => {

  it('calls addDoc with the correct collection path and message fields', async () => {
    await useTeamChatStore.getState().sendMessage('team-abc', 'u1', 'Alice', 'Hello team!');

    expect(mockAddDoc).toHaveBeenCalledOnce();
    const [_collRef, data] = mockAddDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(data.teamId).toBe('team-abc');
    expect(data.senderId).toBe('u1');
    expect(data.senderName).toBe('Alice');
    expect(data.text).toBe('Hello team!');
    expect(data.createdAt).toEqual({ _type: 'serverTimestamp' });
  });

  it('trims leading and trailing whitespace from message text', async () => {
    await useTeamChatStore.getState().sendMessage('team-abc', 'u1', 'Alice', '  Hi there!  ');

    const [_collRef, data] = mockAddDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(data.text).toBe('Hi there!');
  });

  it('propagates addDoc errors to the caller', async () => {
    mockAddDoc.mockRejectedValueOnce(new Error('Firestore write denied'));

    await expect(
      useTeamChatStore.getState().sendMessage('team-abc', 'u1', 'Alice', 'Hello')
    ).rejects.toThrow('Firestore write denied');
  });
});
