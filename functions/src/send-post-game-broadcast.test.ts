/**
 * Tests for the sendPostGameBroadcast callable Cloud Function.
 *
 * Covers:
 *   1.  Unauthenticated caller → 'unauthenticated'
 *   2.  Caller is neither admin nor coach → 'permission-denied'
 *   3.  Missing eventId → 'invalid-argument'
 *   4.  Missing teamId → 'invalid-argument'
 *   5.  Event not found → 'not-found'
 *   6.  Happy path: notifications are created for all legacy scalar users
 *   7.  Happy path: notifications are created for coach-ids on the team document
 *   8.  Happy path: notifications are created for linked players and their parents
 *   9.  Returns { sent: N } where N is the number of notifications created
 *  10.  Returns { sent: 0 } when no users are found for the team
 *  11.  Score result is formatted as "Title: homeScore – awayScore" in notification
 *  12.  Placement result is formatted as "Title: placement" in notification
 *  13.  Result-less event gets generic "Result: Title" summary
 *  14.  manOfTheMatchPlayerId is resolved to player name in notification message
 *  15.  Duplicate UIDs across data sources are deduplicated (sent once each)
 *
 * Mocking strategy: follows the pattern established in delete-league.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted store shared across mocks ───────────────────────────────────────

const { _store } = vi.hoisted(() => {
  type DocData = Record<string, unknown>;
  const store: Map<string, DocData> = new Map();
  return { _store: store };
});

// ─── Firebase Functions mocks ─────────────────────────────────────────────────

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn(
    (handlerOrOptions: unknown, maybeHandler?: (req: unknown) => unknown) =>
      typeof maybeHandler === 'function' ? maybeHandler : handlerOrOptions,
  ),
  onRequest: vi.fn((handler: unknown) => handler),
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'HttpsError';
      this.code = code;
    }
  },
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn(),
  onDocumentUpdated: vi.fn(),
  onDocumentWritten: vi.fn(),
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: vi.fn(),
}));

vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn(() => ({ value: vi.fn(() => '') })),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: vi.fn().mockResolvedValue({}),
  })),
}));

// ─── firebase-admin mock ──────────────────────────────────────────────────────

vi.mock('firebase-admin', () => {
  type DocData = Record<string, unknown>;

  // A lightweight auto-id counter
  let _idCounter = 0;

  // MockDocRef supports chained .collection() for subcollections
  class MockDocRef {
    constructor(public path: string) {}
    async get() {
      const data = _store.get(this.path);
      return { exists: data !== undefined, data: () => data };
    }
    async set(data: DocData) { _store.set(this.path, data); }
    async update(patch: DocData) {
      const current = (_store.get(this.path) ?? {}) as Record<string, unknown>;
      _store.set(this.path, { ...current, ...patch });
    }
    async delete() { _store.delete(this.path); }
    // Support subcollection chaining: doc.collection('sub')
    collection(subPath: string): MockCollectionRef {
      return new MockCollectionRef(`${this.path}/${subPath}`);
    }
  }

  class MockCollectionRef {
    constructor(private _path: string) {}

    // Returns a doc ref for the auto-generated sub-path
    doc(id?: string): MockDocRef {
      const docId = id ?? `auto-id-${++_idCounter}`;
      return new MockDocRef(`${this._path}/${docId}`);
    }

    where(field: string, op: string, value: unknown): MockQuery {
      return new MockQuery(this._path, [{ field, op, value }]);
    }
  }

  class MockQuery {
    constructor(
      private _collectionPath: string,
      private _filters: Array<{ field: string; op: string; value: unknown }> = [],
    ) {}

    where(field: string, op: string, value: unknown): MockQuery {
      return new MockQuery(this._collectionPath, [
        ...this._filters,
        { field, op, value },
      ]);
    }

    async get() {
      const docs: Array<{ id: string; ref: MockDocRef; data: () => DocData }> = [];
      for (const [path, data] of _store.entries()) {
        if (!path.startsWith(this._collectionPath + '/')) continue;
        const rest = path.slice(this._collectionPath.length + 1);
        if (rest.includes('/')) continue;
        let matches = true;
        for (const f of this._filters) {
          if (f.op === '==' && data[f.field] !== f.value) { matches = false; break; }
          if (f.op === 'array-contains') {
            const arr = data[f.field];
            if (!Array.isArray(arr) || !arr.includes(f.value)) { matches = false; break; }
          }
        }
        if (matches) {
          docs.push({ id: rest, ref: new MockDocRef(path), data: () => data });
        }
      }
      return { empty: docs.length === 0, size: docs.length, docs };
    }
  }

  class MockBatch {
    private _ops: Array<() => Promise<void>> = [];
    set(ref: MockDocRef, data: DocData) { this._ops.push(() => ref.set(data)); }
    update(ref: MockDocRef, patch: DocData) { this._ops.push(() => ref.update(patch)); }
    delete(ref: MockDocRef) { this._ops.push(() => ref.delete()); }
    async commit() { for (const op of this._ops) await op(); }
  }

  const firestoreInstance = {
    doc: (path: string) => new MockDocRef(path),
    collection: (path: string) => new MockCollectionRef(path),
    batch: () => new MockBatch(),
    runTransaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      return cb({});
    },
  };

  const FieldValue = {
    increment: (n: number) => ({ __increment: n }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
    delete: () => ({ __delete: true }),
  };

  const firestoreFn = Object.assign(() => firestoreInstance, { FieldValue });

  return {
    default: {
      initializeApp: vi.fn(),
      firestore: firestoreFn,
      auth: vi.fn(() => ({
        createUser: vi.fn(),
        deleteUser: vi.fn(),
        getUserByEmail: vi.fn(),
      })),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => ({
      createUser: vi.fn(),
      deleteUser: vi.fn(),
      getUserByEmail: vi.fn(),
    })),
  };
});

// ─── Import under test ────────────────────────────────────────────────────────

import { sendPostGameBroadcast } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type DocData = Record<string, unknown>;

function makeRequest(data: unknown, uid: string | null) {
  return uid ? { auth: { uid }, data } : { auth: null, data };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
}

/** Returns all keys in the store that match the prefix pattern */
function keysUnder(prefix: string): string[] {
  return [..._store.keys()].filter(k => k.startsWith(prefix));
}

const fn = sendPostGameBroadcast as unknown as (req: unknown) => Promise<unknown>;

// ─── Constants ────────────────────────────────────────────────────────────────

const TEAM_ID = 'team-alpha';
const EVENT_ID = 'event-1';
const COACH_UID = 'coach1';
const ADMIN_UID = 'admin1';
const PARENT_UID = 'parent1';
const PLAYER_UID = 'player1';
const LEGACY_USER_UID = 'legacy-user1';

function seedBaseFixtures() {
  seedDoc(`users/${ADMIN_UID}`, { role: 'admin' });
  seedDoc(`users/${COACH_UID}`, { role: 'coach' });
  seedDoc(`teams/${TEAM_ID}`, { id: TEAM_ID, coachIds: [COACH_UID] });
  seedDoc(`events/${EVENT_ID}`, {
    id: EVENT_ID,
    title: 'Championship Game',
    teamIds: [TEAM_ID],
    result: { homeScore: 3, awayScore: 1 },
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  vi.clearAllMocks();
  seedBaseFixtures();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sendPostGameBroadcast', () => {

  // ── Auth guards ───────────────────────────────────────────────────────────

  it('(1) rejects unauthenticated callers', async () => {
    await expect(fn(makeRequest(
      { eventId: EVENT_ID, teamId: TEAM_ID },
      null
    ))).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('(2) rejects a player caller who is neither admin nor coach', async () => {
    seedDoc(`users/${PLAYER_UID}`, { role: 'player' });
    await expect(fn(makeRequest(
      { eventId: EVENT_ID, teamId: TEAM_ID },
      PLAYER_UID
    ))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  // ── Input validation ─────────────────────────────────────────────────────

  it('(3) rejects missing eventId', async () => {
    await expect(fn(makeRequest(
      { teamId: TEAM_ID },
      COACH_UID
    ))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('(4) rejects missing teamId', async () => {
    await expect(fn(makeRequest(
      { eventId: EVENT_ID },
      COACH_UID
    ))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  // ── Not-found guard ──────────────────────────────────────────────────────

  it('(5) rejects when event does not exist', async () => {
    await expect(fn(makeRequest(
      { eventId: 'no-such-event', teamId: TEAM_ID },
      COACH_UID
    ))).rejects.toMatchObject({ code: 'not-found' });
  });

  // ── Happy paths ──────────────────────────────────────────────────────────

  it('(6) creates notifications for legacy scalar users (teamId field match)', async () => {
    // Legacy user: teamId scalar on user doc
    seedDoc(`users/${LEGACY_USER_UID}`, { role: 'player', teamId: TEAM_ID });

    const result = await fn(makeRequest({ eventId: EVENT_ID, teamId: TEAM_ID }, COACH_UID)) as { sent: number };

    // Legacy user + coach from coachIds = 2 total
    expect(result.sent).toBeGreaterThanOrEqual(1);
    const notifKeys = keysUnder(`users/${LEGACY_USER_UID}/notifications`);
    expect(notifKeys.length).toBeGreaterThanOrEqual(1);
  });

  it('(7) creates a notification for each coach listed in team coachIds', async () => {
    const result = await fn(makeRequest({ eventId: EVENT_ID, teamId: TEAM_ID }, COACH_UID)) as { sent: number };

    // Coach is in coachIds
    expect(result.sent).toBeGreaterThanOrEqual(1);
    const notifKeys = keysUnder(`users/${COACH_UID}/notifications`);
    expect(notifKeys.length).toBeGreaterThanOrEqual(1);
  });

  it('(8) creates notifications for players (linkedUid) and their parents (parentUid)', async () => {
    seedDoc(`players/player-doc-1`, {
      teamId: TEAM_ID,
      linkedUid: PLAYER_UID,
      parentUid: PARENT_UID,
    });

    const result = await fn(makeRequest({ eventId: EVENT_ID, teamId: TEAM_ID }, COACH_UID)) as { sent: number };

    // coach + player + parent = 3 minimum
    expect(result.sent).toBeGreaterThanOrEqual(3);
    const playerNotifKeys = keysUnder(`users/${PLAYER_UID}/notifications`);
    const parentNotifKeys = keysUnder(`users/${PARENT_UID}/notifications`);
    expect(playerNotifKeys.length).toBeGreaterThanOrEqual(1);
    expect(parentNotifKeys.length).toBeGreaterThanOrEqual(1);
  });

  it('(9) returns { sent: N } where N equals number of unique notified users', async () => {
    const result = await fn(makeRequest({ eventId: EVENT_ID, teamId: TEAM_ID }, COACH_UID)) as { sent: number };
    // Just coach in coachIds
    expect(result.sent).toBe(1);
  });

  it('(10) returns { sent: 0 } when no users are found for the team', async () => {
    // Reset team: no coachIds, no legacy users, no players
    seedDoc(`teams/${TEAM_ID}`, { id: TEAM_ID, coachIds: [] });

    const result = await fn(makeRequest({ eventId: EVENT_ID, teamId: TEAM_ID }, COACH_UID)) as { sent: number };
    expect(result.sent).toBe(0);
  });

  it('(11) notification title includes score as "homeScore – awayScore"', async () => {
    await fn(makeRequest({ eventId: EVENT_ID, teamId: TEAM_ID }, COACH_UID));

    const notifKeys = keysUnder(`users/${COACH_UID}/notifications`);
    expect(notifKeys.length).toBeGreaterThan(0);
    const notifData = _store.get(notifKeys[0]) as DocData;
    expect(notifData.title).toBe('Championship Game: 3 \u2013 1');
  });

  it('(12) notification title uses placement format when result has placement field', async () => {
    seedDoc(`events/${EVENT_ID}`, {
      id: EVENT_ID,
      title: 'Tournament',
      result: { placement: '1st Place' },
    });

    await fn(makeRequest({ eventId: EVENT_ID, teamId: TEAM_ID }, COACH_UID));

    const notifKeys = keysUnder(`users/${COACH_UID}/notifications`);
    const notifData = _store.get(notifKeys[0]) as DocData;
    expect(notifData.title).toBe('Tournament: 1st Place');
  });

  it('(13) notification title is generic when event has no result', async () => {
    seedDoc(`events/${EVENT_ID}`, { id: EVENT_ID, title: 'Practice', result: undefined });

    await fn(makeRequest({ eventId: EVENT_ID, teamId: TEAM_ID }, COACH_UID));

    const notifKeys = keysUnder(`users/${COACH_UID}/notifications`);
    const notifData = _store.get(notifKeys[0]) as DocData;
    expect(notifData.title).toBe('Result: Practice');
  });

  it('(14) resolves manOfTheMatchPlayerId to player name in notification message', async () => {
    const PLAYER_DOC_ID = 'player-doc-mvp';
    seedDoc(`players/${PLAYER_DOC_ID}`, { firstName: 'Emma', lastName: 'Johnson', teamId: TEAM_ID });

    await fn(makeRequest(
      { eventId: EVENT_ID, teamId: TEAM_ID, manOfTheMatchPlayerId: PLAYER_DOC_ID },
      COACH_UID
    ));

    const notifKeys = keysUnder(`users/${COACH_UID}/notifications`);
    const notifData = _store.get(notifKeys[0]) as DocData;
    expect(notifData.message).toContain('Emma Johnson');
  });

  it('(15) deduplicates UIDs that appear in multiple data sources', async () => {
    // Coach appears in coachIds AND in legacy users (teamId scalar)
    seedDoc(`users/${COACH_UID}`, { role: 'coach', teamId: TEAM_ID });

    const result = await fn(makeRequest({ eventId: EVENT_ID, teamId: TEAM_ID }, COACH_UID)) as { sent: number };

    // Should be 1, not 2 — dedup by Set
    expect(result.sent).toBe(1);
    const notifKeys = keysUnder(`users/${COACH_UID}/notifications`);
    expect(notifKeys).toHaveLength(1);
  });
});
