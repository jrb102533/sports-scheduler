/**
 * Tests for the checkInviteAutoVerify callable Cloud Function.
 *
 * This function is called after signInWithEmailAndPassword when emailVerified is false.
 * It queries for a pending autoVerify invite for the authenticated user's email and,
 * if found, marks their Firebase Auth account as email-verified.  Unlike verifyInvitedUser
 * it does not consume (delete) the invite — that happens through the invite-link flow.
 *
 * Coverage:
 *   1. Unauthenticated caller → throws 'unauthenticated'
 *   2. Authenticated but no email on auth token → throws 'invalid-argument'
 *   3. No matching autoVerify invite → returns { verified: false }
 *   4. Matching invite found → calls admin.auth().updateUser and returns { verified: true }
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

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: vi.fn().mockResolvedValue({}),
  })),
}));

// ─── Firestore mock infrastructure ───────────────────────────────────────────
// Minimal implementation — checkInviteAutoVerify only reads via a collection query,
// so we need doc() for rate-limit reads and collection().where().limit().get() for
// the invite query.

type DocData = Record<string, unknown>;

const _store: Map<string, DocData> = new Map();

class MockDocRef {
  constructor(public path: string) {}

  async get(): Promise<{ exists: boolean; data: () => DocData | undefined }> {
    const data = _store.get(this.path);
    return { exists: data !== undefined, data: () => data };
  }

  async set(data: DocData, opts?: unknown): Promise<void> {
    const merge = !!(opts && (opts as Record<string, unknown>).merge);
    const existing: DocData = merge ? (_store.get(this.path) ?? {}) : {};
    _store.set(this.path, { ...existing, ...data });
  }

  async update(data: DocData): Promise<void> {
    const existing = _store.get(this.path) ?? {};
    _store.set(this.path, { ...existing, ...data });
  }
}

class MockQuery {
  private _filters: Array<{ field: string; op: string; value: unknown }> = [];
  private _limitN: number = Infinity;

  constructor(private _collectionPath: string) {}

  where(field: string, op: string, value: unknown): MockQuery {
    const q = new MockQuery(this._collectionPath);
    q._filters = [...this._filters, { field, op, value }];
    q._limitN = this._limitN;
    return q;
  }

  limit(n: number): MockQuery {
    const q = new MockQuery(this._collectionPath);
    q._filters = [...this._filters];
    q._limitN = n;
    return q;
  }

  async get(): Promise<{ empty: boolean; docs: Array<{ ref: MockDocRef; data: () => DocData }> }> {
    const prefix = `${this._collectionPath}/`;
    const matched: Array<{ ref: MockDocRef; data: () => DocData }> = [];
    for (const [path, docData] of _store.entries()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest.includes('/')) continue;
      const passes = this._filters.every(({ field, op, value }) => {
        if (op === '==') return docData[field] === value;
        return true;
      });
      if (passes) {
        matched.push({ ref: new MockDocRef(path), data: () => docData });
        if (matched.length >= this._limitN) break;
      }
    }
    return { empty: matched.length === 0, docs: matched };
  }
}

const mockDb = {
  doc: (path: string) => new MockDocRef(path),
  collection: (path: string) => new MockQuery(path),
  batch: vi.fn(),
  runTransaction: vi.fn(),
};

// ─── Auth mock ────────────────────────────────────────────────────────────────

const mockUpdateUser = vi.fn().mockResolvedValue({});

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
        updateUser: mockUpdateUser,
        getUserByEmail: vi.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
        createUser: vi.fn(),
      })),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => ({
      updateUser: mockUpdateUser,
      getUserByEmail: vi.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
      createUser: vi.fn(),
    })),
  };
});

import { checkInviteAutoVerify } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fn = checkInviteAutoVerify as unknown as (req: unknown) => Promise<{ verified: boolean }>;

function makeRequest(uid: string | null, email: string | null | undefined) {
  if (!uid) return { auth: null, data: {} };
  return {
    auth: {
      uid,
      token: email !== undefined ? { email } : {},
    },
    data: {},
  };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  mockUpdateUser.mockClear();
  // Seed rate-limit doc so checkRateLimit doesn't throw.
  seedDoc('rateLimits/uid1_checkInviteAutoVerify', { count: 0, windowStart: Date.now() });
});

// ─── checkInviteAutoVerify tests ──────────────────────────────────────────────

describe('checkInviteAutoVerify', () => {

  // ── Auth guard ────────────────────────────────────────────────────────────

  it('(1) rejects unauthenticated callers', async () => {
    await expect(fn(makeRequest(null, null))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('(2) rejects when auth token carries no email', async () => {
    // Pass uid but omit email from the token object entirely.
    await expect(fn(makeRequest('uid1', undefined))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('(2) rejects when auth token email is null', async () => {
    await expect(fn(makeRequest('uid1', null))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  // ── No matching invite ────────────────────────────────────────────────────

  it('(3) returns { verified: false } when no autoVerify invite exists for this email', async () => {
    const result = await fn(makeRequest('uid1', 'user@example.com'));
    expect(result.verified).toBe(false);
  });

  it('(3) does not call admin.auth().updateUser when no matching invite is found', async () => {
    await fn(makeRequest('uid1', 'user@example.com'));
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('(3) returns { verified: false } when invite exists but autoVerify is false', async () => {
    seedDoc('invites/user@example.com_team1_player', {
      email: 'user@example.com',
      teamId: 'team1',
      autoVerify: false,
      status: 'pending',
    });

    const result = await fn(makeRequest('uid1', 'user@example.com'));
    expect(result.verified).toBe(false);
  });

  // ── Matching invite found ─────────────────────────────────────────────────

  it('(4) calls admin.auth().updateUser(uid, { emailVerified: true }) when invite found', async () => {
    seedDoc('invites/user@example.com_team1_player', {
      email: 'user@example.com',
      teamId: 'team1',
      autoVerify: true,
      status: 'pending',
    });

    await fn(makeRequest('uid1', 'user@example.com'));
    expect(mockUpdateUser).toHaveBeenCalledWith('uid1', { emailVerified: true });
  });

  it('(4) returns { verified: true } when a matching autoVerify invite is found', async () => {
    seedDoc('invites/user@example.com_team1_player', {
      email: 'user@example.com',
      teamId: 'team1',
      autoVerify: true,
      status: 'pending',
    });

    const result = await fn(makeRequest('uid1', 'user@example.com'));
    expect(result.verified).toBe(true);
  });

  it('(4) email from token is lowercased before querying invites', async () => {
    seedDoc('invites/user@example.com_team1_player', {
      email: 'user@example.com',
      teamId: 'team1',
      autoVerify: true,
      status: 'pending',
    });

    // Token carries mixed-case email — CF should normalise to lowercase before query.
    const result = await fn(makeRequest('uid1', 'User@Example.COM'));
    expect(result.verified).toBe(true);
    expect(mockUpdateUser).toHaveBeenCalledWith('uid1', { emailVerified: true });
  });
});
