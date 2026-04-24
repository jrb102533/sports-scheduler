/**
 * Tests for verifyInvitedUser — autoVerify path (FW-43)
 *
 * When an invite document carries `autoVerify: true`, verifyInvitedUser must call
 * `admin.auth().updateUser(uid, { emailVerified: true })` for the newly created user
 * after the Firestore transaction completes.  This lets invited users skip the
 * email-verification gate on first login without ever receiving a verification email.
 *
 * Coverage:
 *   1. autoVerify: true  → calls admin.auth().updateUser with { emailVerified: true }
 *   2. autoVerify: false → does NOT call admin.auth().updateUser
 *   3. autoVerify absent → does NOT call admin.auth().updateUser
 *   4. Returns { found: true } when invite is consumed regardless of autoVerify flag
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

const mockUpdateUser = vi.fn().mockResolvedValue({});

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
    private _limitVal?: number;
    constructor(private _collectionPath: string) {}
    where(field: string, op: string, value: unknown): MockQuery {
      const q = new MockQuery(this._collectionPath);
      q._filters = [...this._filters, { field, op, value }];
      q._limitVal = this._limitVal;
      return q;
    }
    limit(n: number): MockQuery {
      const q = new MockQuery(this._collectionPath);
      q._filters = [...this._filters];
      q._limitVal = n;
      return q;
    }
    async get() {
      const docs: Array<{ ref: MockDocRef; data: () => DocData }> = [];
      for (const [path, data] of _store.entries()) {
        if (!path.startsWith(this._collectionPath + '/')) continue;
        const rest = path.slice(this._collectionPath.length + 1);
        if (rest.includes('/')) continue;
        let matches = true;
        for (const f of this._filters) {
          if (f.op === '==' && data[f.field] !== f.value) { matches = false; break; }
        }
        if (matches) docs.push({ ref: new MockDocRef(path), data: () => data });
        if (this._limitVal !== undefined && docs.length >= this._limitVal) break;
      }
      return { empty: docs.length === 0, docs };
    }
  }

  class MockTransaction {
    private _ops: Array<() => void> = [];
    async get(ref: MockDocRef) { return ref.get(); }
    set(ref: MockDocRef, data: DocData) { this._ops.push(() => _store.set(ref.path, data)); }
    update(ref: MockDocRef, patch: DocData) {
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
    batch: vi.fn(),
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

import { verifyInvitedUser } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type DocData = Record<string, unknown>;

const INVITE_SECRET = 'secret-abc-123';
const USER_UID = 'uid-new-user';
const USER_EMAIL = 'invited@example.com';
const TEAM_ID = 'team-alpha';
const PLAYER_ID = 'player-1';

const fn = verifyInvitedUser as unknown as (req: unknown) => Promise<{ found: boolean }>;

function makeRequest(uid: string, email: string, inviteSecret: string) {
  return {
    auth: { uid, token: { email } },
    data: { inviteSecret },
  };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function seedInvite(autoVerify: boolean | undefined) {
  const docData: DocData = {
    email: USER_EMAIL,
    teamId: TEAM_ID,
    playerId: PLAYER_ID,
    playerName: 'Alice',
    teamName: 'Falcons',
    role: 'player',
    inviteSecret: INVITE_SECRET,
    invitedAt: new Date().toISOString(),
    status: 'pending',
  };
  if (autoVerify !== undefined) {
    docData.autoVerify = autoVerify;
  }
  seedDoc(`invites/${USER_EMAIL}_${TEAM_ID}_player`, docData);
}

beforeEach(() => {
  _store.clear();
  mockUpdateUser.mockClear();

  // Seed rate-limit doc so checkRateLimit passes.
  seedDoc(`rateLimits/${USER_UID}_verifyInvitedUser`, { count: 0, windowStart: Date.now() });
  // Seed a player doc so the transaction can update linkedUid.
  seedDoc(`players/${PLAYER_ID}`, { name: 'Alice', teamId: TEAM_ID });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('verifyInvitedUser — autoVerify path (FW-43)', () => {

  it('(1) calls admin.auth().updateUser with { emailVerified: true } when invite.autoVerify is true', async () => {
    seedInvite(true);

    await fn(makeRequest(USER_UID, USER_EMAIL, INVITE_SECRET));

    expect(mockUpdateUser).toHaveBeenCalledWith(USER_UID, { emailVerified: true });
  });

  it('(1) calls updateUser exactly once (not more) for autoVerify: true', async () => {
    seedInvite(true);

    await fn(makeRequest(USER_UID, USER_EMAIL, INVITE_SECRET));

    expect(mockUpdateUser).toHaveBeenCalledTimes(1);
  });

  it('(2) does NOT call admin.auth().updateUser when invite.autoVerify is false', async () => {
    seedInvite(false);

    await fn(makeRequest(USER_UID, USER_EMAIL, INVITE_SECRET));

    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('(3) does NOT call admin.auth().updateUser when invite has no autoVerify field', async () => {
    seedInvite(undefined);

    await fn(makeRequest(USER_UID, USER_EMAIL, INVITE_SECRET));

    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('(4) returns { found: true } when autoVerify is true', async () => {
    seedInvite(true);

    const result = await fn(makeRequest(USER_UID, USER_EMAIL, INVITE_SECRET));

    expect(result.found).toBe(true);
  });

  it('(4) returns { found: true } when autoVerify is false', async () => {
    seedInvite(false);

    const result = await fn(makeRequest(USER_UID, USER_EMAIL, INVITE_SECRET));

    expect(result.found).toBe(true);
  });

  it('(4) consumes (deletes) the invite doc after processing', async () => {
    seedInvite(true);

    await fn(makeRequest(USER_UID, USER_EMAIL, INVITE_SECRET));

    expect(_store.has(`invites/${USER_EMAIL}_${TEAM_ID}_player`)).toBe(false);
  });
});
