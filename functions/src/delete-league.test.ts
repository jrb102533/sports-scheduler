/**
 * Tests for the deleteLeague callable Cloud Function (TD #517).
 *
 * Covers:
 *   1.  Unauthenticated caller → 'unauthenticated'
 *   2.  Non-manager, non-admin caller → 'permission-denied'
 *   3.  Missing league → 'not-found'
 *   4.  Already-deleted league → 'not-found'
 *   5.  Missing leagueId input → 'invalid-argument'
 *   6.  Admin caller is permitted regardless of managerIds membership
 *   7.  Happy path: leagueId removed from all member teams' leagueIds arrays
 *   8.  Happy path: all league-scoped events are deleted
 *   9.  Happy path: league doc is soft-deleted (isDeleted=true, deletedAt set)
 *  10.  Happy path: returns { success: true }
 *  11.  League manager (via managerIds) is permitted to delete their own league
 *  12.  Teams with leagueIds not containing this league are untouched
 *
 * Mocking strategy: follows the pattern established in delete-user-by-admin.test.ts.
 * Firebase Functions and firebase-admin are mocked at the module boundary.
 * vi.hoisted() is used for spy references needed inside vi.mock() factories.
 * No live emulator required for these unit-level tests.
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
      // Materialise FieldValue sentinels so tests can inspect the stored arrays.
      const current = (_store.get(this.path) ?? {}) as Record<string, unknown>;
      const next: Record<string, unknown> = { ...current };
      for (const [k, v] of Object.entries(patch)) {
        const sentinel = v as Record<string, unknown>;
        if (sentinel && Array.isArray(sentinel['__arrayRemove'])) {
          const toRemove = new Set(sentinel['__arrayRemove'] as unknown[]);
          next[k] = Array.isArray(current[k])
            ? (current[k] as unknown[]).filter((x) => !toRemove.has(x))
            : current[k];
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
          if (f.op === 'array-contains') {
            const arr = data[f.field];
            if (!Array.isArray(arr) || !arr.includes(f.value)) { matches = false; break; }
          }
        }
        if (matches) docs.push({ id: rest, ref: new MockDocRef(path), data: () => data });
      }
      return { empty: docs.length === 0, size: docs.length, docs };
    }
  }

  class MockBatch {
    private _ops: Array<() => Promise<void>> = [];
    update(ref: MockDocRef, patch: DocData) {
      this._ops.push(() => ref.update(patch));
    }
    delete(ref: MockDocRef) {
      this._ops.push(() => ref.delete());
    }
    async commit() {
      for (const op of this._ops) await op();
      this._ops = [];
    }
  }

  class MockTransaction {
    private _ops: Array<() => void> = [];
    async get(ref: MockDocRef) { return ref.get(); }
    set(ref: MockDocRef, data: DocData) { this._ops.push(() => _store.set(ref.path, data)); }
    update(ref: MockDocRef, patch: DocData) {
      this._ops.push(() => { _store.set(ref.path, { ...(_store.get(ref.path) ?? {}), ...patch }); });
    }
    delete(ref: MockDocRef) { this._ops.push(() => _store.delete(ref.path)); }
    async commit() { for (const op of this._ops) op(); this._ops = []; }
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
    recursiveDelete: async (ref: MockDocRef) => { _store.delete(ref.path); },
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
      })),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => ({
      createUser: vi.fn(),
      deleteUser: vi.fn(),
    })),
  };
});

// ─── Import under test ────────────────────────────────────────────────────────

import { deleteLeague } from './index';

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

const fn = deleteLeague as unknown as (req: unknown) => Promise<unknown>;

// ─── Seed helpers ─────────────────────────────────────────────────────────────

const LEAGUE_ID = 'league-alpha';
const MANAGER_UID = 'manager1';
const OUTSIDER_UID = 'outsider1';
const ADMIN_UID = 'admin1';

function seedBaseFixtures() {
  seedDoc(`users/${ADMIN_UID}`, { role: 'admin' });
  seedDoc(`users/${MANAGER_UID}`, { role: 'league_manager', subscriptionTier: 'league_manager_pro' });
  seedDoc(`users/${OUTSIDER_UID}`, { role: 'coach' });
  seedDoc(`leagues/${LEAGUE_ID}`, {
    id: LEAGUE_ID,
    name: 'Alpha League',
    managerIds: [MANAGER_UID],
    managedBy: MANAGER_UID,
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  vi.clearAllMocks();
  seedBaseFixtures();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('deleteLeague', () => {

  // ── Auth guards ───────────────────────────────────────────────────────────

  it('(1) rejects unauthenticated callers', async () => {
    await expect(fn(makeRequest({ leagueId: LEAGUE_ID }, null))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('(2) rejects callers who are neither admin nor a manager of this league', async () => {
    await expect(fn(makeRequest({ leagueId: LEAGUE_ID }, OUTSIDER_UID))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  // ── Not-found guards ─────────────────────────────────────────────────────

  it('(3) throws not-found for a missing league doc', async () => {
    await expect(
      fn(makeRequest({ leagueId: 'nonexistent-league' }, ADMIN_UID)),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('(4) throws not-found for a league that is already soft-deleted', async () => {
    seedDoc(`leagues/${LEAGUE_ID}`, {
      id: LEAGUE_ID,
      name: 'Alpha League',
      managerIds: [MANAGER_UID],
      isDeleted: true,
    });
    await expect(fn(makeRequest({ leagueId: LEAGUE_ID }, ADMIN_UID))).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  // ── Input validation ─────────────────────────────────────────────────────

  it('(5) rejects when leagueId is missing from request data', async () => {
    await expect(fn(makeRequest({}, ADMIN_UID))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  // ── Permission: admin bypass ─────────────────────────────────────────────

  it('(6) allows an admin who is not in managerIds to delete the league', async () => {
    // admin1 is NOT in managerIds — but is a global admin.
    const result = await fn(makeRequest({ leagueId: LEAGUE_ID }, ADMIN_UID));
    expect(result).toEqual({ success: true });
  });

  // ── Happy path: team cleanup ──────────────────────────────────────────────

  it('(7) removes leagueId from leagueIds on all member teams', async () => {
    seedDoc('teams/team-a', { name: 'Team A', leagueIds: [LEAGUE_ID, 'other-league'] });
    seedDoc('teams/team-b', { name: 'Team B', leagueIds: [LEAGUE_ID] });

    await fn(makeRequest({ leagueId: LEAGUE_ID }, MANAGER_UID));

    const teamA = _store.get('teams/team-a') as DocData;
    const teamB = _store.get('teams/team-b') as DocData;

    expect(teamA.leagueIds).not.toContain(LEAGUE_ID);
    expect(teamA.leagueIds).toContain('other-league');
    expect(teamB.leagueIds).not.toContain(LEAGUE_ID);
  });

  it('(12) does not touch teams whose leagueIds do not contain this league', async () => {
    seedDoc('teams/team-unrelated', { name: 'Unrelated Team', leagueIds: ['some-other-league'] });

    await fn(makeRequest({ leagueId: LEAGUE_ID }, MANAGER_UID));

    const unrelated = _store.get('teams/team-unrelated') as DocData;
    expect(unrelated.leagueIds).toEqual(['some-other-league']);
  });

  // ── Happy path: event cleanup ─────────────────────────────────────────────

  it('(8) deletes all events scoped to this league', async () => {
    seedDoc('events/event-1', { leagueId: LEAGUE_ID, title: 'Game 1' });
    seedDoc('events/event-2', { leagueId: LEAGUE_ID, title: 'Game 2' });
    seedDoc('events/event-other', { leagueId: 'other-league', title: 'Other Game' });

    await fn(makeRequest({ leagueId: LEAGUE_ID }, MANAGER_UID));

    expect(_store.has('events/event-1')).toBe(false);
    expect(_store.has('events/event-2')).toBe(false);
    // Events for other leagues must survive.
    expect(_store.has('events/event-other')).toBe(true);
  });

  // ── Happy path: league soft-delete ───────────────────────────────────────

  it('(9) soft-deletes the league doc with isDeleted=true and a deletedAt timestamp', async () => {
    await fn(makeRequest({ leagueId: LEAGUE_ID }, MANAGER_UID));

    const leagueDoc = _store.get(`leagues/${LEAGUE_ID}`) as DocData;
    expect(leagueDoc.isDeleted).toBe(true);
    expect(typeof leagueDoc.deletedAt).toBe('string');
    // Sanity check: the doc itself still exists (soft-delete, not hard-delete).
    expect(_store.has(`leagues/${LEAGUE_ID}`)).toBe(true);
  });

  it('(10) returns { success: true } on the happy path', async () => {
    const result = await fn(makeRequest({ leagueId: LEAGUE_ID }, MANAGER_UID));
    expect(result).toEqual({ success: true });
  });

  // ── Permission: league manager via managerIds ─────────────────────────────

  it('(11) allows a league manager listed in managerIds to delete their league', async () => {
    const result = await fn(makeRequest({ leagueId: LEAGUE_ID }, MANAGER_UID));
    expect(result).toEqual({ success: true });
    const leagueDoc = _store.get(`leagues/${LEAGUE_ID}`) as DocData;
    expect(leagueDoc.isDeleted).toBe(true);
  });
});
