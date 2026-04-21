/**
 * Tests for the backfillAccessControl admin-only callable Cloud Function.
 *
 * The function idempotently back-fills RBAC access-list fields:
 *   1. team.coachIds  — built from coachId + createdBy; skipped if array already present
 *   2. league.managerIds — built from managedBy; skipped if array already present
 *   3. user.memberships — synthesised from legacy role/teamId/leagueId fields;
 *      skipped if non-empty array already present
 *   4. Auth custom claim {admin:true} — set on any user whose role or membership
 *      includes 'admin'; skipped if claim already set
 *
 * Coverage:
 *   1.  Unauthenticated call → 'unauthenticated'
 *   2.  Non-admin call → 'permission-denied'
 *   3.  Teams without coachIds → backfilled from coachId + createdBy
 *   4.  Teams already with coachIds → skipped (idempotency)
 *   5.  Leagues without managerIds → backfilled from managedBy
 *   6.  Leagues already with managerIds → skipped (idempotency)
 *   7.  Users without memberships → backfilled from role/teamId/leagueId
 *   8.  Users already with memberships → skipped (idempotency)
 *   9.  Admin user without custom claim → claim set, count incremented
 *   10. Admin user already with custom claim → skipped (idempotency)
 *   11. Returns counts object with correct field names
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted auth-claim state ─────────────────────────────────────────────────
// vi.hoisted() runs before vi.mock() factories, so this Map is available
// inside the firebase-admin mock factory closure.
const { authClaims } = vi.hoisted(() => ({
  authClaims: new Map<string, Record<string, unknown>>(),
}));

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

interface ArrayUnionSentinel {
  __arrayUnion: unknown[];
}

function isArrayUnionSentinel(v: unknown): v is ArrayUnionSentinel {
  return typeof v === 'object' && v !== null && '__arrayUnion' in v;
}

const _store: Map<string, DocData> = new Map();

// ─── MockCollectionSnap ───────────────────────────────────────────────────────

class MockDocRef {
  constructor(public path: string) {}

  get id(): string {
    return this.path.split('/').pop()!;
  }

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

  async delete(): Promise<void> {
    _store.delete(this.path);
  }
}

class MockDocSnap {
  exists: boolean;
  ref: MockDocRef;
  constructor(
    public path: string,
    private _data: DocData | undefined,
  ) {
    this.exists = _data !== undefined;
    this.ref = new MockDocRef(path);
  }
  get id(): string {
    return this.path.split('/').pop()!;
  }
  data(): DocData | undefined {
    return this._data;
  }
}

class MockCollectionSnap {
  docs: MockDocSnap[];
  constructor(docs: MockDocSnap[]) {
    this.docs = docs;
  }
}

// ─── MockBatch ────────────────────────────────────────────────────────────────

class MockBatch {
  private _ops: Array<() => void> = [];

  update(ref: MockDocRef, data: DocData): this {
    this._ops.push(() => {
      const existing = _store.get(ref.path) ?? {};
      const resolved: DocData = { ...existing };
      for (const [k, v] of Object.entries(data)) {
        if (isArrayUnionSentinel(v)) {
          const current = Array.isArray(existing[k]) ? (existing[k] as unknown[]) : [];
          const merged = [...current];
          for (const item of v.__arrayUnion) {
            if (!merged.includes(item)) merged.push(item);
          }
          resolved[k] = merged;
        } else {
          resolved[k] = v;
        }
      }
      _store.set(ref.path, resolved);
    });
    return this;
  }

  async commit(): Promise<void> {
    for (const op of this._ops) op();
    this._ops = [];
  }
}


// ─── firebase-admin mock ──────────────────────────────────────────────────────

const mockDb = {
  doc: (path: string) => new MockDocRef(path),
  collection: (collectionPath: string) => ({
    doc: (id?: string) => new MockDocRef(`${collectionPath}/${id ?? 'auto'}`),
    get: async (): Promise<MockCollectionSnap> => {
      const prefix = `${collectionPath}/`;
      const docs = [..._store.entries()]
        .filter(([k]) => k.startsWith(prefix) && k.slice(prefix.length).indexOf('/') === -1)
        .map(([k, v]) => new MockDocSnap(k, v));
      return new MockCollectionSnap(docs);
    },
  }),
  batch: (): MockBatch => new MockBatch(),
  runTransaction: async <T>(cb: (txn: unknown) => Promise<T>): Promise<T> => {
    // Simplified transaction: run immediately, no buffering needed for assertAdmin.
    const txn = {
      get: async (ref: MockDocRef) => ref.get(),
      set: (ref: MockDocRef, data: DocData) => { _store.set(ref.path, { ...data }); },
      update: (ref: MockDocRef, data: DocData) => {
        const existing = _store.get(ref.path) ?? {};
        _store.set(ref.path, { ...existing, ...data });
      },
    };
    return cb(txn);
  },
};

vi.mock('firebase-admin', () => {
  const FieldValue = {
    increment: (n: number) => ({ __increment: n }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
    delete: () => ({ __delete: true }),
  };
  const firestoreFn = Object.assign(() => mockDb, { FieldValue });
  const authInstance = {
    createUser: vi.fn(),
    updateUser: vi.fn().mockResolvedValue({}),
    getUser: vi.fn(async (uid: string) => ({
      uid,
      customClaims: authClaims.get(uid) ?? null,
    })),
    setCustomUserClaims: vi.fn(async (uid: string, claims: Record<string, unknown>) => {
      authClaims.set(uid, claims);
    }),
  };
  return {
    default: {
      initializeApp: vi.fn(),
      firestore: firestoreFn,
      auth: vi.fn(() => authInstance),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => authInstance),
  };
});

// Import AFTER mocks are registered.
import { backfillAccessControl } from './index';
import * as adminMod from 'firebase-admin';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(uid: string | null) {
  if (!uid) return { auth: null, data: {} };
  return { auth: { uid }, data: {} };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
  authClaims.clear();
}

const fn = backfillAccessControl as unknown as (req: unknown) => Promise<{
  teams: number;
  leagues: number;
  adminClaims: number;
  usersBackfilled: number;
}>;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();

  // Seed admin caller profile so assertAdmin passes.
  seedDoc('users/admin1', {
    uid: 'admin1',
    displayName: 'Dave Admin',
    role: 'admin',
    memberships: [{ role: 'admin', isPrimary: true }],
  });

  // Seed non-admin caller.
  seedDoc('users/coach1', {
    uid: 'coach1',
    displayName: 'Bob Coach',
    role: 'coach',
    memberships: [{ role: 'coach', teamId: 'team-alpha', isPrimary: true }],
  });
});

// ─── Auth guards ──────────────────────────────────────────────────────────────

describe('backfillAccessControl — auth guards', () => {

  it('(1) rejects unauthenticated callers', async () => {
    await expect(fn(makeRequest(null))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('(2) rejects non-admin callers', async () => {
    await expect(fn(makeRequest('coach1'))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });
});

// ─── Teams backfill ───────────────────────────────────────────────────────────

describe('backfillAccessControl — teams', () => {

  it('(3) team without coachIds gets backfilled from coachId + createdBy', async () => {
    seedDoc('teams/team-1', {
      coachId: 'uid-coach',
      createdBy: 'uid-creator',
      name: 'Red Hawks',
    });

    const result = await fn(makeRequest('admin1'));

    const team = _store.get('teams/team-1');
    expect(Array.isArray(team?.coachIds)).toBe(true);
    expect((team?.coachIds as string[]).sort()).toEqual(['uid-coach', 'uid-creator'].sort());
    expect(result.teams).toBe(1);
  });

  it('(3) team with only coachId (no createdBy) gets single-element coachIds', async () => {
    seedDoc('teams/team-2', {
      coachId: 'uid-only-coach',
      name: 'Blue Jays',
    });

    await fn(makeRequest('admin1'));

    const team = _store.get('teams/team-2');
    expect(team?.coachIds).toEqual(['uid-only-coach']);
  });

  it('(3) when coachId === createdBy, coachIds has only one entry (deduplication)', async () => {
    seedDoc('teams/team-3', {
      coachId: 'uid-same',
      createdBy: 'uid-same',
      name: 'Green Wolves',
    });

    await fn(makeRequest('admin1'));

    const team = _store.get('teams/team-3');
    expect(team?.coachIds).toEqual(['uid-same']);
  });

  it('(4) team already with coachIds is skipped — count not incremented', async () => {
    seedDoc('teams/team-existing', {
      coachIds: ['uid-existing'],
      coachId: 'uid-existing',
      createdBy: 'uid-existing',
      name: 'Gold Stars',
    });

    const result = await fn(makeRequest('admin1'));

    const team = _store.get('teams/team-existing');
    // Array should be unchanged.
    expect(team?.coachIds).toEqual(['uid-existing']);
    expect(result.teams).toBe(0);
  });
});

// ─── Leagues backfill ─────────────────────────────────────────────────────────

describe('backfillAccessControl — leagues', () => {

  it('(5) league without managerIds gets backfilled from managedBy', async () => {
    seedDoc('leagues/league-1', {
      managedBy: 'uid-manager',
      name: 'Summer League',
    });

    const result = await fn(makeRequest('admin1'));

    const league = _store.get('leagues/league-1');
    expect(league?.managerIds).toEqual(['uid-manager']);
    expect(result.leagues).toBe(1);
  });

  it('(5) league with no managedBy gets empty managerIds array', async () => {
    seedDoc('leagues/league-2', {
      name: 'Orphan League',
    });

    await fn(makeRequest('admin1'));

    const league = _store.get('leagues/league-2');
    expect(league?.managerIds).toEqual([]);
  });

  it('(6) league already with managerIds is skipped — count not incremented', async () => {
    seedDoc('leagues/league-existing', {
      managerIds: ['uid-existing-manager'],
      managedBy: 'uid-existing-manager',
      name: 'Premier League',
    });

    const result = await fn(makeRequest('admin1'));

    const league = _store.get('leagues/league-existing');
    expect(league?.managerIds).toEqual(['uid-existing-manager']);
    expect(result.leagues).toBe(0);
  });
});

// ─── Users backfill ───────────────────────────────────────────────────────────

describe('backfillAccessControl — users memberships', () => {

  it('(7) user without memberships gets a synthesised membership', async () => {
    seedDoc('users/legacy-player', {
      uid: 'legacy-player',
      role: 'player',
      teamId: 'team-alpha',
    });

    const result = await fn(makeRequest('admin1'));

    const user = _store.get('users/legacy-player');
    const memberships = user?.memberships as Array<Record<string, unknown>>;
    expect(Array.isArray(memberships)).toBe(true);
    expect(memberships.length).toBe(1);
    expect(memberships[0].role).toBe('player');
    expect(memberships[0].teamId).toBe('team-alpha');
    expect(memberships[0].isPrimary).toBe(true);
    expect(result.usersBackfilled).toBeGreaterThanOrEqual(1);
  });

  it('(7) user without memberships and playerId/leagueId gets all optional fields', async () => {
    seedDoc('users/legacy-coach', {
      uid: 'legacy-coach',
      role: 'coach',
      teamId: 'team-beta',
      playerId: 'player-xyz',
      leagueId: 'league-gamma',
    });

    await fn(makeRequest('admin1'));

    const user = _store.get('users/legacy-coach');
    const memberships = user?.memberships as Array<Record<string, unknown>>;
    expect(memberships[0].teamId).toBe('team-beta');
    expect(memberships[0].playerId).toBe('player-xyz');
    expect(memberships[0].leagueId).toBe('league-gamma');
  });

  it('(7) user with empty memberships array gets backfilled', async () => {
    seedDoc('users/empty-memberships', {
      uid: 'empty-memberships',
      role: 'parent',
      memberships: [],
    });

    const result = await fn(makeRequest('admin1'));

    const user = _store.get('users/empty-memberships');
    const memberships = user?.memberships as Array<Record<string, unknown>>;
    expect(memberships.length).toBe(1);
    expect(memberships[0].role).toBe('parent');
    expect(result.usersBackfilled).toBeGreaterThanOrEqual(1);
  });

  it('(8) user with existing non-empty memberships is skipped', async () => {
    seedDoc('users/modern-user', {
      uid: 'modern-user',
      role: 'coach',
      memberships: [{ role: 'coach', teamId: 'team-existing', isPrimary: true }],
    });

    const result = await fn(makeRequest('admin1'));

    const user = _store.get('users/modern-user');
    const memberships = user?.memberships as Array<Record<string, unknown>>;
    // Memberships unchanged.
    expect(memberships.length).toBe(1);
    expect(memberships[0].teamId).toBe('team-existing');
    expect(result.usersBackfilled).toBe(0);
  });
});

// ─── Admin custom claims ──────────────────────────────────────────────────────

describe('backfillAccessControl — admin custom claims', () => {

  it('(9) admin user without claim gets {admin:true} set and count incremented', async () => {
    // admin1 seeded in beforeEach with role='admin'; getUser returns no claim.
    const authInstance = vi.mocked(adminMod.auth)();
    vi.mocked(authInstance.setCustomUserClaims).mockClear();

    const result = await fn(makeRequest('admin1'));

    expect(authInstance.setCustomUserClaims).toHaveBeenCalledWith('admin1', { admin: true });
    expect(result.adminClaims).toBe(1);
  });

  it('(10) admin user already with claim is skipped — count not incremented', async () => {
    const authInstance = vi.mocked(adminMod.auth)();
    // Override getUser to return {admin:true} for just this test's invocations,
    // then restore so later tests see the default implementation.
    const originalGetUser = vi.mocked(authInstance.getUser).getMockImplementation();
    vi.mocked(authInstance.getUser).mockResolvedValue(
      { uid: 'admin1', customClaims: { admin: true } } as never,
    );
    vi.mocked(authInstance.setCustomUserClaims).mockClear();

    const result = await fn(makeRequest('admin1'));

    // Restore original implementation so it doesn't leak into later tests.
    if (originalGetUser) {
      vi.mocked(authInstance.getUser).mockImplementation(originalGetUser);
    } else {
      vi.mocked(authInstance.getUser).mockRestore();
    }

    expect(authInstance.setCustomUserClaims).not.toHaveBeenCalled();
    expect(result.adminClaims).toBe(0);
  });

  it('(9) admin identified via memberships (not top-level role) gets claim', async () => {
    // User whose top-level role is stale but membership says admin.
    seedDoc('users/admin-via-membership', {
      uid: 'admin-via-membership',
      role: 'player',
      memberships: [{ role: 'admin', isPrimary: true }],
    });
    const authInstance = vi.mocked(adminMod.auth)();
    vi.mocked(authInstance.setCustomUserClaims).mockClear();

    const result = await fn(makeRequest('admin1'));

    expect(authInstance.setCustomUserClaims).toHaveBeenCalledWith('admin-via-membership', { admin: true });
    expect(result.adminClaims).toBeGreaterThanOrEqual(1);
  });

  it('(9) non-admin user does not get an admin claim', async () => {
    seedDoc('users/regular-coach', {
      uid: 'regular-coach',
      role: 'coach',
      memberships: [{ role: 'coach', teamId: 'team-x', isPrimary: true }],
    });
    const authInstance = vi.mocked(adminMod.auth)();
    vi.mocked(authInstance.setCustomUserClaims).mockClear();

    await fn(makeRequest('admin1'));

    // setCustomUserClaims may be called for admin1 itself, but NOT for regular-coach.
    const calls = vi.mocked(authInstance.setCustomUserClaims).mock.calls;
    expect(calls.every(([uid]) => uid !== 'regular-coach')).toBe(true);
  });
});

// ─── Return shape ─────────────────────────────────────────────────────────────

describe('backfillAccessControl — return value', () => {

  it('(11) returns object with teams, leagues, adminClaims, usersBackfilled keys', async () => {
    const result = await fn(makeRequest('admin1'));

    expect(result).toHaveProperty('teams');
    expect(result).toHaveProperty('leagues');
    expect(result).toHaveProperty('adminClaims');
    expect(result).toHaveProperty('usersBackfilled');
    expect(typeof result.teams).toBe('number');
    expect(typeof result.leagues).toBe('number');
    expect(typeof result.adminClaims).toBe('number');
    expect(typeof result.usersBackfilled).toBe('number');
  });

  it('(11) returns all zeros when collections are empty (except admin1 user)', async () => {
    // Only admin1 seeded — it has memberships, so usersBackfilled=0.
    // admin1 has no custom claim yet, so adminClaims=1.
    const result = await fn(makeRequest('admin1'));

    expect(result.teams).toBe(0);
    expect(result.leagues).toBe(0);
    expect(result.usersBackfilled).toBe(0);
    expect(result.adminClaims).toBe(1); // admin1 itself gets the claim
  });

  it('(11) calling twice returns zeros on the second call (idempotency)', async () => {
    seedDoc('teams/idempotent-team', {
      coachId: 'uid-a',
      createdBy: 'uid-b',
      name: 'Test Team',
    });
    seedDoc('leagues/idempotent-league', {
      managedBy: 'uid-manager',
      name: 'Test League',
    });

    // First call — backfills everything.
    const first = await fn(makeRequest('admin1'));
    expect(first.teams).toBe(1);
    expect(first.leagues).toBe(1);

    // Second call — everything is already present, all counts should be 0.
    const second = await fn(makeRequest('admin1'));
    expect(second.teams).toBe(0);
    expect(second.leagues).toBe(0);
    expect(second.usersBackfilled).toBe(0);
    expect(second.adminClaims).toBe(0);
  });
});
