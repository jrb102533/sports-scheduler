/**
 * Tests that sendInvite immediately auto-verifies invited users who already have
 * a Firebase Auth account.
 *
 * Scenario: an admin invites an email address that belongs to an existing Firebase
 * Auth user.  sendInvite must call admin.auth().getUserByEmail() and, on success,
 * immediately call admin.auth().updateUser(uid, { emailVerified: true }) so the
 * user can sign in without a verification email.
 *
 * Coverage:
 *   1. When getUserByEmail resolves, updateUser is called with { emailVerified: true }
 *   2. updateUser receives the correct UID from the existing user record
 *   3. When getUserByEmail rejects (user not found), updateUser is NOT called
 *      (the autoVerify flag on the invite doc handles first sign-in instead)
 *   4. sendInvite does not throw when getUserByEmail rejects — the invite write
 *      still completes normally
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

// ─── Configurable Auth mock ───────────────────────────────────────────────────
// mockGetUserByEmail and mockUpdateUser are module-level vi.fn()s so individual
// tests can configure their behaviour with mockResolvedValue / mockRejectedValue
// without needing to re-import the module.

const mockGetUserByEmail = vi.fn();
const mockUpdateUser = vi.fn().mockResolvedValue({});

// ─── Firestore mock ───────────────────────────────────────────────────────────

type DocData = Record<string, unknown>;

interface ArrayUnionSentinel {
  __arrayUnion: unknown[];
}

function isArrayUnionSentinel(v: unknown): v is ArrayUnionSentinel {
  return typeof v === 'object' && v !== null && '__arrayUnion' in v;
}

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
    const resolved: DocData = { ...existing };

    for (const [key, value] of Object.entries(data)) {
      if (isArrayUnionSentinel(value)) {
        const current = Array.isArray(existing[key]) ? (existing[key] as unknown[]) : [];
        const merged = [...current];
        for (const v of value.__arrayUnion) {
          if (!merged.includes(v)) merged.push(v);
        }
        resolved[key] = merged;
      } else {
        resolved[key] = value;
      }
    }
    _store.set(this.path, resolved);
  }

  async update(data: DocData): Promise<void> {
    const existing = _store.get(this.path) ?? {};
    _store.set(this.path, { ...existing, ...data });
  }

  async delete(): Promise<void> {
    _store.delete(this.path);
  }
}

class MockDocSnap {
  exists: boolean;
  constructor(
    public path: string,
    private _data: DocData | undefined,
  ) {
    this.exists = _data !== undefined;
  }
  data(): DocData | undefined {
    return this._data;
  }
}

class MockQuery {
  private _filters: Array<{ field: string; op: string; value: unknown }> = [];
  constructor(private _collectionPath: string) {}
  where(field: string, op: string, value: unknown): MockQuery {
    const q = new MockQuery(this._collectionPath);
    q._filters = [...this._filters, { field, op, value }];
    return q;
  }
  async get(): Promise<{ empty: boolean; docs: unknown[] }> {
    return { empty: true, docs: [] };
  }
}

// Suppress unused variable warning — MockDocSnap is referenced in the mock factory below.
void MockDocSnap;

const mockDb = {
  doc: (path: string) => new MockDocRef(path),
  collection: (path: string) => new MockQuery(path),
  batch: vi.fn(),
  runTransaction: vi.fn(),
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
        createUser: vi.fn(),
        getUserByEmail: mockGetUserByEmail,
        updateUser: mockUpdateUser,
      })),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => ({
      createUser: vi.fn(),
      getUserByEmail: mockGetUserByEmail,
      updateUser: mockUpdateUser,
    })),
  };
});

import { sendInvite } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fn = sendInvite as unknown as (req: unknown) => Promise<unknown>;

const EXISTING_UID = 'uid-existing-parent';

function makeRequest(uid: string = 'coach1') {
  return {
    auth: { uid },
    data: {
      to: 'parent@example.com',
      playerName: 'Bob Smith',
      teamName: 'Eagles',
      playerId: 'player2',
      teamId: 'team1',
    },
  };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

beforeEach(() => {
  _store.clear();
  mockUpdateUser.mockClear();
  mockGetUserByEmail.mockClear();

  seedDoc('users/coach1', { role: 'coach' });
  // SEC-22: team doc so coach1 passes the team-ownership check.
  seedDoc('teams/team1', { coachId: 'coach1', name: 'Eagles' });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sendInvite — existing Firebase Auth user auto-verify', () => {

  it('(1) calls admin.auth().updateUser with { emailVerified: true } when the invited email already has an account', async () => {
    mockGetUserByEmail.mockResolvedValue({ uid: EXISTING_UID });

    await fn(makeRequest());

    expect(mockUpdateUser).toHaveBeenCalledWith(EXISTING_UID, { emailVerified: true });
  });

  it('(2) passes the UID from the existing user record — not the caller UID — to updateUser', async () => {
    mockGetUserByEmail.mockResolvedValue({ uid: EXISTING_UID });

    await fn(makeRequest('coach1'));

    // updateUser must be called with the invited user's UID, not the coach's UID
    const calls = mockUpdateUser.mock.calls;
    expect(calls.some(([uid]) => uid === EXISTING_UID)).toBe(true);
    expect(calls.every(([uid]) => uid !== 'coach1')).toBe(true);
  });

  it('(3) does NOT call admin.auth().updateUser when the invited email has no account yet', async () => {
    mockGetUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' });

    await fn(makeRequest());

    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('(4) does not throw when getUserByEmail rejects — invite doc is still written', async () => {
    mockGetUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' });

    await expect(fn(makeRequest())).resolves.not.toThrow();

    // The invite document must still be written regardless.
    const invite = _store.get('invites/parent@example.com_team1_player');
    expect(invite).toBeDefined();
    expect(invite?.autoVerify).toBe(true);
  });
});
