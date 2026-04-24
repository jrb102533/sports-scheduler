/**
 * UID-binding security tests for checkInviteAutoVerify (FW-50 / SEC-105).
 *
 * Vulnerability: the original implementation queries for any pending autoVerify invite
 * by email and marks the CALLING uid as email-verified, without ever consuming the invite.
 * A second Firebase Auth account with the same email can call the function, find the same
 * pending invite, and get auto-verified without possessing the inviteSecret — bypassing the
 * email-verification gate.
 *
 * Fix: after verifying the first caller, stamp the invite with { status: 'used', claimedByUid,
 * claimedAt } atomically. On subsequent calls the invite no longer matches the
 * `status == 'pending'` filter, so the second account cannot be auto-verified.
 * Additionally, if the invite has already been claimed by a different UID the function
 * must return { verified: false } immediately.
 *
 * Tests:
 *   (5) first caller consumes the invite — status set to 'used', claimedByUid recorded
 *   (6) second account with same email cannot be auto-verified after invite is consumed
 *   (7) invite already claimed by a different UID → returns { verified: false } without updateUser
 *   (8) same UID calling again after claiming → still returns { verified: true } (idempotent re-verify)
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

type DocData = Record<string, unknown>;

const _store: Map<string, DocData> = new Map();

// Track update calls so tests can inspect what was written.
const _updateCalls: Array<{ path: string; data: DocData }> = [];

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
    _updateCalls.push({ path: this.path, data });
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
        matched.push({ ref: new MockDocRef(path), data: () => ({ ...docData }) });
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
  const serverTimestamp = () => ({ __serverTimestamp: true });
  const FieldValue = {
    increment: (n: number) => ({ __increment: n }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
    delete: () => ({ __delete: true }),
    serverTimestamp,
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

function makeRequest(uid: string, email: string) {
  return {
    auth: { uid, token: { email } },
    data: {},
  };
}

const INVITE_PATH = 'invites/user@example.com_team1_player';
const EMAIL = 'user@example.com';

function seedPendingInvite() {
  _store.set(INVITE_PATH, {
    email: EMAIL,
    teamId: 'team1',
    autoVerify: true,
    status: 'pending',
  });
}

function seedClaimedInvite(claimedByUid: string) {
  _store.set(INVITE_PATH, {
    email: EMAIL,
    teamId: 'team1',
    autoVerify: true,
    status: 'used',
    claimedByUid,
    claimedAt: { __serverTimestamp: true },
  });
}

function clearStore() {
  _store.clear();
  _updateCalls.length = 0;
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  mockUpdateUser.mockClear();
  // Seed rate-limit docs for both UIDs used across tests.
  _store.set('rateLimits/uid1_checkInviteAutoVerify', { count: 0, windowStart: Date.now() });
  _store.set('rateLimits/uid2_checkInviteAutoVerify', { count: 0, windowStart: Date.now() });
});

// ─── UID-binding / invite-consumption tests (FW-50 / SEC-105) ────────────────

describe('checkInviteAutoVerify — UID binding & invite consumption (FW-50)', () => {

  // (5) After the first caller is auto-verified the invite must be consumed —
  //     status updated to 'used' and claimedByUid recorded.
  it('(5) consumes the invite after verifying — sets status to "used" and records claimedByUid', async () => {
    seedPendingInvite();

    await fn(makeRequest('uid1', EMAIL));

    const storedInvite = _store.get(INVITE_PATH);
    expect(storedInvite?.['status']).toBe('used');
    expect(storedInvite?.['claimedByUid']).toBe('uid1');
    expect(storedInvite?.['claimedAt']).toBeDefined();
  });

  // (6) Replay attack: a second Firebase Auth account with the same email must NOT be
  //     auto-verified once the invite has been consumed.
  it('(6) blocks a second account from being auto-verified after the invite is consumed', async () => {
    // uid1 already claimed the invite.
    seedClaimedInvite('uid1');

    const result = await fn(makeRequest('uid2', EMAIL));

    expect(result.verified).toBe(false);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  // (7) If the invite doc is present but already has claimedByUid pointing to a *different* UID,
  //     return { verified: false } without calling updateUser — even though the doc may still
  //     temporarily appear in a query result due to eventual consistency.
  it('(7) returns { verified: false } when claimedByUid differs from calling uid', async () => {
    // Seed an invite that was claimed by uid1 but is still status 'pending' in a
    // hypothetical mid-transaction window — the pre-check guards against this.
    _store.set(INVITE_PATH, {
      email: EMAIL,
      teamId: 'team1',
      autoVerify: true,
      status: 'pending',
      claimedByUid: 'uid1', // already claimed by someone else
    });

    const result = await fn(makeRequest('uid2', EMAIL));

    expect(result.verified).toBe(false);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  // (8) Idempotency: the original caller may call again (e.g. a retry). The function must
  //     still return { verified: true } — it should not be blocked by its own prior claim.
  it('(8) allows the original claimant to be re-verified idempotently', async () => {
    // The invite is already marked used and claimed by uid1.
    seedClaimedInvite('uid1');

    // uid1 calls again (retry scenario).
    const result = await fn(makeRequest('uid1', EMAIL));

    expect(result.verified).toBe(true);
    expect(mockUpdateUser).toHaveBeenCalledWith('uid1', { emailVerified: true });
  });
});
