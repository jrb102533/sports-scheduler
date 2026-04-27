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
 *   loadOlder() — FW-107:
 *     - prepends older messages in ascending order before existing messages
 *     - advances oldestCursor to the last doc of the fetched page
 *     - second call uses the updated cursor (startAfter receives new cursor)
 *     - does not double-fetch when loadingOlder is already true
 *     - sets reachedStart when page is smaller than PAGE_SIZE
 *     - is a no-op when reachedStart is already true
 *     - is a no-op when there is no oldestCursor
 *     - is a no-op when teamId is null
 *
 * No emulator is needed — Firestore is mocked at the module boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firestore mock ────────────────────────────────────────────────────────────

// Capture onSnapshot callbacks so tests can push snapshots
type SnapCb = (snap: unknown) => void;
type ErrCb = (err: Error) => void;

const { _mockAddDoc, _mockGetDocs, _mockOnSnapshot, _mockStartAfter, _snapCallbacks } = vi.hoisted(() => {
  const snapCallbacks: Array<{ cb: SnapCb; errCb?: ErrCb }> = [];
  const mockOnSnapshot = vi.fn((_q: unknown, cb: SnapCb, errCb?: ErrCb) => {
    snapCallbacks.push({ cb, errCb });
    return () => {};
  });
  const mockAddDoc = vi.fn().mockResolvedValue({ id: 'msg-auto-id' });
  const mockGetDocs = vi.fn().mockResolvedValue({ docs: [] });
  const mockStartAfter = vi.fn(cursor => cursor); // returns its argument for inspection
  return {
    _mockAddDoc: mockAddDoc,
    _mockGetDocs: mockGetDocs,
    _mockOnSnapshot: mockOnSnapshot,
    _mockStartAfter: mockStartAfter,
    _snapCallbacks: snapCallbacks,
  };
});

vi.mock('@/lib/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, ...pathSegments: string[]) => ({
    _path: pathSegments.join('/'),
  })),
  query: vi.fn((ref: unknown) => ref),
  orderBy: vi.fn(),
  limit: vi.fn(),
  startAfter: _mockStartAfter,
  onSnapshot: _mockOnSnapshot,
  addDoc: _mockAddDoc,
  getDocs: _mockGetDocs,
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
const mockGetDocs = _mockGetDocs;
const mockOnSnapshot = _mockOnSnapshot;
const mockStartAfter = _mockStartAfter;

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
  useTeamChatStore.setState({
    messages: [],
    loading: false,
    loadingOlder: false,
    teamId: null,
    oldestCursor: null,
    reachedStart: false,
  });
  _snapCallbacks.length = 0;
  vi.clearAllMocks();
  mockAddDoc.mockResolvedValue({ id: 'msg-auto-id' });
  mockGetDocs.mockResolvedValue({ docs: [] });
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

// ─────────────────────────────────────────────────────────────────────────────
// loadOlder() — FW-107: cursor pagination
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper: create a mock Firestore QueryDocumentSnapshot-like object.
 * The store stores these as `oldestCursor` and passes them to startAfter().
 */
function makeCursor(id: string) {
  return { id, data: () => ({ text: 'cursor-doc' }) };
}

function makeGetDocsSnap(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return {
    docs: docs.map(d => ({
      id: d.id,
      data: () => d.data,
    })),
  };
}

describe('useTeamChatStore — loadOlder (FW-107)', () => {

  it('prepends older messages in ascending order before the existing messages', async () => {
    const existingCursor = makeCursor('msg-new');

    // Seed the store with one existing message and a valid cursor
    useTeamChatStore.setState({
      teamId: 'team-abc',
      oldestCursor: existingCursor as never,
      reachedStart: false,
      loadingOlder: false,
      messages: [
        { id: 'msg-new', teamId: 'team-abc', senderId: 'u1', senderName: 'Alice', text: 'Latest', createdAt: '2026-01-01T01:00:00.000Z' },
      ],
    });

    // getDocs returns two older messages in desc order (most-recent first)
    mockGetDocs.mockResolvedValueOnce(
      makeGetDocsSnap([
        { id: 'msg-mid', data: { teamId: 'team-abc', senderId: 'u1', senderName: 'Alice', text: 'Middle', createdAt: '2026-01-01T00:30:00.000Z' } },
        { id: 'msg-old', data: { teamId: 'team-abc', senderId: 'u1', senderName: 'Alice', text: 'Oldest', createdAt: '2026-01-01T00:00:00.000Z' } },
      ]),
    );

    await useTeamChatStore.getState().loadOlder();

    const { messages } = useTeamChatStore.getState();
    // Older messages are prepended in ascending order; existing message is last.
    expect(messages).toHaveLength(3);
    expect(messages[0].id).toBe('msg-old');
    expect(messages[1].id).toBe('msg-mid');
    expect(messages[2].id).toBe('msg-new');
  });

  it('advances oldestCursor to the last document of the fetched page', async () => {
    const initialCursor = makeCursor('msg-current-oldest');
    useTeamChatStore.setState({
      teamId: 'team-abc',
      oldestCursor: initialCursor as never,
      reachedStart: false,
      loadingOlder: false,
      messages: [],
    });

    const olderDoc1 = { id: 'msg-b', data: { teamId: 'team-abc', senderId: 'u1', senderName: 'A', text: 'B', createdAt: '2026-01-01T00:02:00.000Z' } };
    const olderDoc2 = { id: 'msg-a', data: { teamId: 'team-abc', senderId: 'u1', senderName: 'A', text: 'A', createdAt: '2026-01-01T00:01:00.000Z' } };
    mockGetDocs.mockResolvedValueOnce(makeGetDocsSnap([olderDoc1, olderDoc2]));

    await useTeamChatStore.getState().loadOlder();

    const { oldestCursor } = useTeamChatStore.getState();
    // The cursor should now point to the last doc returned by the query (msg-a)
    expect((oldestCursor as { id: string } | null)?.id).toBe('msg-a');
  });

  it('subsequent call passes the updated cursor to startAfter', async () => {
    const cursor1 = makeCursor('cursor-1');
    useTeamChatStore.setState({
      teamId: 'team-abc',
      oldestCursor: cursor1 as never,
      reachedStart: false,
      loadingOlder: false,
      messages: [],
    });

    const cursor2 = makeCursor('cursor-2');
    // First load: return a full page of 25 docs (use a single doc for simplicity)
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ id: cursor2.id, data: () => ({ teamId: 'team-abc', senderId: 'u1', senderName: 'A', text: 'x', createdAt: '2026-01-01T00:00:00.000Z' }) }],
    });

    await useTeamChatStore.getState().loadOlder();

    // Force reachedStart off so the second call is not blocked
    useTeamChatStore.setState({ reachedStart: false });

    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    await useTeamChatStore.getState().loadOlder();

    // The second call's startAfter should have received cursor2 (the new cursor)
    expect(mockStartAfter).toHaveBeenCalledTimes(2);
    const secondCallArg = mockStartAfter.mock.calls[1][0] as { id: string };
    expect(secondCallArg.id).toBe(cursor2.id);
  });

  it('does not issue a second fetch when loadingOlder is already true', async () => {
    useTeamChatStore.setState({
      teamId: 'team-abc',
      oldestCursor: makeCursor('c1') as never,
      reachedStart: false,
      loadingOlder: true, // already in flight
      messages: [],
    });

    await useTeamChatStore.getState().loadOlder();

    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('sets reachedStart to true when page returned is smaller than PAGE_SIZE (25)', async () => {
    useTeamChatStore.setState({
      teamId: 'team-abc',
      oldestCursor: makeCursor('c1') as never,
      reachedStart: false,
      loadingOlder: false,
      messages: [],
    });

    // Fewer than 25 docs → we've reached the start of history
    mockGetDocs.mockResolvedValueOnce(
      makeGetDocsSnap([
        { id: 'msg-only', data: { teamId: 'team-abc', senderId: 'u1', senderName: 'A', text: 'Only', createdAt: '2026-01-01T00:00:00.000Z' } },
      ]),
    );

    await useTeamChatStore.getState().loadOlder();

    expect(useTeamChatStore.getState().reachedStart).toBe(true);
  });

  it('is a no-op when reachedStart is already true (terminal state)', async () => {
    useTeamChatStore.setState({
      teamId: 'team-abc',
      oldestCursor: makeCursor('c1') as never,
      reachedStart: true, // already at the beginning
      loadingOlder: false,
      messages: [],
    });

    await useTeamChatStore.getState().loadOlder();

    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('is a no-op when oldestCursor is null', async () => {
    useTeamChatStore.setState({
      teamId: 'team-abc',
      oldestCursor: null,
      reachedStart: false,
      loadingOlder: false,
      messages: [],
    });

    await useTeamChatStore.getState().loadOlder();

    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('is a no-op when teamId is null', async () => {
    useTeamChatStore.setState({
      teamId: null,
      oldestCursor: makeCursor('c1') as never,
      reachedStart: false,
      loadingOlder: false,
      messages: [],
    });

    await useTeamChatStore.getState().loadOlder();

    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('resets loadingOlder to false and logs on getDocs error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    useTeamChatStore.setState({
      teamId: 'team-abc',
      oldestCursor: makeCursor('c1') as never,
      reachedStart: false,
      loadingOlder: false,
      messages: [],
    });

    mockGetDocs.mockRejectedValueOnce(new Error('Firestore unavailable'));

    await useTeamChatStore.getState().loadOlder();

    expect(useTeamChatStore.getState().loadingOlder).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[useTeamChatStore]'),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});
