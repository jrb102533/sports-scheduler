/**
 * Tests for the deleteUserByAdmin callable Cloud Function.
 *
 * Covers:
 *   1.  Unauthenticated caller → 'unauthenticated'
 *   2.  Non-admin caller (coach) → 'permission-denied'
 *   3.  Non-admin caller (player) → 'permission-denied'
 *   4.  Missing uid → 'invalid-argument'
 *   5.  Whitespace-only uid → 'invalid-argument'
 *   6.  Self-deletion → 'failed-precondition'
 *   7.  Target is an admin → 'failed-precondition' (SEC-20: admins cannot delete other admins)
 *   8.  Target is an admin via memberships array → 'failed-precondition' (SEC-20)
 *   9.  Happy path: Auth account deleted
 *  10.  Happy path: Firestore user doc deleted via recursiveDelete (SEC-21)
 *  11.  Happy path: returns { success: true }
 *  12.  auth/user-not-found is tolerated — Firestore doc still deleted
 *  13.  Non-auth/user-not-found Auth error is re-thrown as 'internal'
 *
 * Mocking strategy: follows the established pattern in reset-user-password.test.ts.
 * Firebase Functions and firebase-admin are mocked at the module boundary.
 * vi.hoisted() is used for spy references needed inside vi.mock() factories,
 * following the pattern documented in pattern_vi_hoisted_mock_factory.md.
 * No live emulator is required for these unit-level tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted spy references ───────────────────────────────────────────────────
// Must be declared with vi.hoisted() so they are available inside vi.mock()
// factory functions, which are hoisted before all other module-scope statements.

const { mockDeleteUser, mockRecursiveDelete, _store } = vi.hoisted(() => {
  type DocData = Record<string, unknown>;
  const store: Map<string, DocData> = new Map();

  return {
    mockDeleteUser: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    mockRecursiveDelete: vi.fn<[{ path: string }], Promise<void>>(async (ref) => {
      store.delete(ref.path);
    }),
    _store: store,
  };
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
// mockDeleteUser and mockRecursiveDelete are safe to reference here because
// they were declared via vi.hoisted() above.

vi.mock('firebase-admin', () => {
  type DocData = Record<string, unknown>;

  class MockDocRef {
    constructor(public path: string) {}
    async get() {
      const data = _store.get(this.path);
      return { exists: data !== undefined, data: () => data };
    }
    async set(data: DocData) { _store.set(this.path, data); }
    async update(data: DocData) { _store.set(this.path, { ...(_store.get(this.path) ?? {}), ...data }); }
    async delete() { _store.delete(this.path); }
  }

  class MockQuery {
    private _filters: Array<{ field: string; op: string; value: unknown }> = [];
    constructor(private _collectionPath: string) {}
    where(field: string, op: string, value: unknown) {
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
          if (f.op === '==' && (data as Record<string, unknown>)[f.field] !== f.value) {
            matches = false; break;
          }
        }
        if (matches) docs.push({ id: rest, ref: new MockDocRef(path), data: () => data });
      }
      return { empty: docs.length === 0, docs };
    }
  }

  class MockBatch {
    private _ops: Array<() => void> = [];
    set(ref: MockDocRef, data: DocData) { this._ops.push(() => _store.set(ref.path, data)); }
    update(ref: MockDocRef, data: DocData) { this._ops.push(() => _store.set(ref.path, { ...(_store.get(ref.path) ?? {}), ...data })); }
    delete(ref: MockDocRef) { this._ops.push(() => _store.delete(ref.path)); }
    async commit() { for (const op of this._ops) op(); this._ops = []; }
  }

  class MockTransaction {
    private _ops: Array<() => void> = [];
    async get(ref: MockDocRef) { return ref.get(); }
    set(ref: MockDocRef, data: DocData) { this._ops.push(() => _store.set(ref.path, data)); }
    update(ref: MockDocRef, data: DocData) { this._ops.push(() => _store.set(ref.path, { ...(_store.get(ref.path) ?? {}), ...data })); }
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
    recursiveDelete: (ref: MockDocRef) => mockRecursiveDelete(ref),
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
        deleteUser: mockDeleteUser,
      })),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => ({
      createUser: vi.fn(),
      deleteUser: mockDeleteUser,
    })),
  };
});

// ─── Import under test ────────────────────────────────────────────────────────

import { deleteUserByAdmin } from './index';

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

const fn = deleteUserByAdmin as unknown as (req: unknown) => Promise<unknown>;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  vi.clearAllMocks();

  // Seed callers
  seedDoc('users/admin1', { role: 'admin' });
  seedDoc('users/admin2', { role: 'admin' });
  seedDoc('users/coach1', { role: 'coach' });
  seedDoc('users/player1', { role: 'player' });

  // Seed target user (non-admin — eligible for deletion)
  seedDoc('users/target1', { role: 'player', displayName: 'Target User' });

  mockDeleteUser.mockResolvedValue(undefined);
  mockRecursiveDelete.mockImplementation(async (ref: { path: string }) => {
    _store.delete(ref.path);
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('deleteUserByAdmin', () => {

  // ── Auth guards ───────────────────────────────────────────────────────────

  it('(1) rejects unauthenticated callers', async () => {
    await expect(fn(makeRequest({ uid: 'target1' }, null))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('(2) rejects coach callers — only admins may delete users', async () => {
    await expect(fn(makeRequest({ uid: 'target1' }, 'coach1'))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('(3) rejects player callers', async () => {
    await expect(fn(makeRequest({ uid: 'target1' }, 'player1'))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  // ── Input validation ─────────────────────────────────────────────────────

  it('(4) rejects when uid is missing from the request data', async () => {
    await expect(fn(makeRequest({}, 'admin1'))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('(5) rejects when uid is only whitespace', async () => {
    await expect(fn(makeRequest({ uid: '   ' }, 'admin1'))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  // ── Self-deletion guard ───────────────────────────────────────────────────

  it('(6) rejects when the caller tries to delete their own account', async () => {
    await expect(fn(makeRequest({ uid: 'admin1' }, 'admin1'))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  // ── SEC-20: admin-deletion guard ─────────────────────────────────────────

  it('(7) rejects deletion of another admin account via top-level role (SEC-20)', async () => {
    await expect(fn(makeRequest({ uid: 'admin2' }, 'admin1'))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('(8) rejects deletion of an account with admin role in memberships array (SEC-20)', async () => {
    seedDoc('users/memberAdmin', {
      role: 'player',
      memberships: [{ role: 'admin', teamId: 'team1' }],
    });

    await expect(fn(makeRequest({ uid: 'memberAdmin' }, 'admin1'))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('(9) deletes the Firebase Auth account for the target user', async () => {
    await fn(makeRequest({ uid: 'target1' }, 'admin1'));
    expect(mockDeleteUser).toHaveBeenCalledWith('target1');
  });

  it('(10) deletes the Firestore user document (and subcollections) via recursiveDelete', async () => {
    await fn(makeRequest({ uid: 'target1' }, 'admin1'));
    expect(_store.has('users/target1')).toBe(false);
  });

  it('(11) returns { success: true } on the happy path', async () => {
    const result = await fn(makeRequest({ uid: 'target1' }, 'admin1'));
    expect(result).toEqual({ success: true });
  });

  // ── auth/user-not-found tolerance ─────────────────────────────────────────

  it('(12) tolerates auth/user-not-found and still deletes the Firestore doc', async () => {
    const authNotFoundError = Object.assign(new Error('auth/user-not-found'), {
      code: 'auth/user-not-found',
    });
    mockDeleteUser.mockRejectedValue(authNotFoundError);

    // Should not throw
    const result = await fn(makeRequest({ uid: 'target1' }, 'admin1'));

    // Firestore doc is still gone
    expect(_store.has('users/target1')).toBe(false);
    // Still returns success
    expect(result).toEqual({ success: true });
  });

  // ── Auth error propagation ────────────────────────────────────────────────

  it('(13) re-throws unexpected Auth errors as internal', async () => {
    const unexpectedError = Object.assign(new Error('Quota exceeded'), {
      code: 'auth/quota-exceeded',
    });
    mockDeleteUser.mockRejectedValue(unexpectedError);

    await expect(fn(makeRequest({ uid: 'target1' }, 'admin1'))).rejects.toMatchObject({
      code: 'internal',
    });
  });
});
