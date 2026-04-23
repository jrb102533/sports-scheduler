/**
 * Tests for the acceptLeagueInvite callable Cloud Function.
 *
 * Covers:
 *   1.  Unauthenticated caller → 'unauthenticated'
 *   2.  Missing inviteId → 'invalid-argument'
 *   3.  Invite document not found → 'not-found'
 *   4.  Caller email does not match invite email (non-admin) → 'permission-denied'
 *   5.  Invite already accepted → 'already-exists'
 *   6.  Happy path (placeholder promotion): coachId set, isPending/pendingEmail removed
 *   7.  Happy path (placeholder promotion): invite stamped with acceptedAt
 *   8.  Happy path (placeholder promotion): returns { success: true }
 *   9.  Happy path (real team path): leagueId added to real team
 *  10.  Happy path (real team path): placeholder team is deleted
 *  11.  Happy path (real team path): events referencing placeholder get teamId migrated
 *  12.  Admin can accept any invite regardless of email mismatch
 *  13.  Caller who is not coach of the provided realTeamId → 'permission-denied'
 *
 * Mocking strategy: follows the pattern established in delete-league.test.ts.
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
        } else if (sentinel && Array.isArray(sentinel['__arrayRemove'])) {
          const toRemove = new Set(sentinel['__arrayRemove'] as unknown[]);
          next[k] = Array.isArray(current[k])
            ? (current[k] as unknown[]).filter((x) => !toRemove.has(x))
            : current[k];
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
    private _startAfterDoc?: unknown;
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
    startAfter(_doc: unknown): MockQuery {
      const q = new MockQuery(this._collectionPath);
      q._filters = [...this._filters];
      q._limitVal = this._limitVal;
      q._startAfterDoc = _doc;
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
          if (f.op === '==' && data[f.field] !== f.value) { matches = false; break; }
          if (f.op === 'array-contains') {
            const arr = data[f.field];
            if (!Array.isArray(arr) || !arr.includes(f.value)) { matches = false; break; }
          }
        }
        if (matches) docs.push({ id: rest, ref: new MockDocRef(path), data: () => data });
      }
      const limited = this._limitVal !== undefined ? docs.slice(0, this._limitVal) : docs;
      return { empty: limited.length === 0, size: limited.length, docs: limited };
    }
  }

  class MockBatch {
    private _ops: Array<() => Promise<void>> = [];
    set(ref: MockDocRef, data: DocData) { this._ops.push(() => ref.set(data)); }
    update(ref: MockDocRef, patch: DocData) { this._ops.push(() => ref.update(patch)); }
    delete(ref: MockDocRef) { this._ops.push(() => ref.delete()); }
    async commit() { for (const op of this._ops) await op(); }
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
    batch: () => new MockBatch(),
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
        createUser: vi.fn(),
        deleteUser: vi.fn(),
        getUserByEmail: vi.fn(),
      })),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => ({
      createUser: vi.fn(),
      deleteUser: vi.fn(),
      getUserByEmail: vi.fn(),
    })),
  };
});

// ─── Import under test ────────────────────────────────────────────────────────

import { acceptLeagueInvite } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type DocData = Record<string, unknown>;

function makeRequest(data: unknown, uid: string | null, email?: string) {
  return uid
    ? { auth: { uid, token: { email: email ?? 'coach@example.com' } }, data }
    : { auth: null, data };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
}

const fn = acceptLeagueInvite as unknown as (req: unknown) => Promise<unknown>;

// ─── Constants ────────────────────────────────────────────────────────────────

const LEAGUE_ID = 'league-alpha';
const INVITE_ID = 'invite-1';
const PLACEHOLDER_TEAM_ID = 'placeholder-team-1';
const REAL_TEAM_ID = 'real-team-1';
const COACH_UID = 'coach1';
const ADMIN_UID = 'admin1';
const OUTSIDER_UID = 'outsider1';
const COACH_EMAIL = 'coach@example.com';

function seedBaseFixtures() {
  seedDoc(`users/${ADMIN_UID}`, { role: 'admin' });
  seedDoc(`users/${COACH_UID}`, { role: 'coach' });
  seedDoc(`users/${OUTSIDER_UID}`, { role: 'coach' });
  seedDoc(`leagues/${LEAGUE_ID}`, { id: LEAGUE_ID, name: 'Alpha League', managerIds: ['mgr1'] });
  seedDoc(`invites/${INVITE_ID}`, {
    email: COACH_EMAIL,
    leagueId: LEAGUE_ID,
    leagueName: 'Alpha League',
    placeholderTeamId: PLACEHOLDER_TEAM_ID,
    invitedBy: 'mgr1',
    invitedAt: '2026-01-01T00:00:00Z',
  });
  seedDoc(`teams/${PLACEHOLDER_TEAM_ID}`, {
    id: PLACEHOLDER_TEAM_ID,
    name: 'Pending — coach@example.com',
    isPending: true,
    pendingEmail: COACH_EMAIL,
    leagueIds: [LEAGUE_ID],
    coachIds: [],
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  vi.clearAllMocks();
  seedBaseFixtures();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('acceptLeagueInvite', () => {

  // ── Auth guards ───────────────────────────────────────────────────────────

  it('(1) rejects unauthenticated callers', async () => {
    await expect(fn(makeRequest({ inviteId: INVITE_ID }, null))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  // ── Input validation ─────────────────────────────────────────────────────

  it('(2) rejects missing inviteId', async () => {
    await expect(fn(makeRequest({}, COACH_UID, COACH_EMAIL))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  // ── Not-found guard ──────────────────────────────────────────────────────

  it('(3) rejects when invite document does not exist', async () => {
    await expect(fn(makeRequest({ inviteId: 'no-such-invite' }, COACH_UID, COACH_EMAIL))).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  // ── Email mismatch ───────────────────────────────────────────────────────

  it('(4) rejects non-admin caller whose email does not match the invite', async () => {
    await expect(fn(makeRequest({ inviteId: INVITE_ID }, OUTSIDER_UID, 'other@example.com'))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  // ── Double-acceptance guard ──────────────────────────────────────────────

  it('(5) rejects when invite has already been accepted', async () => {
    // Pre-stamp the invite as already accepted
    seedDoc(`invites/${INVITE_ID}`, {
      email: COACH_EMAIL,
      leagueId: LEAGUE_ID,
      leagueName: 'Alpha League',
      placeholderTeamId: PLACEHOLDER_TEAM_ID,
      invitedBy: 'mgr1',
      invitedAt: '2026-01-01T00:00:00Z',
      acceptedAt: '2026-01-02T00:00:00Z',
    });

    await expect(fn(makeRequest({ inviteId: INVITE_ID }, COACH_UID, COACH_EMAIL))).rejects.toMatchObject({
      code: 'already-exists',
    });
  });

  // ── Happy path: placeholder promotion ───────────────────────────────────

  it('(6) promotes placeholder: sets coachId and removes isPending/pendingEmail', async () => {
    await fn(makeRequest({ inviteId: INVITE_ID }, COACH_UID, COACH_EMAIL));

    const teamData = _store.get(`teams/${PLACEHOLDER_TEAM_ID}`) as DocData;
    expect(teamData.coachId).toBe(COACH_UID);
    expect(teamData.isPending).toBeUndefined();
    expect(teamData.pendingEmail).toBeUndefined();
  });

  it('(7) stamps invite with acceptedAt after placeholder promotion', async () => {
    await fn(makeRequest({ inviteId: INVITE_ID }, COACH_UID, COACH_EMAIL));

    const inviteData = _store.get(`invites/${INVITE_ID}`) as DocData;
    expect(typeof inviteData.acceptedAt).toBe('string');
    expect(inviteData.acceptedAt).toBeTruthy();
  });

  it('(8) returns { success: true } on placeholder promotion', async () => {
    const result = await fn(makeRequest({ inviteId: INVITE_ID }, COACH_UID, COACH_EMAIL));
    expect(result).toMatchObject({ success: true });
  });

  // ── Happy path: real team path ───────────────────────────────────────────

  it('(9) adds leagueId to real team when realTeamId is provided', async () => {
    seedDoc(`teams/${REAL_TEAM_ID}`, {
      id: REAL_TEAM_ID,
      name: 'Real Team',
      coachIds: [COACH_UID],
      leagueIds: [],
    });

    await fn(makeRequest({ inviteId: INVITE_ID, realTeamId: REAL_TEAM_ID }, COACH_UID, COACH_EMAIL));

    const teamData = _store.get(`teams/${REAL_TEAM_ID}`) as DocData;
    expect(teamData.leagueIds).toContain(LEAGUE_ID);
  });

  it('(10) deletes the placeholder team when realTeamId is provided', async () => {
    seedDoc(`teams/${REAL_TEAM_ID}`, {
      id: REAL_TEAM_ID,
      name: 'Real Team',
      coachIds: [COACH_UID],
      leagueIds: [],
    });

    await fn(makeRequest({ inviteId: INVITE_ID, realTeamId: REAL_TEAM_ID }, COACH_UID, COACH_EMAIL));

    expect(_store.has(`teams/${PLACEHOLDER_TEAM_ID}`)).toBe(false);
  });

  it('(11) migrates events referencing placeholder team to real team', async () => {
    seedDoc(`teams/${REAL_TEAM_ID}`, {
      id: REAL_TEAM_ID,
      name: 'Real Team',
      coachIds: [COACH_UID],
      leagueIds: [],
    });
    seedDoc('events/event-1', {
      id: 'event-1',
      teamIds: [PLACEHOLDER_TEAM_ID],
      leagueId: LEAGUE_ID,
    });

    await fn(makeRequest({ inviteId: INVITE_ID, realTeamId: REAL_TEAM_ID }, COACH_UID, COACH_EMAIL));

    const eventData = _store.get('events/event-1') as DocData;
    const teamIds = eventData.teamIds as string[];
    expect(teamIds).toContain(REAL_TEAM_ID);
    expect(teamIds).not.toContain(PLACEHOLDER_TEAM_ID);
  });

  // ── Admin bypass ─────────────────────────────────────────────────────────

  it('(12) admin can accept any invite regardless of email mismatch', async () => {
    const result = await fn(makeRequest({ inviteId: INVITE_ID }, ADMIN_UID, 'admin@example.com'));
    expect(result).toMatchObject({ success: true });
  });

  // ── Real team ownership guard ────────────────────────────────────────────

  it('(13) rejects non-admin caller who does not own the provided realTeamId', async () => {
    seedDoc(`teams/${REAL_TEAM_ID}`, {
      id: REAL_TEAM_ID,
      name: 'Real Team',
      coachIds: ['other-coach'],  // COACH_UID is NOT in coachIds
      leagueIds: [],
    });

    await expect(fn(makeRequest(
      { inviteId: INVITE_ID, realTeamId: REAL_TEAM_ID },
      COACH_UID,
      COACH_EMAIL
    ))).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
