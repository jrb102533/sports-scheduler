/**
 * Tests for the verifyInvitedUser callable Cloud Function.
 *
 * The function was fully rewritten to:
 *   - Read role from the invite doc (never trust client-supplied role — SEC-20)
 *   - Reject invites that have an invalid or missing role
 *   - Handle new-user path (creates fresh UserProfile with invite role)
 *   - Handle existing-user path (appends membership, does not replace profile)
 *   - Enforce idempotency (duplicate role+teamId not appended twice)
 *   - Write linkedUid on the Player record for 'player' role invites
 *   - Write parentUid on the Player record for 'parent' role invites
 *   - Validate inviteSecret when present on the invite doc (SEC-18)
 *
 * Coverage:
 *   1.  Unauthenticated caller → 'unauthenticated'
 *   2.  Auth token has no email → 'invalid-argument'
 *   3.  No invite document for this email → returns { found: false }
 *   4.  Invite has no role field → defaults to 'player' role (FND-2026-001)
 *   5.  Invite has a disallowed role (e.g. 'coach') → throws 'failed-precondition'
 *   6.  Valid inviteSecret passes through
 *   7.  Wrong inviteSecret → throws 'permission-denied'
 *   8.  Invite without autoVerify → does NOT call admin.auth().updateUser
 *   9.  Invite with autoVerify: true → calls admin.auth().updateUser(uid, { emailVerified: true })
 *   10. Invite is deleted after processing
 *   11. Returns { found: true } when invite found and processed
 *   12. Auth token email is case-normalised before looking up the invite
 *
 *   ── sendInvite stores role ──────────────────────────────────────────────────
 *   13. sendInvite writes the invite role to the invite doc
 *   14. sendInvite defaults to 'player' role when none supplied
 *   15. sendInvite stores the supplied 'parent' role on the invite doc
 *
 *   ── verifyInvitedUser new-user path ────────────────────────────────────────
 *   16. New-user path: creates UserProfile using invite role, not client role
 *   17. New-user path: primary membership uses invite role
 *
 *   ── verifyInvitedUser existing-user path ───────────────────────────────────
 *   18. Existing-user path: appends new membership, does not overwrite existing profile
 *   19. Existing-user path: new membership is not marked isPrimary
 *   20. Existing-user path: includes teamId and playerId on the new membership
 *
 *   ── Idempotency ────────────────────────────────────────────────────────────
 *   21. Duplicate call (invite already consumed) returns { found: false }
 *   22. Same role+teamId membership not appended twice when called concurrently
 *
 *   ── Player record writes ───────────────────────────────────────────────────
 *   23. 'player' invite writes linkedUid on the Player record
 *   24. 'parent' invite writes parentUid on the Player record
 *   25. No player doc update when playerId is absent from invite
 *   26. No player doc update when player record does not exist
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
// Full transaction and arrayUnion support is required because verifyInvitedUser
// wraps all writes inside runTransaction, and uses arrayUnion for membership appends.

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

  async get(): Promise<MockDocSnap> {
    const data = _store.get(this.path);
    return new MockDocSnap(this.path, data);
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

// Transaction: reads go to the store immediately; writes are buffered and
// committed when commit() is called.  arrayUnion sentinels are resolved on commit.
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
      const resolved: DocData = { ...existing };
      for (const [k, v] of Object.entries(data)) {
        if (isArrayUnionSentinel(v)) {
          const current = Array.isArray(existing[k]) ? (existing[k] as unknown[]) : [];
          const merged = [...current];
          for (const item of v.__arrayUnion) {
            if (!merged.some(
              (m) =>
                JSON.stringify(m) === JSON.stringify(item),
            )) {
              merged.push(item);
            }
          }
          resolved[k] = merged;
        } else {
          resolved[k] =
            typeof v === 'object' && v !== null && '__increment' in v
              ? ((existing[k] as number) ?? 0) + (v as { __increment: number }).__increment
              : v;
        }
      }
      _store.set(ref.path, resolved);
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

// Minimal Firestore query builder that filters _store entries by field equality.
// Supports the .where().where().limit().get() chain used by verifyInvitedUser (SEC-20).
class MockQuery {
  private _collection: string;
  private _filters: Array<[string, unknown]> = [];
  private _limitN: number = Infinity;

  constructor(collection: string) {
    this._collection = collection;
  }

  where(field: string, _op: string, value: unknown): this {
    this._filters.push([field, value]);
    return this;
  }

  limit(n: number): this {
    this._limitN = n;
    return this;
  }

  async get(): Promise<{ empty: boolean; docs: Array<{ ref: MockDocRef; data: () => DocData }> }> {
    const prefix = `${this._collection}/`;
    const matched: Array<{ ref: MockDocRef; data: () => DocData }> = [];
    for (const [path, docData] of _store.entries()) {
      if (!path.startsWith(prefix)) continue;
      const passes = this._filters.every(([field, value]) => docData[field] === value);
      if (passes) {
        matched.push({ ref: new MockDocRef(path), data: () => docData });
      }
      if (matched.length >= this._limitN) break;
    }
    return { empty: matched.length === 0, docs: matched };
  }
}

const mockDb = {
  doc: (path: string) => new MockDocRef(path),
  collection: (name: string) => new MockQuery(name),
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

import { verifyInvitedUser, sendInvite } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeVerifyRequest(uid: string | null, email: string | null, inviteSecret?: string) {
  if (!uid) return { auth: null, data: {} };
  return {
    auth: { uid, token: { email } },
    data: { inviteSecret: inviteSecret ?? '' },
  };
}

type SendInviteData = {
  to: string;
  playerName: string;
  teamName: string;
  playerId: string;
  teamId: string;
  role?: string;
};

function makeSendRequest(uid: string, data: Partial<SendInviteData> = {}) {
  return {
    auth: { uid },
    data: {
      to: 'player@example.com',
      playerName: 'Alice Smith',
      teamName: 'Falcons',
      playerId: 'player1',
      teamId: 'team1',
      ...data,
    },
  };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
}

const verifyFn = verifyInvitedUser as unknown as (req: unknown) => Promise<unknown>;
const sendFn = sendInvite as unknown as (req: unknown) => Promise<unknown>;

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  mockUpdateUser.mockClear();
  mockCreateUser.mockClear();

  // Seed rate-limit docs so checkRateLimit doesn't throw.
  seedDoc('rateLimits/uid1_verifyInvitedUser', { count: 0, windowStart: Date.now() });
  seedDoc('rateLimits/coach1_sendInvite', { count: 0, windowStart: Date.now() });

  // Default existing user profile.
  seedDoc('users/uid1', {
    uid: 'uid1',
    email: 'invited@example.com',
    role: 'player',
    memberships: [{ role: 'player', teamId: 'team-existing', isPrimary: true }],
  });

  // Default user roles for sendInvite tests.
  seedDoc('users/coach1', { role: 'coach' });
  seedDoc('users/admin1', { role: 'admin' });

  // SEC-22: team doc required so coach1 passes the team-ownership check.
  seedDoc('teams/team1', { coachId: 'coach1', name: 'Falcons' });
});

// ─── Auth / argument guards ───────────────────────────────────────────────────

describe('verifyInvitedUser — auth guards', () => {

  it('(1) rejects unauthenticated callers', async () => {
    await expect(verifyFn(makeVerifyRequest(null, null))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('(2) rejects when auth token carries no email', async () => {
    await expect(verifyFn(makeVerifyRequest('uid1', null))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });
});

// ─── No invite ────────────────────────────────────────────────────────────────

describe('verifyInvitedUser — no invite', () => {

  it('(3) returns { found: false } when no invite exists for this email', async () => {
    const result = await verifyFn(makeVerifyRequest('uid1', 'invited@example.com')) as { found: boolean };
    expect(result.found).toBe(false);
  });

  it('(3) does not call admin.auth().updateUser when no invite exists', async () => {
    await verifyFn(makeVerifyRequest('uid1', 'invited@example.com'));
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});

// ─── Role validation on invite doc ───────────────────────────────────────────

describe('verifyInvitedUser — invite role validation', () => {

  it('(4) defaults to "player" role when invite has no role field (FND-2026-001)', async () => {
    // Legacy invites written before the role field was added must still be usable.
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      playerId: 'player1',
      autoVerify: true,
      inviteSecret: '',
      // no role field — should default to 'player'
    });
    _store.delete('users/uid1'); // use new-user path so we can inspect the written profile

    const result = await verifyFn(makeVerifyRequest('uid1', 'invited@example.com')) as { found: boolean };
    expect(result.found).toBe(true);
    const profile = _store.get('users/uid1');
    expect(profile?.role).toBe('player');
  });

  it('(5) throws failed-precondition when invite has a disallowed role (e.g. "coach")', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      playerId: 'player1',
      role: 'coach',
      autoVerify: true,
      inviteSecret: '',
    });

    await expect(verifyFn(makeVerifyRequest('uid1', 'invited@example.com'))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('(5) throws failed-precondition when invite has "admin" role', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      role: 'admin',
      inviteSecret: '',
    });

    await expect(verifyFn(makeVerifyRequest('uid1', 'invited@example.com'))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });
});

// ─── Invite secret validation (SEC-18) ───────────────────────────────────────

describe('verifyInvitedUser — invite secret', () => {

  it('(6) succeeds when inviteSecret matches the secret stored on the invite', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      playerId: 'player1',
      role: 'player',
      inviteSecret: 'correct-secret',
      autoVerify: true,
    });

    const result = await verifyFn(makeVerifyRequest('uid1', 'invited@example.com', 'correct-secret')) as { found: boolean };
    expect(result.found).toBe(true);
  });

  it('(7) returns { found: false } when inviteSecret does not match', async () => {
    // SEC-20: the query filters by inviteSecret, so a wrong secret simply yields no matching doc.
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      playerId: 'player1',
      role: 'player',
      inviteSecret: 'correct-secret',
    });

    const result = await verifyFn(
      makeVerifyRequest('uid1', 'invited@example.com', 'wrong-secret'),
    ) as { found: boolean };
    expect(result.found).toBe(false);
  });

  it('(6) returns { found: false } for legacy invites without an inviteSecret field', async () => {
    // SEC-20: the query now filters by inviteSecret. Invites without the field cannot
    // be located when the client sends an empty/absent secret — this is intentional.
    // All invites written after SEC-18 will have the secret field.
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      playerId: 'player1',
      role: 'player',
      autoVerify: true,
      // no inviteSecret field
    });

    const result = await verifyFn(makeVerifyRequest('uid1', 'invited@example.com')) as { found: boolean };
    expect(result.found).toBe(false);
  });
});

// ─── autoVerify behaviour ─────────────────────────────────────────────────────

describe('verifyInvitedUser — autoVerify', () => {

  it('(8) does not call admin.auth().updateUser when autoVerify is absent from invite', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      playerId: 'player1',
      role: 'player',
      inviteSecret: '',
      // no autoVerify
    });

    await verifyFn(makeVerifyRequest('uid1', 'invited@example.com'));
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('(9) calls admin.auth().updateUser with emailVerified: true when autoVerify is set', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      playerId: 'player1',
      role: 'player',
      autoVerify: true,
      inviteSecret: '',
    });

    await verifyFn(makeVerifyRequest('uid1', 'invited@example.com'));
    expect(mockUpdateUser).toHaveBeenCalledWith('uid1', { emailVerified: true });
  });

  it('(10) deletes the invite document after processing', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      role: 'player',
      autoVerify: true,
      inviteSecret: '',
    });

    await verifyFn(makeVerifyRequest('uid1', 'invited@example.com'));
    expect(_store.has('invites/invited@example.com')).toBe(false);
  });

  it('(11) returns { found: true } when invite is present and processed', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      role: 'player',
      autoVerify: true,
      inviteSecret: '',
    });

    const result = await verifyFn(makeVerifyRequest('uid1', 'invited@example.com')) as { found: boolean };
    expect(result.found).toBe(true);
  });
});

// ─── Email normalisation ──────────────────────────────────────────────────────

describe('verifyInvitedUser — email normalisation', () => {

  it('(12) looks up the invite using a lowercased version of the auth token email', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      role: 'player',
      autoVerify: true,
      inviteSecret: '',
    });

    const result = await verifyFn(makeVerifyRequest('uid1', 'Invited@Example.COM')) as { found: boolean };
    expect(result.found).toBe(true);
    expect(mockUpdateUser).toHaveBeenCalledWith('uid1', { emailVerified: true });
  });
});

// ─── sendInvite stores role on invite doc ─────────────────────────────────────

describe('sendInvite — role field on invite doc', () => {

  it('(13) writes the role field to the invite document', async () => {
    await sendFn(makeSendRequest('coach1', { role: 'player' }));

    // SEC-20: doc key is now composite email_teamId_role.
    const invite = _store.get('invites/player@example.com_team1_player');
    expect(invite?.role).toBe('player');
  });

  it('(14) defaults to "player" role when no role is supplied', async () => {
    // No role field in request data.
    await sendFn(makeSendRequest('coach1'));

    const invite = _store.get('invites/player@example.com_team1_player');
    expect(invite?.role).toBe('player');
  });

  it('(15) stores the "parent" role when explicitly supplied', async () => {
    await sendFn(makeSendRequest('coach1', { role: 'parent' }));

    const invite = _store.get('invites/player@example.com_team1_parent');
    expect(invite?.role).toBe('parent');
  });
});

// ─── New-user path ────────────────────────────────────────────────────────────

describe('verifyInvitedUser — new-user path', () => {

  beforeEach(() => {
    // Remove the pre-seeded existing profile so uid1 has no user doc.
    _store.delete('users/uid1');
  });

  it('(16) creates a UserProfile with the role from the invite doc, not a client-supplied role', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      playerId: 'player1',
      role: 'parent',
      autoVerify: true,
      inviteSecret: '',
    });

    await verifyFn(makeVerifyRequest('uid1', 'invited@example.com'));

    const profile = _store.get('users/uid1');
    expect(profile).toBeDefined();
    expect(profile?.role).toBe('parent');
  });

  it('(17) new-user path: primary membership uses the invite role', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      playerId: 'player1',
      role: 'parent',
      autoVerify: true,
      inviteSecret: '',
    });

    await verifyFn(makeVerifyRequest('uid1', 'invited@example.com'));

    const profile = _store.get('users/uid1');
    const memberships = profile?.memberships as Array<Record<string, unknown>>;
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe('parent');
    expect(memberships[0].isPrimary).toBe(true);
  });
});

// ─── Existing-user path ───────────────────────────────────────────────────────

describe('verifyInvitedUser — existing-user path', () => {

  it('(18) appends a new membership without overwriting the existing profile fields', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team-new',
      playerId: 'player1',
      role: 'player',
      autoVerify: true,
      inviteSecret: '',
    });

    await verifyFn(makeVerifyRequest('uid1', 'invited@example.com'));

    const profile = _store.get('users/uid1');
    // The original role must not be overwritten.
    expect(profile?.role).toBe('player');
    // Memberships must now include both old and new entries.
    const memberships = profile?.memberships as Array<Record<string, unknown>>;
    expect(memberships.some((m) => m['teamId'] === 'team-existing')).toBe(true);
    expect(memberships.some((m) => m['teamId'] === 'team-new')).toBe(true);
  });

  it('(19) new membership appended on existing-user path is not marked isPrimary', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team-new',
      playerId: 'player1',
      role: 'player',
      autoVerify: true,
      inviteSecret: '',
    });

    await verifyFn(makeVerifyRequest('uid1', 'invited@example.com'));

    const profile = _store.get('users/uid1');
    const memberships = profile?.memberships as Array<Record<string, unknown>>;
    const newMembership = memberships.find((m) => m['teamId'] === 'team-new');
    expect(newMembership).toBeDefined();
    expect(newMembership?.isPrimary).toBe(false);
  });

  it('(20) new membership includes teamId and playerId from the invite', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team-new',
      playerId: 'player99',
      role: 'player',
      autoVerify: true,
      inviteSecret: '',
    });

    await verifyFn(makeVerifyRequest('uid1', 'invited@example.com'));

    const profile = _store.get('users/uid1');
    const memberships = profile?.memberships as Array<Record<string, unknown>>;
    const newMembership = memberships.find((m) => m['teamId'] === 'team-new');
    expect(newMembership?.teamId).toBe('team-new');
    expect(newMembership?.playerId).toBe('player99');
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe('verifyInvitedUser — idempotency', () => {

  it('(21) returns { found: false } when invite is already consumed (doc deleted)', async () => {
    // No invite doc seeded — simulates a second call after first already deleted it.
    const result = await verifyFn(makeVerifyRequest('uid1', 'invited@example.com')) as { found: boolean };
    expect(result.found).toBe(false);
  });

  it('(22) does not append the same role+teamId membership twice', async () => {
    // Seed an invite and process it once.
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team-existing',
      playerId: 'player1',
      role: 'player',
      autoVerify: true,
      inviteSecret: '',
    });

    await verifyFn(makeVerifyRequest('uid1', 'invited@example.com'));

    // The existing membership already has role='player', teamId='team-existing'.
    // After processing, the membership array should still have only ONE entry for that combo.
    const profile = _store.get('users/uid1');
    const memberships = profile?.memberships as Array<Record<string, unknown>>;
    const dupes = memberships.filter((m) => m['role'] === 'player' && m['teamId'] === 'team-existing');
    expect(dupes).toHaveLength(1);
  });
});

// ─── Player record writes ─────────────────────────────────────────────────────

describe('verifyInvitedUser — player record writes', () => {

  it('(23) writes linkedUid on the Player record for a "player" role invite', async () => {
    seedDoc('players/player1', {
      id: 'player1',
      teamId: 'team1',
      firstName: 'Alice',
      lastName: 'Smith',
    });
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      playerId: 'player1',
      role: 'player',
      autoVerify: true,
      inviteSecret: '',
    });

    await verifyFn(makeVerifyRequest('uid1', 'invited@example.com'));

    const player = _store.get('players/player1');
    expect(player?.linkedUid).toBe('uid1');
    expect(player?.parentUid).toBeUndefined();
  });

  it('(24) writes parentUid on the Player record for a "parent" role invite', async () => {
    seedDoc('players/player1', {
      id: 'player1',
      teamId: 'team1',
      firstName: 'Alice',
      lastName: 'Smith',
    });
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      playerId: 'player1',
      role: 'parent',
      autoVerify: true,
      inviteSecret: '',
    });

    await verifyFn(makeVerifyRequest('uid1', 'invited@example.com'));

    const player = _store.get('players/player1');
    expect(player?.parentUid).toBe('uid1');
    expect(player?.linkedUid).toBeUndefined();
  });

  it('(25) does not attempt a player doc update when playerId is absent from invite', async () => {
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      role: 'player',
      autoVerify: true,
      inviteSecret: '',
      // no playerId
    });

    // Should complete without error and return found: true.
    const result = await verifyFn(makeVerifyRequest('uid1', 'invited@example.com')) as { found: boolean };
    expect(result.found).toBe(true);
  });

  it('(26) skips player doc update when the player record does not exist', async () => {
    // playerId is present but no players/player-missing doc exists.
    seedDoc('invites/invited@example.com', {
      email: 'invited@example.com',
      teamId: 'team1',
      playerId: 'player-missing',
      role: 'player',
      autoVerify: true,
      inviteSecret: '',
    });

    // Should complete without error.
    const result = await verifyFn(makeVerifyRequest('uid1', 'invited@example.com')) as { found: boolean };
    expect(result.found).toBe(true);
    expect(_store.has('players/player-missing')).toBe(false);
  });
});
