/**
 * Tests for the hardDeleteTeam callable Cloud Function.
 *
 * Covers:
 *   1.  Unauthenticated caller → 'unauthenticated'
 *   2.  Missing teamId in request data → 'invalid-argument'
 *   3.  Whitespace-only teamId → 'invalid-argument'
 *   4.  Team doc does not exist → 'not-found'
 *   5.  Caller is neither admin nor coach of the team → 'permission-denied'
 *   6.  Admin (legacy role field) is permitted regardless of coachIds membership
 *   7.  Admin via memberships array is permitted
 *   8.  Coach listed in coachIds is permitted
 *   9.  Coach via legacy coachId scalar is permitted (backfill compat)
 *   10. Coach via createdBy scalar is permitted (backfill compat)
 *   11. Happy path: recursiveDelete is called on the correct team ref
 *   12. Happy path: returns { success: true }
 *   13. Internal error from recursiveDelete is rethrown as HttpsError 'internal'
 *
 * Mocking strategy: follows the pattern established in delete-league.test.ts.
 * Firebase Functions and firebase-admin are mocked at the module boundary.
 * vi.hoisted() is used for spy references needed inside vi.mock() factories.
 * No live emulator required for these unit-level tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted store shared across mocks ───────────────────────────────────────

const { _store, _recursiveDeleteSpy } = vi.hoisted(() => {
  type DocData = Record<string, unknown>;
  const store: Map<string, DocData> = new Map();
  const recursiveDeleteSpy = vi.fn();
  return { _store: store, _recursiveDeleteSpy: recursiveDeleteSpy };
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
      const current = (_store.get(this.path) ?? {}) as DocData;
      _store.set(this.path, { ...current, ...patch });
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
    async commit() { for (const op of this._ops) await op(); this._ops = []; }
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
    // recursiveDelete is the core operation under test — spy so tests can assert it was called.
    recursiveDelete: (...args: unknown[]) => _recursiveDeleteSpy(...args),
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

import { hardDeleteTeam } from './index';

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

const fn = hardDeleteTeam as unknown as (req: unknown) => Promise<unknown>;

// ─── Constants ────────────────────────────────────────────────────────────────

const TEAM_ID = 'team-hawks';
const COACH_UID = 'coach-1';
const ADMIN_UID = 'admin-1';
const OUTSIDER_UID = 'outsider-1';

function seedBaseFixtures() {
  seedDoc(`users/${ADMIN_UID}`, { role: 'admin' });
  seedDoc(`users/${COACH_UID}`, { role: 'coach', memberships: [] });
  seedDoc(`users/${OUTSIDER_UID}`, { role: 'parent', memberships: [] });
  seedDoc(`teams/${TEAM_ID}`, {
    id: TEAM_ID,
    name: 'Hawks',
    coachIds: [COACH_UID],
  });
  // Seed a rateLimits doc so checkRateLimit always opens a fresh window
  // (count=0 means the limit of 5 is never reached during tests).
  seedDoc(`rateLimits/${ADMIN_UID}_hardDeleteTeam`, { count: 0, windowStart: 0 });
  seedDoc(`rateLimits/${COACH_UID}_hardDeleteTeam`, { count: 0, windowStart: 0 });
  seedDoc(`rateLimits/${OUTSIDER_UID}_hardDeleteTeam`, { count: 0, windowStart: 0 });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  vi.clearAllMocks();
  // Default: recursiveDelete resolves successfully.
  _recursiveDeleteSpy.mockResolvedValue(undefined);
  seedBaseFixtures();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('hardDeleteTeam', () => {

  // ── Auth guards ───────────────────────────────────────────────────────────

  it('(1) rejects unauthenticated callers', async () => {
    await expect(fn(makeRequest({ teamId: TEAM_ID }, null))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  // ── Input validation ─────────────────────────────────────────────────────

  it('(2) rejects when teamId is missing from request data', async () => {
    await expect(fn(makeRequest({}, ADMIN_UID))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('(3) rejects when teamId is whitespace only', async () => {
    await expect(fn(makeRequest({ teamId: '   ' }, ADMIN_UID))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  // ── Not-found guard ──────────────────────────────────────────────────────

  it('(4) throws not-found when the team doc does not exist', async () => {
    await expect(
      fn(makeRequest({ teamId: 'nonexistent-team' }, ADMIN_UID)),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  // ── Permission guard ─────────────────────────────────────────────────────

  it('(5) rejects a caller who is neither admin nor coach of the team', async () => {
    await expect(fn(makeRequest({ teamId: TEAM_ID }, OUTSIDER_UID))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  // ── Permission: admin paths ──────────────────────────────────────────────

  it('(6) permits a caller whose legacy role field is "admin"', async () => {
    // ADMIN_UID has role: 'admin' seeded in beforeEach — they are not in coachIds.
    const result = await fn(makeRequest({ teamId: TEAM_ID }, ADMIN_UID));
    expect(result).toEqual({ success: true });
  });

  it('(7) permits a caller whose memberships array contains an admin role', async () => {
    const membershipAdminUid = 'membership-admin-uid';
    seedDoc(`users/${membershipAdminUid}`, {
      role: 'coach', // legacy role is NOT admin
      memberships: [{ role: 'admin', leagueId: 'league-x' }],
    });
    seedDoc(`rateLimits/${membershipAdminUid}_hardDeleteTeam`, { count: 0, windowStart: 0 });

    const result = await fn(makeRequest({ teamId: TEAM_ID }, membershipAdminUid));
    expect(result).toEqual({ success: true });
  });

  // ── Permission: coach paths ──────────────────────────────────────────────

  it('(8) permits a coach listed in the team coachIds array', async () => {
    const result = await fn(makeRequest({ teamId: TEAM_ID }, COACH_UID));
    expect(result).toEqual({ success: true });
  });

  it('(9) permits a coach via legacy coachId scalar (backfill compatibility)', async () => {
    const legacyCoachUid = 'legacy-coach-uid';
    seedDoc(`users/${legacyCoachUid}`, { role: 'coach', memberships: [] });
    seedDoc(`rateLimits/${legacyCoachUid}_hardDeleteTeam`, { count: 0, windowStart: 0 });
    // Team uses legacy scalar, no coachIds array
    seedDoc(`teams/${TEAM_ID}`, { id: TEAM_ID, name: 'Hawks', coachId: legacyCoachUid });

    const result = await fn(makeRequest({ teamId: TEAM_ID }, legacyCoachUid));
    expect(result).toEqual({ success: true });
  });

  it('(10) permits a coach via createdBy scalar (backfill compatibility)', async () => {
    const createdByCoachUid = 'createdby-coach-uid';
    seedDoc(`users/${createdByCoachUid}`, { role: 'coach', memberships: [] });
    seedDoc(`rateLimits/${createdByCoachUid}_hardDeleteTeam`, { count: 0, windowStart: 0 });
    // Team uses createdBy but no coachIds array and no coachId scalar
    seedDoc(`teams/${TEAM_ID}`, { id: TEAM_ID, name: 'Hawks', createdBy: createdByCoachUid });

    const result = await fn(makeRequest({ teamId: TEAM_ID }, createdByCoachUid));
    expect(result).toEqual({ success: true });
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  it('(11) calls recursiveDelete on the correct team document ref', async () => {
    await fn(makeRequest({ teamId: TEAM_ID }, COACH_UID));

    expect(_recursiveDeleteSpy).toHaveBeenCalledOnce();
    // The first argument to recursiveDelete must be a ref whose path is teams/TEAM_ID
    const refArg = _recursiveDeleteSpy.mock.calls[0][0] as { path: string };
    expect(refArg.path).toBe(`teams/${TEAM_ID}`);
  });

  it('(12) returns { success: true } on the happy path', async () => {
    const result = await fn(makeRequest({ teamId: TEAM_ID }, COACH_UID));
    expect(result).toEqual({ success: true });
  });

  // ── Error handling ───────────────────────────────────────────────────────

  it('(13) rethrows recursiveDelete errors as HttpsError with code "internal"', async () => {
    _recursiveDeleteSpy.mockRejectedValue(new Error('Firestore quota exceeded'));

    await expect(fn(makeRequest({ teamId: TEAM_ID }, COACH_UID))).rejects.toMatchObject({
      code: 'internal',
      message: 'Firestore quota exceeded',
    });
  });
});
