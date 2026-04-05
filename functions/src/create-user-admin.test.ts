/**
 * Tests for the createUserByAdmin callable Cloud Function — access-list sync block.
 *
 * Covers the sync try/catch introduced in PR #260:
 *   - teams/{teamId}.coachIds updated via arrayUnion when role=coach
 *   - leagues/{leagueId}.managerIds updated via arrayUnion when role=league_manager
 *   - auth custom claim {admin:true} set when role=admin
 *   - non-fatal path: .update() throws NOT_FOUND when doc doesn't exist; function
 *     still returns { uid } and calls console.warn
 *
 * Critical: MockDocRef.update() throws NOT_FOUND when the doc is absent,
 * matching real Firestore behaviour. The original backfill mock silently
 * created the doc instead — making the silent-failure path invisible in tests.
 *
 * Coverage:
 *   1.  role=coach,          teamId exists         → coachIds contains new uid
 *   2.  role=coach,          teamId does not exist → NOT_FOUND caught; console.warn; returns {uid}
 *   3.  role=league_manager, leagueId exists       → managerIds contains new uid
 *   4.  role=league_manager, leagueId does not exist → NOT_FOUND caught; console.warn; returns {uid}
 *   5.  role=admin                                 → setCustomUserClaims called with {admin:true}
 *   6.  role=player                                → no team/league update, no custom claim, returns {uid}
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted auth state ───────────────────────────────────────────────────────

const { authClaims, createdUsers } = vi.hoisted(() => ({
  authClaims: new Map<string, Record<string, unknown>>(),
  // Maps email → { uid } so createUser returns a consistent uid per test.
  createdUsers: new Map<string, { uid: string }>(),
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

// ─── MockDocRef ───────────────────────────────────────────────────────────────

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
    // Real Firestore throws NOT_FOUND (gRPC code 5) when the target doc does not exist.
    // Simulate that behaviour so the non-fatal catch path in createUserByAdmin is
    // actually exercised rather than silently succeeding.
    if (!_store.has(this.path)) {
      throw Object.assign(
        new Error(`NOT_FOUND: No document to update: ${this.path}`),
        { code: 5 },
      );
    }
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

// ─── MockCollectionSnap ───────────────────────────────────────────────────────

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

  let _uidCounter = 0;
  const authInstance = {
    createUser: vi.fn(async (data: { email: string }) => {
      const existing = createdUsers.get(data.email);
      if (existing) return existing;
      const uid = `new-uid-${++_uidCounter}`;
      const record = { uid };
      createdUsers.set(data.email, record);
      return record;
    }),
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
import { createUserByAdmin } from './index';
import * as adminMod from 'firebase-admin';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type CreateUserData = {
  email?: string;
  displayName?: string;
  role?: string;
  tempPassword?: string;
  teamId?: string;
  leagueId?: string;
};

const BASE_ADMIN_DATA: CreateUserData = {
  email: 'newuser@example.com',
  displayName: 'New User',
  role: 'player',
  tempPassword: 'Password123!',
};

// makeRequest simulates the callable request from an admin caller.
function makeRequest(callerUid: string, data: CreateUserData) {
  return { auth: { uid: callerUid }, data };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
  authClaims.clear();
  createdUsers.clear();
}

const fn = createUserByAdmin as unknown as (req: unknown) => Promise<{ uid: string }>;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  vi.clearAllMocks();

  // Seed the admin caller so assertAdminOrCoach passes.
  seedDoc('users/admin1', {
    uid: 'admin1',
    displayName: 'Dave Admin',
    role: 'admin',
    memberships: [{ role: 'admin', isPrimary: true }],
  });
});

// ─── Test 1: role=coach, teamId exists ────────────────────────────────────────

describe('createUserByAdmin — role=coach, teamId exists', () => {

  it('(1) adds new uid to teams/{teamId}.coachIds and returns { uid }', async () => {
    seedDoc('teams/team-alpha', {
      name: 'Alpha FC',
      coachIds: [],
    });

    const result = await fn(makeRequest('admin1', {
      ...BASE_ADMIN_DATA,
      role: 'coach',
      teamId: 'team-alpha',
    }));

    expect(result).toHaveProperty('uid');
    expect(typeof result.uid).toBe('string');
    expect(result.uid.length).toBeGreaterThan(0);

    const team = _store.get('teams/team-alpha');
    expect(Array.isArray(team?.coachIds)).toBe(true);
    expect((team?.coachIds as string[])).toContain(result.uid);
  });
});

// ─── Test 2: role=coach, teamId does not exist ────────────────────────────────

describe('createUserByAdmin — role=coach, teamId does not exist', () => {

  it('(2) NOT_FOUND is caught; function still returns { uid }; console.warn is called', async () => {
    // Deliberately do NOT seed teams/team-missing — MockDocRef.update() will throw NOT_FOUND.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fn(makeRequest('admin1', {
      ...BASE_ADMIN_DATA,
      role: 'coach',
      teamId: 'team-missing',
    }));

    // Non-fatal: function must still succeed and return the uid.
    expect(result).toHaveProperty('uid');
    expect(typeof result.uid).toBe('string');

    // The warn block inside the catch must have been called.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('createUserByAdmin: access-list sync failed (non-fatal):'),
      expect.stringContaining('NOT_FOUND'),
    );

    // No spurious doc should have been created in the store.
    expect(_store.has('teams/team-missing')).toBe(false);

    warnSpy.mockRestore();
  });
});

// ─── Test 3: role=league_manager, leagueId exists ────────────────────────────

describe('createUserByAdmin — role=league_manager, leagueId exists', () => {

  it('(3) adds new uid to leagues/{leagueId}.managerIds and returns { uid }', async () => {
    seedDoc('leagues/league-beta', {
      name: 'Beta League',
      managerIds: [],
    });

    const result = await fn(makeRequest('admin1', {
      ...BASE_ADMIN_DATA,
      email: 'manager@example.com',
      role: 'league_manager',
      leagueId: 'league-beta',
    }));

    expect(result).toHaveProperty('uid');

    const league = _store.get('leagues/league-beta');
    expect(Array.isArray(league?.managerIds)).toBe(true);
    expect((league?.managerIds as string[])).toContain(result.uid);
  });
});

// ─── Test 4: role=league_manager, leagueId does not exist ────────────────────

describe('createUserByAdmin — role=league_manager, leagueId does not exist', () => {

  it('(4) NOT_FOUND is caught; function still returns { uid }; console.warn is called', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fn(makeRequest('admin1', {
      ...BASE_ADMIN_DATA,
      email: 'manager2@example.com',
      role: 'league_manager',
      leagueId: 'league-missing',
    }));

    expect(result).toHaveProperty('uid');
    expect(typeof result.uid).toBe('string');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('createUserByAdmin: access-list sync failed (non-fatal):'),
      expect.stringContaining('NOT_FOUND'),
    );

    expect(_store.has('leagues/league-missing')).toBe(false);

    warnSpy.mockRestore();
  });
});

// ─── Test 5: role=admin ───────────────────────────────────────────────────────

describe('createUserByAdmin — role=admin', () => {

  it('(5) calls setCustomUserClaims with { admin: true } for the new uid', async () => {
    const authInstance = vi.mocked(adminMod.auth)();
    vi.mocked(authInstance.setCustomUserClaims).mockClear();

    const result = await fn(makeRequest('admin1', {
      ...BASE_ADMIN_DATA,
      email: 'newadmin@example.com',
      role: 'admin',
    }));

    expect(result).toHaveProperty('uid');
    expect(authInstance.setCustomUserClaims).toHaveBeenCalledWith(result.uid, { admin: true });
  });
});

// ─── Test 6: role=player ──────────────────────────────────────────────────────

describe('createUserByAdmin — role=player', () => {

  it('(6) no team/league update called and no custom claim set; returns { uid }', async () => {
    const authInstance = vi.mocked(adminMod.auth)();
    vi.mocked(authInstance.setCustomUserClaims).mockClear();

    const updateSpy = vi.spyOn(MockDocRef.prototype, 'update');

    const result = await fn(makeRequest('admin1', {
      ...BASE_ADMIN_DATA,
      email: 'player@example.com',
      role: 'player',
    }));

    expect(result).toHaveProperty('uid');
    expect(typeof result.uid).toBe('string');

    // No .update() call should have been made to any team or league doc.
    const updateCalls = updateSpy.mock.calls.map(
      ([data], idx) => ({ data, path: updateSpy.mock.instances[idx].path }),
    );
    const teamOrLeagueUpdates = updateCalls.filter(
      ({ path }) => path.startsWith('teams/') || path.startsWith('leagues/'),
    );
    expect(teamOrLeagueUpdates).toHaveLength(0);

    // No custom claim set for any uid.
    expect(authInstance.setCustomUserClaims).not.toHaveBeenCalled();

    updateSpy.mockRestore();
  });
});
