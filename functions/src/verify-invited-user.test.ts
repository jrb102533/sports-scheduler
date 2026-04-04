/**
 * Tests for the verifyInvitedUser callable Cloud Function.
 *
 * Coverage:
 *   1. Unauthenticated caller → 'unauthenticated'
 *   2. Auth token has no email → 'invalid-argument'
 *   3. No invite document for this email → returns { found: false }, no Auth update
 *   4. Invite exists without autoVerify → links team/player, deletes invite, does NOT update Auth email-verified
 *   5. Invite exists with autoVerify: true → calls admin.auth().updateUser with emailVerified: true
 *   6. Invite exists with autoVerify: true → deletes the invite after processing
 *   7. Invite with role in allowed list updates profile role and primary membership
 *   8. Invite with elevated role is silently ignored (role unchanged)
 *   9. Invite without teamId/playerId fields still returns { found: true }
 *  10. Returns { found: true } when invite found and processed
 *  11. Auth token email is case-normalised before looking up the invite
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
// Full transaction support is required because verifyInvitedUser wraps its
// invite-read + profile-patch + invite-delete inside runTransaction.

type DocData = Record<string, unknown>;

const _store: Map<string, DocData> = new Map();

class MockDocRef {
  constructor(public path: string) {}

  async get(): Promise<MockDocSnap> {
    const data = _store.get(this.path);
    return new MockDocSnap(this.path, data);
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

// Transaction: reads go to the store immediately; writes are buffered and
// committed when commit() is called (same as Firestore batch semantics).
class MockTransaction {
  private _writes: Array<() => void> = [];

  async get(ref: MockDocRef): Promise<MockDocSnap> {
    return ref.get();
  }

  set(ref: MockDocRef, data: DocData, opts?: unknown): void {
    const merge = !!(opts && (opts as Record<string, unknown>).merge);
    this._writes.push(() => {
      const existing: DocData = merge ? (_store.get(ref.path) ?? {}) : {};
      _store.set(ref.path, { ...existing, ...data });
    });
  }

  update(ref: MockDocRef, data: DocData): void {
    this._writes.push(() => {
      const existing = _store.get(ref.path) ?? {};
      const resolved: DocData = {};
      for (const [k, v] of Object.entries(data)) {
        resolved[k] =
          typeof v === 'object' && v !== null && '__increment' in v
            ? ((existing[k] as number) ?? 0) + (v as { __increment: number }).__increment
            : v;
      }
      _store.set(ref.path, { ...existing, ...resolved });
    });
  }

  delete(ref: MockDocRef): void {
    this._writes.push(() => _store.delete(ref.path));
  }

  async commit(): Promise<void> {
    for (const op of this._writes) op();
    this._writes = [];
  }
}

const mockDb = {
  doc: (path: string) => new MockDocRef(path),
  collection: vi.fn(),
  batch: vi.fn(),
  runTransaction: async <T>(cb: (txn: MockTransaction) => Promise<T>): Promise<T> => {
    const txn = new MockTransaction();
    const result = await cb(txn);
    await txn.commit();
    return result;
  },
};

// ─── Auth mock ────────────────────────────────────────────────────────────────

const mockUpdateUser = vi.fn().mockResolvedValue({});
const mockCreateUser = vi.fn().mockResolvedValue({ uid: 'new-uid' });

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
      auth: vi.fn(() => ({ createUser: mockCreateUser, updateUser: mockUpdateUser })),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => ({ createUser: mockCreateUser, updateUser: mockUpdateUser })),
  };
});

import { verifyInvitedUser } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(uid: string | null, email: string | null) {
  if (!uid) return { auth: null, data: {} };
  return {
    auth: { uid, token: { email } },
    data: {},
  };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
}

const fn = verifyInvitedUser as unknown as (req: unknown) => Promise<unknown>;

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  mockUpdateUser.mockClear();
  mockCreateUser.mockClear();
  // Seed rateLimits doc so checkRateLimit doesn't throw
  seedDoc('rateLimits/uid1_verifyInvitedUser', { count: 0, windowStart: Date.now() });
  // Default user profile for uid1
  seedDoc('users/uid1', {
    uid: 'uid1',
    email: 'invited@example.com',
    role: 'player',
    memberships: [{ role: 'player', isPrimary: true }],
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('verifyInvitedUser', () => {

  // ── Auth / argument guards ────────────────────────────────────────────────

  it('(1) rejects unauthenticated callers', async () => {
    await expect(fn(makeRequest(null, null))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('(2) rejects when auth token carries no email', async () => {
    await expect(fn(makeRequest('uid1', null))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  // ── No invite ────────────────────────────────────────────────────────────

  it('(3) returns { found: false } when no invite exists for this email', async () => {
    const result = await fn(makeRequest('uid1', 'invited@example.com')) as { found: boolean };
    expect(result.found).toBe(false);
  });

  it('(3) does not update the Auth user when no invite exists', async () => {
    await fn(makeRequest('uid1', 'invited@example.com'));
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  // ── Invite without autoVerify ─────────────────────────────────────────────

  it('(4) does not call admin.auth().updateUser when autoVerify is absent from invite', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      playerId: 'player1',
    });

    await fn(makeRequest('uid1', 'invited@example.com'));
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('(4) links teamId and playerId to the user profile', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      playerId: 'player1',
    });

    await fn(makeRequest('uid1', 'invited@example.com'));

    const updated = _store.get('users/uid1');
    expect(updated?.teamId).toBe('team1');
    expect(updated?.playerId).toBe('player1');
  });

  it('(4) deletes the invite document after processing (no autoVerify)', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
    });

    await fn(makeRequest('uid1', 'invited@example.com'));

    expect(_store.has('invites/invited@example.com')).toBe(false);
  });

  // ── Invite with autoVerify: true ──────────────────────────────────────────

  it('(5) calls admin.auth().updateUser with emailVerified: true when autoVerify is set', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      playerId: 'player1',
      autoVerify: true,
    });

    await fn(makeRequest('uid1', 'invited@example.com'));

    expect(mockUpdateUser).toHaveBeenCalledWith('uid1', { emailVerified: true });
  });

  it('(6) deletes the invite document after processing (with autoVerify)', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      autoVerify: true,
    });

    await fn(makeRequest('uid1', 'invited@example.com'));

    expect(_store.has('invites/invited@example.com')).toBe(false);
  });

  it('(10) returns { found: true } when invite is present and processed', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      autoVerify: true,
    });

    const result = await fn(makeRequest('uid1', 'invited@example.com')) as { found: boolean };
    expect(result.found).toBe(true);
  });

  // ── Role patching ─────────────────────────────────────────────────────────

  it('(7) upgrades profile role to "parent" when invite specifies that allowed role', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      role: 'parent',
      autoVerify: true,
    });

    await fn(makeRequest('uid1', 'invited@example.com'));

    const updated = _store.get('users/uid1');
    expect(updated?.role).toBe('parent');
  });

  it('(8) does not upgrade profile to an elevated role (e.g. "coach") from an invite', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      role: 'coach',
      autoVerify: true,
    });

    await fn(makeRequest('uid1', 'invited@example.com'));

    const updated = _store.get('users/uid1');
    // 'coach' is not in ALLOWED_INVITE_ROLES so role must remain 'player'
    expect(updated?.role).toBe('player');
  });

  // ── Minimal invite (no teamId/playerId) ───────────────────────────────────

  it('(9) returns { found: true } when invite has no teamId or playerId', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      autoVerify: true,
    });

    const result = await fn(makeRequest('uid1', 'invited@example.com')) as { found: boolean };
    expect(result.found).toBe(true);
  });

  // ── Email normalisation ───────────────────────────────────────────────────

  it('(11) looks up the invite using a lowercased version of the auth token email', async () => {
    // Invite stored under lowercase key; token email is mixed case.
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      autoVerify: true,
    });

    const result = await fn(makeRequest('uid1', 'Invited@Example.COM')) as { found: boolean };
    expect(result.found).toBe(true);
    expect(mockUpdateUser).toHaveBeenCalledWith('uid1', { emailVerified: true });
  });
});
