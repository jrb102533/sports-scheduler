/**
 * Tests for the sendLeagueInvite, resendLeagueInvite, and revokeInvite
 * callable Cloud Functions.
 *
 * Mock strategy: follows the pattern from send-invite.test.ts.
 * firebase-admin is mocked at the module boundary; vi.hoisted() is NOT used
 * here because the store is declared before any mock factory and is safe to
 * reference via the outer closure.
 *
 * Notable additions over the base pattern:
 *   - MockQuery.add() — sendLeagueInvite uses db.collection('invites').add()
 *   - sendMail spy — exported so each test can assert it was (not) called
 *
 * Coverage:
 *
 *  sendLeagueInvite
 *   1.  Unauthenticated caller → 'unauthenticated'
 *   2.  Coach role → 'permission-denied'
 *   3.  Empty emails array → 'invalid-argument'
 *   4.  More than 20 emails → 'invalid-argument'
 *   5.  Missing leagueId → 'invalid-argument'
 *   6.  League does not exist → 'not-found'
 *   7.  Non-owner LM (managedBy is different uid) → 'permission-denied'
 *   8.  Happy path: placeholder team created with isPending=true
 *   9.  Happy path: invite doc created in /invites collection
 *  10.  Happy path: sendMail called once per email
 *  11.  Happy path: result array has success=true for each email
 *  12.  Happy path: email normalised to lowercase in team + invite docs
 *  13.  Partial failure: one email fails → result includes both success and failure
 *  14.  Admin bypass: admin caller not blocked by managedBy ownership check
 *
 *  resendLeagueInvite
 *  15.  Unauthenticated caller → 'unauthenticated'
 *  16.  Coach role → 'permission-denied'
 *  17.  Missing placeholderTeamId → 'invalid-argument'
 *  18.  Placeholder team not found → 'not-found'
 *  19.  Team is not pending → 'failed-precondition'
 *  20.  Caller is LM but does not own the league → 'permission-denied'
 *  21.  Happy path: sendMail called with reminder subject
 *  22.  Happy path: returns { success: true }
 *  23.  Admin bypass: admin owner-check skipped
 *
 *  revokeInvite
 *  24.  Unauthenticated caller → 'unauthenticated'
 *  25.  Player role → 'permission-denied'
 *  26.  Missing inviteId → 'invalid-argument'
 *  27.  Invite not found → 'not-found'
 *  28.  Coach calling on another coach's team invite → 'permission-denied'
 *  29.  Happy path: invite doc deleted from store
 *  30.  Happy path: returns { success: true }
 *  31.  Admin bypass: admin can revoke any invite regardless of team ownership
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

// ─── nodemailer — spy on sendMail ─────────────────────────────────────────────

const sendMailSpy = vi.fn().mockResolvedValue({});

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: sendMailSpy,
  })),
}));

// ─── Firestore mock infrastructure ───────────────────────────────────────────
//
// The MockQuery class includes an add() method to support
// db.collection('invites').add(...) used by sendLeagueInvite.
// Each added document is stored at `{collectionPath}/{autoId}` in the
// in-memory store so tests can inspect it via _store.

type DocData = Record<string, unknown>;

const _store: Map<string, DocData> = new Map();

// Auto-increment counter for stable, predictable IDs in tests.
let _autoIdCounter = 0;

class MockDocRef {
  constructor(public path: string) {}

  async get(): Promise<{ exists: boolean; data(): DocData | undefined }> {
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

  async delete(): Promise<void> {
    _store.delete(this.path);
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

  async get(): Promise<{ empty: boolean; docs: Array<{ id: string; ref: MockDocRef; data(): DocData }> }> {
    const docs: Array<{ id: string; ref: MockDocRef; data(): DocData }> = [];
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
    return { empty: docs.length === 0, docs };
  }

  /** Supports db.collection(path).add(data) — used by sendLeagueInvite. */
  async add(data: DocData): Promise<MockDocRef> {
    _autoIdCounter += 1;
    const id = `auto-${_autoIdCounter}`;
    const path = `${this._collectionPath}/${id}`;
    _store.set(path, data);
    return new MockDocRef(path);
  }
}

class MockBatch {
  private _ops: Array<() => void> = [];

  set(ref: MockDocRef, data: DocData, opts?: unknown): void {
    this._ops.push(() => {
      const existing =
        opts && (opts as Record<string, unknown>).merge ? (_store.get(ref.path) ?? {}) : {};
      _store.set(ref.path, { ...existing, ...data });
    });
  }

  update(ref: MockDocRef, data: DocData): void {
    this._ops.push(() => {
      _store.set(ref.path, { ...(_store.get(ref.path) ?? {}), ...data });
    });
  }

  delete(ref: MockDocRef): void {
    this._ops.push(() => _store.delete(ref.path));
  }

  async commit(): Promise<void> {
    for (const op of this._ops) op();
    this._ops = [];
  }
}

class MockTransaction {
  private _ops: Array<() => void> = [];

  async get(ref: MockDocRef) {
    return ref.get();
  }

  set(ref: MockDocRef, data: DocData): void {
    this._ops.push(() => { _store.set(ref.path, data); });
  }

  update(ref: MockDocRef, data: DocData): void {
    this._ops.push(() => {
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
    this._ops.push(() => _store.delete(ref.path));
  }

  async commit(): Promise<void> {
    for (const op of this._ops) op();
    this._ops = [];
  }
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
        getUserByEmail: vi.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
        updateUser: vi.fn().mockResolvedValue({}),
      })),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => ({
      createUser: vi.fn(),
      getUserByEmail: vi.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
      updateUser: vi.fn().mockResolvedValue({}),
    })),
  };
});

// ─── Import functions under test AFTER mocks ──────────────────────────────────

import { sendLeagueInvite, resendLeagueInvite, revokeInvite } from './index';

// ─── Typed function wrappers ──────────────────────────────────────────────────

type Fn = (req: unknown) => Promise<unknown>;
const sendFn = sendLeagueInvite as unknown as Fn;
const resendFn = resendLeagueInvite as unknown as Fn;
const revokeFn = revokeInvite as unknown as Fn;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(data: unknown, uid: string | null, _role?: string) {
  // Provide a fake custom claim token so assertAdminOrCoach reads the user doc.
  return uid
    ? { auth: { uid, token: { email: `${uid}@test.com` }, app: {} }, data }
    : { auth: null, data };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
  _autoIdCounter = 0;
}

/** Return all docs whose path starts with a collection prefix (non-subcollection). */
function docsInCollection(prefix: string): DocData[] {
  const results: DocData[] = [];
  for (const [path, data] of _store.entries()) {
    if (!path.startsWith(prefix + '/')) continue;
    const rest = path.slice(prefix.length + 1);
    if (rest.includes('/')) continue;
    results.push(data);
  }
  return results;
}

// ─── Default fixture seeds ────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  sendMailSpy.mockClear();

  // Users
  seedDoc('users/lm1', { role: 'league_manager', subscriptionTier: 'league_manager_pro' });
  seedDoc('users/lm2', { role: 'league_manager', subscriptionTier: 'league_manager_pro' });
  seedDoc('users/admin1', { role: 'admin' });
  seedDoc('users/coach1', { role: 'coach' });
  seedDoc('users/player1', { role: 'player' });

  // Default league: owned by lm1 via legacy managedBy
  seedDoc('leagues/league-1', {
    name: 'Winter League',
    managedBy: 'lm1',
    sportType: 'soccer',
  });

  // Default placeholder team + invite (for resendLeagueInvite tests)
  seedDoc('teams/placeholder-1', {
    id: 'placeholder-1',
    isPending: true,
    pendingEmail: 'coach@team.com',
    leagueIds: ['league-1'],
    name: 'Pending — coach@team.com',
  });
  seedDoc('invites/invite-1', {
    teamId: 'team1',
    email: 'player@example.com',
    invitedBy: 'coach1',
  });
  // Default team for revokeInvite tests
  seedDoc('teams/team1', { coachId: 'coach1', name: 'Falcons' });
});

// =============================================================================
// sendLeagueInvite
// =============================================================================

describe('sendLeagueInvite', () => {

  it('(1) rejects unauthenticated callers', async () => {
    await expect(
      sendFn(makeReq({ emails: ['a@b.com'], leagueId: 'league-1' }, null))
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('(2) rejects callers with coach role', async () => {
    await expect(
      sendFn(makeReq({ emails: ['a@b.com'], leagueId: 'league-1' }, 'coach1'))
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('(3) rejects empty emails array', async () => {
    await expect(
      sendFn(makeReq({ emails: [], leagueId: 'league-1' }, 'lm1'))
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('(4) rejects more than 20 emails', async () => {
    const emails = Array.from({ length: 21 }, (_, i) => `user${i}@test.com`);
    await expect(
      sendFn(makeReq({ emails, leagueId: 'league-1' }, 'lm1'))
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('(5) rejects missing leagueId', async () => {
    await expect(
      sendFn(makeReq({ emails: ['a@b.com'], leagueId: '   ' }, 'lm1'))
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('(6) rejects when league does not exist', async () => {
    await expect(
      sendFn(makeReq({ emails: ['a@b.com'], leagueId: 'nonexistent' }, 'lm1'))
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('(7) rejects LM who does not own the league', async () => {
    // lm2 does not own league-1 (managedBy: 'lm1')
    await expect(
      sendFn(makeReq({ emails: ['a@b.com'], leagueId: 'league-1' }, 'lm2'))
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('(8) creates a placeholder team with isPending=true', async () => {
    // Remove the default placeholder seed so we can assert on exactly the new one.
    _store.delete('teams/placeholder-1');

    await sendFn(makeReq({ emails: ['newcoach@team.com'], leagueId: 'league-1' }, 'lm1'));

    const teamDocs = docsInCollection('teams')
      .filter(d => d.isPending === true);
    expect(teamDocs).toHaveLength(1);
    expect(teamDocs[0].pendingEmail).toBe('newcoach@team.com');
    expect(teamDocs[0].leagueIds).toEqual(['league-1']);
  });

  it('(9) creates an invite doc in the /invites collection', async () => {
    await sendFn(makeReq({ emails: ['newcoach@team.com'], leagueId: 'league-1' }, 'lm1'));

    const inviteDocs = docsInCollection('invites')
      .filter(d => d.email === 'newcoach@team.com');
    expect(inviteDocs).toHaveLength(1);
    expect(inviteDocs[0].leagueId).toBe('league-1');
    expect(inviteDocs[0].invitedBy).toBe('lm1');
  });

  it('(10) calls sendMail once per invited email', async () => {
    await sendFn(
      makeReq({ emails: ['a@team.com', 'b@team.com'], leagueId: 'league-1' }, 'lm1')
    );
    expect(sendMailSpy).toHaveBeenCalledTimes(2);
  });

  it('(11) returns success=true for each email in the result array', async () => {
    const result = await sendFn(
      makeReq({ emails: ['a@team.com', 'b@team.com'], leagueId: 'league-1' }, 'lm1')
    ) as { results: Array<{ email: string; success: boolean }> };

    expect(result.results).toHaveLength(2);
    expect(result.results.every(r => r.success)).toBe(true);
  });

  it('(12) normalises email to lowercase in team and invite docs', async () => {
    // Remove default placeholder so we can isolate the new team doc.
    _store.delete('teams/placeholder-1');

    await sendFn(makeReq({ emails: ['UPPER@COACH.COM'], leagueId: 'league-1' }, 'lm1'));

    const teamDocs = docsInCollection('teams').filter(d => d.isPending === true);
    expect(teamDocs[0].pendingEmail).toBe('upper@coach.com');

    const inviteDocs = docsInCollection('invites').filter(d => d.email !== undefined);
    const targetInvite = inviteDocs.find(d => (d.email as string).includes('upper'));
    expect(targetInvite?.email).toBe('upper@coach.com');
  });

  it('(13) returns partial failure when one email address triggers a send error', async () => {
    sendMailSpy
      .mockResolvedValueOnce({})             // first email succeeds
      .mockRejectedValueOnce(new Error('SMTP down')); // second fails

    const result = await sendFn(
      makeReq({ emails: ['ok@team.com', 'bad@team.com'], leagueId: 'league-1' }, 'lm1')
    ) as { results: Array<{ email: string; success: boolean; error?: string }> };

    const okResult = result.results.find(r => r.email === 'ok@team.com');
    const badResult = result.results.find(r => r.email === 'bad@team.com');
    expect(okResult?.success).toBe(true);
    expect(badResult?.success).toBe(false);
    expect(badResult?.error).toContain('SMTP down');
  });

  it('(14) admin caller bypasses league ownership check', async () => {
    // admin1 does not appear in managedBy but is admin — should succeed.
    const result = await sendFn(
      makeReq({ emails: ['coach@team.com'], leagueId: 'league-1' }, 'admin1')
    ) as { results: Array<{ success: boolean }> };

    expect(result.results[0].success).toBe(true);
  });
});

// =============================================================================
// resendLeagueInvite
// =============================================================================

describe('resendLeagueInvite', () => {

  it('(15) rejects unauthenticated callers', async () => {
    await expect(
      resendFn(makeReq({ placeholderTeamId: 'placeholder-1' }, null))
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('(16) rejects callers with coach role', async () => {
    await expect(
      resendFn(makeReq({ placeholderTeamId: 'placeholder-1' }, 'coach1'))
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('(17) rejects missing placeholderTeamId', async () => {
    await expect(
      resendFn(makeReq({ placeholderTeamId: '   ' }, 'lm1'))
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('(18) rejects when placeholder team is not found', async () => {
    await expect(
      resendFn(makeReq({ placeholderTeamId: 'does-not-exist' }, 'lm1'))
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('(19) rejects when the team is no longer pending', async () => {
    seedDoc('teams/promoted-team', {
      isPending: false,
      pendingEmail: 'ex@coach.com',
      leagueIds: ['league-1'],
    });
    await expect(
      resendFn(makeReq({ placeholderTeamId: 'promoted-team' }, 'lm1'))
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('(20) rejects LM who does not own the league', async () => {
    // lm2 does not own league-1
    await expect(
      resendFn(makeReq({ placeholderTeamId: 'placeholder-1' }, 'lm2'))
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('(21) calls sendMail with a reminder subject line', async () => {
    await resendFn(makeReq({ placeholderTeamId: 'placeholder-1' }, 'lm1'));

    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    const callArgs = sendMailSpy.mock.calls[0][0] as { subject: string };
    expect(callArgs.subject).toMatch(/reminder/i);
  });

  it('(22) returns { success: true }', async () => {
    const result = await resendFn(makeReq({ placeholderTeamId: 'placeholder-1' }, 'lm1'));
    expect(result).toEqual({ success: true });
  });

  it('(23) admin caller bypasses league ownership check', async () => {
    // admin1 does not own league-1 but is admin — should succeed.
    const result = await resendFn(makeReq({ placeholderTeamId: 'placeholder-1' }, 'admin1'));
    expect(result).toEqual({ success: true });
  });
});

// =============================================================================
// revokeInvite
// =============================================================================

describe('revokeInvite', () => {

  it('(24) rejects unauthenticated callers', async () => {
    await expect(
      revokeFn(makeReq({ inviteId: 'invite-1' }, null))
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('(25) rejects callers with player role', async () => {
    await expect(
      revokeFn(makeReq({ inviteId: 'invite-1' }, 'player1'))
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('(26) rejects missing inviteId', async () => {
    await expect(
      revokeFn(makeReq({ inviteId: '   ' }, 'coach1'))
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('(27) rejects when invite is not found', async () => {
    await expect(
      revokeFn(makeReq({ inviteId: 'does-not-exist' }, 'coach1'))
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('(28) rejects coach trying to revoke another coach\'s team invite', async () => {
    // invite-1 belongs to team1, whose coachId is coach1 — coach2 should be denied.
    seedDoc('users/coach2', { role: 'coach' });
    seedDoc('teams/other-team', { coachId: 'coach2', name: 'Other Team' });
    // Create an invite that belongs to other-team, not team1
    seedDoc('invites/invite-other', { teamId: 'other-team', email: 'x@x.com', invitedBy: 'coach2' });

    // coach1 tries to revoke an invite for other-team
    await expect(
      revokeFn(makeReq({ inviteId: 'invite-other' }, 'coach1'))
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('(29) deletes the invite document from the store', async () => {
    expect(_store.has('invites/invite-1')).toBe(true);

    await revokeFn(makeReq({ inviteId: 'invite-1' }, 'coach1'));

    expect(_store.has('invites/invite-1')).toBe(false);
  });

  it('(30) returns { success: true }', async () => {
    const result = await revokeFn(makeReq({ inviteId: 'invite-1' }, 'coach1'));
    expect(result).toEqual({ success: true });
  });

  it('(31) admin can revoke any invite regardless of team ownership', async () => {
    // admin1 is not the coach of team1 — they should still succeed.
    const result = await revokeFn(makeReq({ inviteId: 'invite-1' }, 'admin1'));
    expect(result).toEqual({ success: true });
    expect(_store.has('invites/invite-1')).toBe(false);
  });
});
