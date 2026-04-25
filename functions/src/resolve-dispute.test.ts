/**
 * Tests for the resolveDispute callable Cloud Function.
 *
 * Covers:
 *   1.  Unauthenticated caller → 'unauthenticated'
 *   2.  Coach caller (not admin/LM) → 'permission-denied'
 *   3.  Missing eventId → 'invalid-argument'
 *   4.  Missing leagueId → 'invalid-argument'
 *   5.  Invalid chosenSubmission → 'invalid-argument'
 *   6.  League not found → 'not-found'
 *   7.  Caller is LM but not of this league → 'permission-denied'
 *   8.  Dispute not found → 'not-found'
 *   9.  Dispute already closed (not 'open') → 'failed-precondition'
 *  10.  Happy path: event is updated with chosen result
 *  11.  Happy path: dispute document is deleted after resolution
 *  12.  Happy path: returns { status: 'resolved' }
 *  13.  Admin can resolve any league's dispute (not just their own)
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

  class MockDocRef {
    constructor(public path: string) {}
    async get() {
      const data = _store.get(this.path);
      return { exists: data !== undefined, data: () => data };
    }
    async set(data: DocData) { _store.set(this.path, data); }
    async update(patch: DocData) {
      const current = (_store.get(this.path) ?? {}) as Record<string, unknown>;
      const next: Record<string, unknown> = { ...current };
      for (const [k, v] of Object.entries(patch)) {
        const sentinel = v as Record<string, unknown>;
        if (sentinel && sentinel['__delete']) {
          delete next[k];
        } else {
          next[k] = v;
        }
      }
      _store.set(this.path, next);
    }
    async delete() { _store.delete(this.path); }
  }

  class MockQuery {
    private _filters: Array<{ field: string; op: string; value: unknown }> = [];
    constructor(private _collectionPath: string) {}
    where(field: string, op: string, value: unknown): MockQuery {
      const q = new MockQuery(this._collectionPath);
      q._filters = [...this._filters, { field, op, value }];
      return q;
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
        }
        if (matches) docs.push({ id: rest, ref: new MockDocRef(path), data: () => data });
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

  class MockTransaction {
    private _ops: Array<() => void> = [];
    async get(ref: MockDocRef) { return ref.get(); }
    set(ref: MockDocRef, data: DocData) { this._ops.push(() => _store.set(ref.path, data)); }
    update(ref: MockDocRef, patch: DocData) {
      this._ops.push(() => { _store.set(ref.path, { ...(_store.get(ref.path) ?? {}), ...patch }); });
    }
    delete(ref: MockDocRef) { this._ops.push(() => _store.delete(ref.path)); }
    async commit() { for (const op of this._ops) op(); }
  }

  const firestoreInstance = {
    doc: (path: string) => new MockDocRef(path),
    collection: (path: string) => new MockQuery(path),
    batch: () => new MockBatch(),
    runTransaction: async <T>(cb: (tx: MockTransaction) => Promise<T>): Promise<T> => {
      const tx = new MockTransaction();
      const result = await cb(tx);
      await tx.commit();
      return result;
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

import { resolveDispute } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type DocData = Record<string, unknown>;

function makeRequest(data: unknown, uid: string | null, role?: string) {
  return uid
    ? { auth: { uid, token: { role: role ?? 'league_manager' } }, data }
    : { auth: null, data };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
}

const fn = resolveDispute as unknown as (req: unknown) => Promise<unknown>;

// ─── Constants ────────────────────────────────────────────────────────────────

const LEAGUE_ID = 'league-alpha';
const SEASON_ID = 'season-1';
const EVENT_ID = 'event-1';
const MANAGER_UID = 'manager1';
const OUTSIDER_UID = 'outsider1';
const ADMIN_UID = 'admin1';
const COACH_UID = 'coach1';

function seedBaseFixtures() {
  seedDoc(`users/${ADMIN_UID}`, { role: 'admin' });
  seedDoc(`users/${MANAGER_UID}`, { role: 'league_manager', leagueId: LEAGUE_ID, subscriptionTier: 'league_manager_pro' });
  seedDoc(`users/${OUTSIDER_UID}`, { role: 'league_manager', leagueId: 'other-league', subscriptionTier: 'league_manager_pro' });
  seedDoc(`users/${COACH_UID}`, { role: 'coach' });
  seedDoc(`leagues/${LEAGUE_ID}`, {
    id: LEAGUE_ID,
    name: 'Alpha League',
    managerIds: [MANAGER_UID],
    managedBy: MANAGER_UID,
  });
  seedDoc(`events/${EVENT_ID}`, {
    id: EVENT_ID,
    leagueId: LEAGUE_ID,
    seasonId: SEASON_ID,
    status: 'completed',
  });
  seedDoc(`leagues/${LEAGUE_ID}/resultDisputes/${EVENT_ID}`, {
    status: 'open',
    firstSubmission: { homeScore: 3, awayScore: 1 },
    secondSubmission: { homeScore: 2, awayScore: 2 },
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  vi.clearAllMocks();
  seedBaseFixtures();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('resolveDispute', () => {

  // ── Auth guards ───────────────────────────────────────────────────────────

  it('(1) rejects unauthenticated callers', async () => {
    await expect(fn(makeRequest(
      { eventId: EVENT_ID, leagueId: LEAGUE_ID, chosenSubmission: 'first' },
      null
    ))).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('(2) rejects a coach caller (not admin or league_manager)', async () => {
    await expect(fn(makeRequest(
      { eventId: EVENT_ID, leagueId: LEAGUE_ID, chosenSubmission: 'first' },
      COACH_UID
    ))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  // ── Input validation ─────────────────────────────────────────────────────

  it('(3) rejects missing eventId', async () => {
    await expect(fn(makeRequest(
      { leagueId: LEAGUE_ID, chosenSubmission: 'first' },
      MANAGER_UID
    ))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('(4) rejects missing leagueId', async () => {
    await expect(fn(makeRequest(
      { eventId: EVENT_ID, chosenSubmission: 'first' },
      MANAGER_UID
    ))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('(5) rejects invalid chosenSubmission value', async () => {
    await expect(fn(makeRequest(
      { eventId: EVENT_ID, leagueId: LEAGUE_ID, chosenSubmission: 'neither' },
      MANAGER_UID
    ))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  // ── Not-found guards ─────────────────────────────────────────────────────

  it('(6) rejects when league does not exist', async () => {
    await expect(fn(makeRequest(
      { eventId: EVENT_ID, leagueId: 'no-such-league', chosenSubmission: 'first' },
      MANAGER_UID
    ))).rejects.toMatchObject({ code: 'not-found' });
  });

  it('(7) rejects league_manager who does not manage this league', async () => {
    await expect(fn(makeRequest(
      { eventId: EVENT_ID, leagueId: LEAGUE_ID, chosenSubmission: 'first' },
      OUTSIDER_UID
    ))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('(8) rejects when dispute document does not exist', async () => {
    _store.delete(`leagues/${LEAGUE_ID}/resultDisputes/${EVENT_ID}`);
    await expect(fn(makeRequest(
      { eventId: EVENT_ID, leagueId: LEAGUE_ID, chosenSubmission: 'first' },
      MANAGER_UID
    ))).rejects.toMatchObject({ code: 'not-found' });
  });

  it('(9) rejects when dispute status is not "open"', async () => {
    seedDoc(`leagues/${LEAGUE_ID}/resultDisputes/${EVENT_ID}`, {
      status: 'resolved',
      firstSubmission: { homeScore: 3, awayScore: 1 },
      secondSubmission: { homeScore: 2, awayScore: 2 },
    });
    await expect(fn(makeRequest(
      { eventId: EVENT_ID, leagueId: LEAGUE_ID, chosenSubmission: 'first' },
      MANAGER_UID
    ))).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  // ── Happy paths ──────────────────────────────────────────────────────────

  it('(10) updates the event with the first submission scores when chosenSubmission is "first"', async () => {
    await fn(makeRequest(
      { eventId: EVENT_ID, leagueId: LEAGUE_ID, chosenSubmission: 'first' },
      MANAGER_UID
    ));

    const eventData = _store.get(`events/${EVENT_ID}`) as DocData;
    expect(eventData.result).toMatchObject({ homeScore: 3, awayScore: 1 });
    expect(eventData.status).toBe('completed');
  });

  it('(10b) updates the event with the second submission scores when chosenSubmission is "second"', async () => {
    await fn(makeRequest(
      { eventId: EVENT_ID, leagueId: LEAGUE_ID, chosenSubmission: 'second' },
      MANAGER_UID
    ));

    const eventData = _store.get(`events/${EVENT_ID}`) as DocData;
    expect(eventData.result).toMatchObject({ homeScore: 2, awayScore: 2 });
  });

  it('(11) deletes the dispute document after resolution', async () => {
    await fn(makeRequest(
      { eventId: EVENT_ID, leagueId: LEAGUE_ID, chosenSubmission: 'first' },
      MANAGER_UID
    ));

    expect(_store.has(`leagues/${LEAGUE_ID}/resultDisputes/${EVENT_ID}`)).toBe(false);
  });

  it('(12) returns { status: "resolved" }', async () => {
    const result = await fn(makeRequest(
      { eventId: EVENT_ID, leagueId: LEAGUE_ID, chosenSubmission: 'first' },
      MANAGER_UID
    ));
    expect(result).toMatchObject({ status: 'resolved' });
  });

  it('(13) allows admin to resolve a dispute for any league', async () => {
    const result = await fn(makeRequest(
      { eventId: EVENT_ID, leagueId: LEAGUE_ID, chosenSubmission: 'second' },
      ADMIN_UID
    ));
    expect(result).toMatchObject({ status: 'resolved' });
  });
});
