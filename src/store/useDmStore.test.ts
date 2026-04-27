/**
 * useDmStore — unit tests
 *
 * Covers:
 *   dmThreadId():
 *   1. Sorts UIDs lexicographically regardless of call order
 *   2. Identical UIDs produce a consistent (though degenerate) id
 *   3. Format is exactly "uid1_uid2" — no extra separators or whitespace
 *   4. Output is symmetric: dmThreadId(a, b) === dmThreadId(b, a)
 *
 *   sendDm() — FW-108: teamId param contract (SEC-71):
 *   5. Writes teamId to the dmThread doc when provided
 *   6. Uses sorted participants list in the thread doc
 *   7. Writes the message document under the correct thread sub-collection
 *   8. Passes trimmed text to both the thread doc and the message doc
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firestore mock ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockSetDoc = vi.fn<AnyFn>().mockResolvedValue(undefined);
const mockAddDoc = vi.fn<AnyFn>().mockResolvedValue({ id: 'dm-msg-id' });
const mockDoc = vi.fn<AnyFn>((_, ...segments: string[]) => ({ _path: segments.join('/') }));
const mockCollection = vi.fn<AnyFn>((_: unknown, ...segments: string[]) => ({ _path: segments.join('/') }));

vi.mock('@/lib/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  query: vi.fn((ref: unknown) => ref),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  serverTimestamp: vi.fn(() => ({ _type: 'serverTimestamp' })),
  Timestamp: class Timestamp {
    constructor(public seconds: number, public nanoseconds: number) {}
    toDate() { return new Date(this.seconds * 1000); }
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { dmThreadId, useDmStore } from './useDmStore';

describe('dmThreadId()', () => {
  it('returns sorted UIDs joined by underscore', () => {
    expect(dmThreadId('charlie', 'alice')).toBe('alice_charlie');
  });

  it('is symmetric — argument order does not matter', () => {
    const aFirst = dmThreadId('userZ', 'userA');
    const bFirst = dmThreadId('userA', 'userZ');
    expect(aFirst).toBe(bFirst);
  });

  it('places the lexicographically smaller UID first', () => {
    const id = dmThreadId('uid_999', 'uid_001');
    const [first, second] = id.split('_');
    // Both parts together contain "uid" so we compare the full sorted result
    expect(id).toBe('uid_001_uid_999');
    void first; void second; // used above
  });

  it('uses underscore as the sole separator', () => {
    const id = dmThreadId('abc', 'xyz');
    expect(id).toBe('abc_xyz');
    // No extra separators or whitespace
    expect(id).not.toMatch(/\s/);
  });

  it('handles Firebase-style UID strings (alphanumeric with mixed case)', () => {
    const uid1 = 'ABCDEF123456';
    const uid2 = 'abcdef123456';
    // Uppercase letters sort before lowercase in standard string comparison
    const id = dmThreadId(uid1, uid2);
    expect(id).toBe(`${uid1}_${uid2}`);
    // Reversed call produces the same id
    expect(dmThreadId(uid2, uid1)).toBe(id);
  });

  it('produces the same id for identical UIDs (degenerate case)', () => {
    const id = dmThreadId('sameUid', 'sameUid');
    expect(id).toBe('sameUid_sameUid');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sendDm() — FW-108: teamId param (SEC-71 rule contract)
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
  mockAddDoc.mockResolvedValue({ id: 'dm-msg-id' });
});

const MY_UID = 'uid-coach';
const OTHER_UID = 'uid-parent';
const TEAM_ID = 'team-lions';

describe('useDmStore — sendDm (FW-108)', () => {

  it('writes teamId to the dmThread doc (SEC-71 rule contract)', async () => {
    await useDmStore.getState().sendDm(MY_UID, 'Coach Bob', OTHER_UID, 'Parent Alice', 'Hello', TEAM_ID);

    expect(mockSetDoc).toHaveBeenCalledOnce();
    const [_ref, data] = mockSetDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(data.teamId).toBe(TEAM_ID);
  });

  it('passes teamId through when a different teamId is provided', async () => {
    const differentTeam = 'team-tigers';
    await useDmStore.getState().sendDm(MY_UID, 'Coach Bob', OTHER_UID, 'Parent Alice', 'Yo', differentTeam);

    const [_ref, data] = mockSetDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(data.teamId).toBe(differentTeam);
  });

  it('writes sorted participants to the thread doc', async () => {
    await useDmStore.getState().sendDm(MY_UID, 'Coach Bob', OTHER_UID, 'Parent Alice', 'Hi', TEAM_ID);

    const [_ref, data] = mockSetDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    const participants = data.participants as string[];
    expect(participants).toEqual([MY_UID, OTHER_UID].sort());
  });

  it('writes the message document to the correct dmThreads/{threadId}/messages path', async () => {
    await useDmStore.getState().sendDm(MY_UID, 'Coach Bob', OTHER_UID, 'Parent Alice', 'Hi', TEAM_ID);

    expect(mockAddDoc).toHaveBeenCalledOnce();
    // Verify the collection reference was built for the correct thread
    const expectedThreadId = dmThreadId(MY_UID, OTHER_UID);
    // mockCollection receives (db, 'dmThreads', threadId, 'messages')
    const collArgs = mockCollection.mock.calls[0] as [unknown, string, string, string];
    expect(collArgs[1]).toBe('dmThreads');
    expect(collArgs[2]).toBe(expectedThreadId);
    expect(collArgs[3]).toBe('messages');
  });

  it('trims message text before writing to both the thread doc and the message doc', async () => {
    await useDmStore.getState().sendDm(MY_UID, 'Coach Bob', OTHER_UID, 'Parent Alice', '  hello  ', TEAM_ID);

    const [_threadRef, threadData] = mockSetDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(threadData.lastMessage).toBe('hello');

    const [_collRef, msgData] = mockAddDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(msgData.text).toBe('hello');
  });

  it('writes participantNames map with both sides of the conversation', async () => {
    await useDmStore.getState().sendDm(MY_UID, 'Coach Bob', OTHER_UID, 'Parent Alice', 'Hi', TEAM_ID);

    const [_ref, data] = mockSetDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    const names = data.participantNames as Record<string, string>;
    expect(names[MY_UID]).toBe('Coach Bob');
    expect(names[OTHER_UID]).toBe('Parent Alice');
  });

  it('calls setDoc with { merge: true } so existing thread metadata is preserved', async () => {
    await useDmStore.getState().sendDm(MY_UID, 'Coach Bob', OTHER_UID, 'Parent Alice', 'Hi', TEAM_ID);

    const [, , options] = mockSetDoc.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
    expect(options).toEqual({ merge: true });
  });
});
