/**
 * Tests for the resetUserPassword callable Cloud Function.
 *
 * Covers:
 *   1.  Unauthenticated caller → 'unauthenticated'
 *   2.  Non-admin authenticated caller (coach) → 'permission-denied'
 *   3.  Non-admin authenticated caller (player) → 'permission-denied'
 *   4.  Missing uid → 'invalid-argument'
 *   5.  Whitespace-only uid → 'invalid-argument'
 *   6.  Target uid not found in Auth → 'not-found'
 *   7.  Target user has no email address → 'failed-precondition'
 *   8.  Happy path: admin caller, valid uid → calls generatePasswordResetLink and sendMail
 *   9.  Happy path: returns { success: true }
 *  10.  Unexpected auth.getUser error re-thrown as 'not-found'
 *  11.  (SEC-17) Caller rate limit exhausted (10/min) → 'resource-exhausted'
 *  12.  (SEC-17) Per-target rate limit exhausted (1/5 min) → 'resource-exhausted'
 *  13.  (SEC-17) Happy path passes when both rate-limit counters are below threshold
 *
 * Mocking strategy: follows the established pattern in send-invite.test.ts.
 * Firebase Functions and firebase-admin are mocked at the module boundary.
 * No live emulator is required for these unit-level tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// ─── nodemailer mock ──────────────────────────────────────────────────────────

const mockSendMail = vi.fn().mockResolvedValue({});

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: mockSendMail,
  })),
}));

// ─── Firestore in-memory store ────────────────────────────────────────────────

type DocData = Record<string, unknown>;
const _store: Map<string, DocData> = new Map();

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

const mockDb = {
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

// ─── firebase-admin mock ──────────────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockGeneratePasswordResetLink = vi.fn().mockResolvedValue('https://reset.link/abc123');

vi.mock('firebase-admin', () => {
  const FieldValue = {
    increment: (n: number) => ({ __increment: n }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
    delete: () => ({ __delete: true }),
  };
  const firestoreFn = Object.assign(() => mockDb, { FieldValue });
  return {
    default: {
      initializeApp: vi.fn(),
      firestore: firestoreFn,
      auth: vi.fn(() => ({
        createUser: vi.fn(),
        getUser: mockGetUser,
        generatePasswordResetLink: mockGeneratePasswordResetLink,
      })),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => ({
      createUser: vi.fn(),
      getUser: mockGetUser,
      generatePasswordResetLink: mockGeneratePasswordResetLink,
    })),
  };
});

// ─── Import under test ────────────────────────────────────────────────────────

import { resetUserPassword } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(data: unknown, uid: string | null) {
  return uid ? { auth: { uid }, data } : { auth: null, data };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
}

const fn = resetUserPassword as unknown as (req: unknown) => Promise<unknown>;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  vi.clearAllMocks();

  // Seed users: admin caller, coach caller, player caller, target user
  seedDoc('users/admin1', { role: 'admin' });
  seedDoc('users/coach1', { role: 'coach' });
  seedDoc('users/player1', { role: 'player' });
  seedDoc('users/target1', { role: 'player' });

  // Seed rate-limit docs so checkRateLimit passes on all happy-path tests.
  // Uses the same key pattern as checkRateLimit: rateLimits/{uid}_{action}
  seedDoc('rateLimits/admin1_resetUserPassword', { count: 0, windowStart: Date.now() });
  seedDoc('rateLimits/target1_resetUserPassword-target', { count: 0, windowStart: Date.now() });

  // Default: target user has an email address
  mockGetUser.mockResolvedValue({ uid: 'target1', email: 'target@example.com' });
  mockGeneratePasswordResetLink.mockResolvedValue('https://reset.link/abc123');
  mockSendMail.mockResolvedValue({});
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('resetUserPassword', () => {

  // ── Auth guards ───────────────────────────────────────────────────────────

  it('(1) rejects unauthenticated callers', async () => {
    await expect(fn(makeRequest({ uid: 'target1' }, null))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('(2) rejects coach callers — only admins may reset passwords', async () => {
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

  // ── Target-user resolution ────────────────────────────────────────────────

  it('(6) returns not-found when auth.getUser throws a non-HttpsError', async () => {
    mockGetUser.mockRejectedValue(new Error('auth/user-not-found'));

    await expect(fn(makeRequest({ uid: 'ghost-uid' }, 'admin1'))).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('(7) returns failed-precondition when the target user has no email', async () => {
    mockGetUser.mockResolvedValue({ uid: 'target1', email: undefined });

    await expect(fn(makeRequest({ uid: 'target1' }, 'admin1'))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('(8a) calls generatePasswordResetLink with the target user\'s email', async () => {
    await fn(makeRequest({ uid: 'target1' }, 'admin1'));
    expect(mockGeneratePasswordResetLink).toHaveBeenCalledWith('target@example.com');
  });

  it('(8b) sends an email containing the reset link', async () => {
    await fn(makeRequest({ uid: 'target1' }, 'admin1'));

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const call = mockSendMail.mock.calls[0][0] as Record<string, unknown>;
    expect(call.to).toBe('target@example.com');
    expect((call.text as string)).toContain('https://reset.link/abc123');
  });

  it('(9) returns { success: true } on the happy path', async () => {
    const result = await fn(makeRequest({ uid: 'target1' }, 'admin1'));
    expect(result).toEqual({ success: true });
  });

  // ── Error propagation ─────────────────────────────────────────────────────

  it('(10) re-throws an HttpsError that escapes auth.getUser unchanged', async () => {
    // Simulate getUser itself throwing an HttpsError (e.g. from a previous guard)
    const { HttpsError } = await import('firebase-functions/v2/https');
    mockGetUser.mockRejectedValue(new HttpsError('failed-precondition', 'already set'));

    await expect(fn(makeRequest({ uid: 'target1' }, 'admin1'))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  // ── SEC-17: rate limiting ─────────────────────────────────────────────────

  it('(11) rejects with resource-exhausted when the caller has hit the 10/min limit', async () => {
    // Seed the caller's rate-limit doc at the limit (count >= maxCalls triggers the guard).
    seedDoc('rateLimits/admin1_resetUserPassword', { count: 10, windowStart: Date.now() });

    await expect(fn(makeRequest({ uid: 'target1' }, 'admin1'))).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('(12) rejects with resource-exhausted when the target has already received a reset in the 5-min window', async () => {
    // Caller is fine; target's per-target counter is at its limit of 1.
    seedDoc('rateLimits/admin1_resetUserPassword', { count: 0, windowStart: Date.now() });
    seedDoc('rateLimits/target1_resetUserPassword-target', { count: 1, windowStart: Date.now() });

    await expect(fn(makeRequest({ uid: 'target1' }, 'admin1'))).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('(13) succeeds when both rate-limit counters are below their thresholds', async () => {
    // Explicit setup: caller at 9/10, target at 0/1 — both under their limits.
    seedDoc('rateLimits/admin1_resetUserPassword', { count: 9, windowStart: Date.now() });
    seedDoc('rateLimits/target1_resetUserPassword-target', { count: 0, windowStart: Date.now() });

    const result = await fn(makeRequest({ uid: 'target1' }, 'admin1'));
    expect(result).toEqual({ success: true });
    expect(mockGeneratePasswordResetLink).toHaveBeenCalledWith('target@example.com');
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });
});
