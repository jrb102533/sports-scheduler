/**
 * Tests for the previewInvite callable Cloud Function.
 *
 * previewInvite is a read-only, pre-auth CF that lets the signup page verify
 * an inviteSecret before the user creates their account. It returns
 * { valid: true, email } when the secret matches a pending invite, or
 * { valid: false, email: null } otherwise.  No state is mutated.
 *
 * Because this CF is called by unauthenticated users, it is rate-limited by
 * a hash of the inviteSecret itself (max 5 calls/min per unique secret).
 *
 * Coverage:
 *   1. Missing or empty inviteSecret → throws 'invalid-argument'
 *   2. Unknown inviteSecret → returns { valid: false, email: null }
 *   3. Already-consumed invite (status !== 'pending') → returns { valid: false, email: null }
 *   4. Valid pending invite → returns { valid: true, email: <invite email> }
 *   5. Rate limit: 6th call with the same secret → throws 'resource-exhausted'
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
  runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    // Minimal transaction stub: passes a tx object that delegates to _store.
    const tx = {
      get: async (ref: MockDocRef) => ref.get(),
      set: (ref: MockDocRef, data: DocData) => {
        _store.set(ref.path, data);
      },
    };
    return fn(tx);
  }),
};

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
        updateUser: vi.fn().mockResolvedValue({}),
        getUserByEmail: vi.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
        createUser: vi.fn(),
      })),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => ({
      updateUser: vi.fn().mockResolvedValue({}),
      getUserByEmail: vi.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
      createUser: vi.fn(),
    })),
  };
});

import { previewInvite } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fn = previewInvite as unknown as (
  req: unknown,
) => Promise<{ valid: boolean; email: string | null }>;

/** Build a request with no auth (unauthenticated caller). */
function makeRequest(inviteSecret: string) {
  return { auth: null, data: { inviteSecret } };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
}

const VALID_SECRET = 'secret-uuid-valid';
const INVITE_EMAIL = 'parent@example.com';

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  // Seed rate-limit doc at 0 for the valid secret so tests don't trip the limit.
  const secretKey = Buffer.from(VALID_SECRET).toString('base64url').slice(0, 40);
  seedDoc(`rateLimits/anon_previewInvite_${secretKey}`, { count: 0, windowStart: Date.now() });
});

// ─── previewInvite tests ──────────────────────────────────────────────────────

describe('previewInvite', () => {

  // ── Input validation ────────────────────────────────────────────────────

  it('(1) throws invalid-argument when inviteSecret is missing', async () => {
    await expect(fn({ auth: null, data: {} })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('(1) throws invalid-argument when inviteSecret is empty string', async () => {
    await expect(fn(makeRequest(''))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  // ── Unknown / consumed invite ────────────────────────────────────────────

  it('(2) returns { valid: false, email: null } for an unknown secret', async () => {
    const result = await fn(makeRequest('no-such-secret-xyz'));
    expect(result).toEqual({ valid: false, email: null });
  });

  it('(3) returns { valid: false, email: null } when invite status is not "pending"', async () => {
    seedDoc('invites/parent@example.com_team1_parent', {
      email: INVITE_EMAIL,
      teamId: 'team1',
      role: 'parent',
      inviteSecret: VALID_SECRET,
      status: 'accepted',
    });
    const result = await fn(makeRequest(VALID_SECRET));
    expect(result).toEqual({ valid: false, email: null });
  });

  // ── Valid pending invite ─────────────────────────────────────────────────

  it('(4) returns { valid: true, email } for a pending invite with correct secret', async () => {
    seedDoc('invites/parent@example.com_team1_parent', {
      email: INVITE_EMAIL,
      teamId: 'team1',
      role: 'parent',
      inviteSecret: VALID_SECRET,
      status: 'pending',
    });
    const result = await fn(makeRequest(VALID_SECRET));
    expect(result).toEqual({ valid: true, email: INVITE_EMAIL });
  });

  it('(4) does not mutate the invite document', async () => {
    const invitePath = 'invites/parent@example.com_team1_parent';
    seedDoc(invitePath, {
      email: INVITE_EMAIL,
      teamId: 'team1',
      role: 'parent',
      inviteSecret: VALID_SECRET,
      status: 'pending',
    });
    await fn(makeRequest(VALID_SECRET));
    // Status must still be 'pending' — previewInvite is read-only.
    const snap = _store.get(invitePath);
    expect(snap?.status).toBe('pending');
  });

  // ── Rate limit ───────────────────────────────────────────────────────────

  it('(5) throws resource-exhausted after 5 calls with the same secret', async () => {
    // Seed an invite so calls don't short-circuit on "not found".
    seedDoc('invites/parent@example.com_team1_parent', {
      email: INVITE_EMAIL,
      teamId: 'team1',
      role: 'parent',
      inviteSecret: VALID_SECRET,
      status: 'pending',
    });

    // Override the rate-limit doc so the next call is the 6th.
    const secretKey = Buffer.from(VALID_SECRET).toString('base64url').slice(0, 40);
    seedDoc(`rateLimits/anon_previewInvite_${secretKey}`, {
      count: 5,
      windowStart: Date.now(),
    });

    await expect(fn(makeRequest(VALID_SECRET))).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });
});
