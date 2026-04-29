/**
 * Tests for the approveJoinRequest callable Cloud Function.
 *
 * Covers:
 *   1.  Unauthenticated caller → 'unauthenticated'
 *   2.  Missing teamId → 'invalid-argument'
 *   3.  Missing requestUid → 'invalid-argument'
 *   4.  Invalid role value (not 'player' or 'parent') → 'invalid-argument'
 *        (SEC-30: role allowlist is a security boundary)
 *   5.  Caller is neither admin nor coach of the team → 'permission-denied'
 *   6.  Team not found → 'not-found'
 *   7.  Target user not found → 'not-found'
 *   8.  Happy path: user gains a membership entry for the team
 *   9.  Happy path: join request status is set to 'approved'
 *  10.  Happy path: returns { success: true }
 *  11.  Does not add a duplicate membership when user is already a member with that role
 *  12.  Admin can approve a join request without being listed as coach
 *  13.  Default role is 'player' when role is omitted
 *  14.  Role 'parent' is accepted (not rejected by allowlist)
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
        if (sentinel && Array.isArray(sentinel['__arrayUnion'])) {
          const toAdd = sentinel['__arrayUnion'] as unknown[];
          next[k] = Array.isArray(current[k])
            ? [...(current[k] as unknown[]), ...toAdd]
            : toAdd;
        } else if (sentinel && Array.isArray(sentinel['__arrayRemove'])) {
          const toRemove = new Set(sentinel['__arrayRemove'] as unknown[]);
          next[k] = Array.isArray(current[k])
            ? (current[k] as unknown[]).filter((x) => !toRemove.has(x))
            : current[k];
        } else if (sentinel && sentinel['__delete']) {
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
    update(ref: MockDocRef, patch: DocData) { this._ops.push(() => ref.update(patch)); }
    delete(ref: MockDocRef) { this._ops.push(() => ref.delete()); }
    async commit() { for (const op of this._ops) await op(); }
  }

  class MockTransaction {
    private _ops: Array<() => void> = [];
    async get(ref: MockDocRef) { return ref.get(); }
    set(ref: MockDocRef, data: DocData) { this._ops.push(() => _store.set(ref.path, data)); }
    update(ref: MockDocRef, patch: DocData) {
      // Apply FieldValue sentinels at commit time
      this._ops.push(() => {
        const current = (_store.get(ref.path) ?? {}) as Record<string, unknown>;
        const next: Record<string, unknown> = { ...current };
        for (const [k, v] of Object.entries(patch)) {
          const sentinel = v as Record<string, unknown>;
          if (sentinel && Array.isArray(sentinel['__arrayUnion'])) {
            const toAdd = sentinel['__arrayUnion'] as unknown[];
            next[k] = Array.isArray(current[k])
              ? [...(current[k] as unknown[]), ...toAdd]
              : toAdd;
          } else if (sentinel && sentinel['__delete']) {
            delete next[k];
          } else {
            next[k] = v;
          }
        }
        _store.set(ref.path, next);
      });
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

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (n: number) => ({ __increment: n }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
    delete: () => ({ __delete: true }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
  },
  FieldPath: {
    documentId: () => '__name__',
  },
}));

// ─── Import under test ────────────────────────────────────────────────────────

import { approveJoinRequest } from './index';

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

const fn = approveJoinRequest as unknown as (req: unknown) => Promise<unknown>;

// ─── Constants ────────────────────────────────────────────────────────────────

const TEAM_ID = 'team-alpha';
const COACH_UID = 'coach1';
const ADMIN_UID = 'admin1';
const OUTSIDER_UID = 'outsider1';
const REQUEST_UID = 'player1';

function seedBaseFixtures() {
  seedDoc(`users/${ADMIN_UID}`, { role: 'admin' });
  seedDoc(`users/${COACH_UID}`, { role: 'coach' });
  seedDoc(`users/${OUTSIDER_UID}`, { role: 'player' });
  seedDoc(`users/${REQUEST_UID}`, { role: 'player', memberships: [] });
  seedDoc(`teams/${TEAM_ID}`, {
    id: TEAM_ID,
    name: 'Alpha Team',
    coachIds: [COACH_UID],
    coachId: COACH_UID,
  });
  seedDoc(`teams/${TEAM_ID}/joinRequests/${REQUEST_UID}`, {
    uid: REQUEST_UID,
    status: 'pending',
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  vi.clearAllMocks();
  seedBaseFixtures();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('approveJoinRequest', () => {

  // ── Auth guards ───────────────────────────────────────────────────────────

  it('(1) rejects unauthenticated callers', async () => {
    await expect(fn(makeRequest(
      { teamId: TEAM_ID, requestUid: REQUEST_UID },
      null
    ))).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  // ── Input validation ─────────────────────────────────────────────────────

  it('(2) rejects missing teamId', async () => {
    await expect(fn(makeRequest(
      { requestUid: REQUEST_UID },
      COACH_UID
    ))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('(3) rejects missing requestUid', async () => {
    await expect(fn(makeRequest(
      { teamId: TEAM_ID },
      COACH_UID
    ))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('(4) rejects an invalid role value — "coach" is not in the allowlist', async () => {
    // SEC-30: role escalation via crafted role field must be blocked
    await expect(fn(makeRequest(
      { teamId: TEAM_ID, requestUid: REQUEST_UID, role: 'coach' },
      COACH_UID
    ))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('(4b) rejects "admin" role via role field — privilege escalation attempt', async () => {
    await expect(fn(makeRequest(
      { teamId: TEAM_ID, requestUid: REQUEST_UID, role: 'admin' },
      COACH_UID
    ))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  // ── Permission guards ────────────────────────────────────────────────────

  it('(5) rejects a player caller who is not coach of the team', async () => {
    await expect(fn(makeRequest(
      { teamId: TEAM_ID, requestUid: REQUEST_UID },
      OUTSIDER_UID
    ))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('(6) rejects when team doc does not exist (coach-path)', async () => {
    _store.delete(`teams/${TEAM_ID}`);
    // Coach is no longer an admin so it goes through the team-existence check
    await expect(fn(makeRequest(
      { teamId: TEAM_ID, requestUid: REQUEST_UID },
      COACH_UID
    ))).rejects.toMatchObject({ code: 'not-found' });
  });

  // ── User-not-found guard ─────────────────────────────────────────────────

  it('(7) rejects when the requested user does not exist', async () => {
    _store.delete(`users/${REQUEST_UID}`);
    await expect(fn(makeRequest(
      { teamId: TEAM_ID, requestUid: REQUEST_UID },
      COACH_UID
    ))).rejects.toMatchObject({ code: 'not-found' });
  });

  // ── Happy paths ──────────────────────────────────────────────────────────

  it('(8) adds a membership entry for the team to the user document', async () => {
    await fn(makeRequest({ teamId: TEAM_ID, requestUid: REQUEST_UID }, COACH_UID));

    const userData = _store.get(`users/${REQUEST_UID}`) as DocData;
    const memberships = userData.memberships as Array<Record<string, unknown>>;
    expect(memberships).toContainEqual(
      expect.objectContaining({ role: 'player', teamId: TEAM_ID })
    );
  });

  it('(9) sets join request status to "approved"', async () => {
    await fn(makeRequest({ teamId: TEAM_ID, requestUid: REQUEST_UID }, COACH_UID));

    const reqData = _store.get(`teams/${TEAM_ID}/joinRequests/${REQUEST_UID}`) as DocData;
    expect(reqData.status).toBe('approved');
  });

  it('(10) returns { success: true }', async () => {
    const result = await fn(makeRequest({ teamId: TEAM_ID, requestUid: REQUEST_UID }, COACH_UID));
    expect(result).toMatchObject({ success: true });
  });

  it('(11) does not add a duplicate membership when user already has that role+team', async () => {
    // Pre-seed an existing membership for this team
    seedDoc(`users/${REQUEST_UID}`, {
      role: 'player',
      memberships: [{ role: 'player', teamId: TEAM_ID, isPrimary: true }],
    });

    await fn(makeRequest({ teamId: TEAM_ID, requestUid: REQUEST_UID }, COACH_UID));

    const userData = _store.get(`users/${REQUEST_UID}`) as DocData;
    const memberships = userData.memberships as Array<Record<string, unknown>>;
    const matchingMemberships = memberships.filter(
      (m) => m.role === 'player' && m.teamId === TEAM_ID
    );
    expect(matchingMemberships).toHaveLength(1);
  });

  it('(12) admin can approve a join request without being listed as coach', async () => {
    const result = await fn(makeRequest({ teamId: TEAM_ID, requestUid: REQUEST_UID }, ADMIN_UID));
    expect(result).toMatchObject({ success: true });
  });

  it('(13) defaults role to "player" when role is omitted', async () => {
    await fn(makeRequest({ teamId: TEAM_ID, requestUid: REQUEST_UID }, COACH_UID));

    const userData = _store.get(`users/${REQUEST_UID}`) as DocData;
    const memberships = userData.memberships as Array<Record<string, unknown>>;
    expect(memberships).toContainEqual(expect.objectContaining({ role: 'player' }));
  });

  it('(14) accepts "parent" as a valid role', async () => {
    seedDoc(`users/${REQUEST_UID}`, { role: 'parent', memberships: [] });
    const result = await fn(makeRequest(
      { teamId: TEAM_ID, requestUid: REQUEST_UID, role: 'parent' },
      COACH_UID
    ));
    expect(result).toMatchObject({ success: true });

    const userData = _store.get(`users/${REQUEST_UID}`) as DocData;
    const memberships = userData.memberships as Array<Record<string, unknown>>;
    expect(memberships).toContainEqual(expect.objectContaining({ role: 'parent' }));
  });
});
