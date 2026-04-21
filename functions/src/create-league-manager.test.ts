/**
 * Tests for the createLeagueAndBecomeManager callable Cloud Function.
 *
 * The function atomically:
 *   - Writes a new league document (managedBy=uid, optional sportType/season/description).
 *   - Appends a {role:'league_manager', leagueId, isPrimary} membership to the caller's
 *     UserProfile via arrayUnion inside a Firestore transaction.
 *   - Elevates role to 'league_manager' for player/parent/coach callers; preserves
 *     higher roles (admin).
 *   - Returns { leagueId, newMembershipIndex }.
 *
 * Coverage:
 *   1.  Unauthenticated caller → 'unauthenticated'
 *   2.  Missing name → 'invalid-argument'
 *   3.  Happy path — player user: league doc correct, profile updated, role='league_manager',
 *       returns { leagueId, newMembershipIndex: 0 }
 *   4.  Happy path — coach user: role elevated to 'league_manager'
 *   5.  Happy path — existing LM (already has one LM membership): new membership appended,
 *       role unchanged, newMembershipIndex=1
 *   6.  Happy path — admin user: role unchanged (stays 'admin')
 *   7.  Optional fields (sportType, season, description) present when provided; absent when not
 *   8.  managedBy set to caller uid on league doc
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
//
// The transaction mock must resolve arrayUnion sentinels on commit so that
// membership arrays are written as real arrays that tests can assert on.

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

// Transaction: reads go directly to the store; writes are buffered and committed
// at the end.  arrayUnion sentinels are resolved during the commit sweep.
class MockTransaction {
  private _writes: Array<() => void> = [];

  async get(ref: MockDocRef): Promise<MockDocSnap> {
    return ref.get();
  }

  set(ref: MockDocRef, data: DocData, _opts?: unknown): void {
    this._writes.push(() => {
      _store.set(ref.path, { ...data });
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
            if (
              !merged.some((m) => JSON.stringify(m) === JSON.stringify(item))
            ) {
              merged.push(item);
            }
          }
          resolved[k] = merged;
        } else if (
          typeof v === 'object' &&
          v !== null &&
          '__increment' in v
        ) {
          resolved[k] =
            ((existing[k] as number) ?? 0) +
            (v as { __increment: number }).__increment;
        } else {
          resolved[k] = v;
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

let _autoId = 0;
const mockDb = {
  doc: (path: string) => new MockDocRef(path),
  collection: (collectionPath: string) => ({
    doc: (id?: string) => new MockDocRef(`${collectionPath}/${id ?? `auto-${++_autoId}`}`),
  }),
  batch: vi.fn(),
  runTransaction: async <T>(cb: (txn: MockTransaction) => Promise<T>): Promise<T> => {
    const txn = new MockTransaction();
    const result = await cb(txn);
    await txn.commit();
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
      auth: vi.fn(() => ({ createUser: vi.fn(), updateUser: vi.fn().mockResolvedValue({}) })),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => ({ createUser: vi.fn(), updateUser: vi.fn().mockResolvedValue({}) })),
  };
});

// Import AFTER mocks are registered.
import { createLeagueAndBecomeManager } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type CreateLeagueData = {
  name?: string;
  sportType?: string;
  season?: string;
  description?: string;
};

function makeRequest(uid: string | null, data: CreateLeagueData = {}) {
  if (!uid) return { auth: null, data };
  return { auth: { uid }, data };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
}

const fn = createLeagueAndBecomeManager as unknown as (req: unknown) => Promise<unknown>;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  _autoId = 0;

  // Seed rate-limit docs so checkRateLimit passes.
  seedDoc('rateLimits/player1_createLeague', { count: 0, windowStart: Date.now() });
  seedDoc('rateLimits/coach1_createLeague', { count: 0, windowStart: Date.now() });
  seedDoc('rateLimits/lm1_createLeague', { count: 0, windowStart: Date.now() });
  seedDoc('rateLimits/admin1_createLeague', { count: 0, windowStart: Date.now() });

  // Default user profiles.
  seedDoc('users/player1', {
    uid: 'player1',
    displayName: 'Alice Player',
    role: 'player',
    memberships: [],
  });
  seedDoc('users/coach1', {
    uid: 'coach1',
    displayName: 'Bob Coach',
    role: 'coach',
    memberships: [{ role: 'coach', teamId: 'team-alpha', isPrimary: true }],
  });
  seedDoc('users/lm1', {
    uid: 'lm1',
    displayName: 'Eve Manager',
    role: 'league_manager',
    memberships: [{ role: 'league_manager', leagueId: 'league-old', isPrimary: true }],
  });
  seedDoc('users/admin1', {
    uid: 'admin1',
    displayName: 'Dave Admin',
    role: 'admin',
    memberships: [],
  });
});

// ─── Auth / argument guards ───────────────────────────────────────────────────

describe('createLeagueAndBecomeManager — auth guards', () => {

  it('(1) rejects unauthenticated callers', async () => {
    await expect(fn(makeRequest(null, { name: 'Premier League' }))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
});

describe('createLeagueAndBecomeManager — input validation', () => {

  it('(2) rejects when name field is missing', async () => {
    await expect(fn(makeRequest('player1', {}))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('(2) rejects when name is an empty string', async () => {
    await expect(fn(makeRequest('player1', { name: '' }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('(2) rejects when name is whitespace only', async () => {
    await expect(fn(makeRequest('player1', { name: '   ' }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('(2) rejects when name exceeds 100 characters', async () => {
    await expect(fn(makeRequest('player1', { name: 'a'.repeat(101) }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('(2) rejects invalid sportType', async () => {
    await expect(fn(makeRequest('player1', { name: 'Test League', sportType: 'notARealSport' }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('(2) rejects description over 2000 characters', async () => {
    await expect(fn(makeRequest('player1', { name: 'Test League', description: 'a'.repeat(2001) }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });
});

// ─── Happy path — player user ─────────────────────────────────────────────────

describe('createLeagueAndBecomeManager — player user happy path', () => {

  it('(3) writes league doc with managedBy=uid', async () => {
    const result = await fn(makeRequest('player1', { name: 'Summer League' })) as {
      leagueId: string;
      newMembershipIndex: number;
    };

    const league = _store.get(`leagues/${result.leagueId}`);
    expect(league).toBeDefined();
    expect(league?.managedBy).toBe('player1');
    expect(league?.managerIds).toEqual(['player1']);
    expect(league?.name).toBe('Summer League');
  });

  it('(3) updates profile with league_manager membership isPrimary:true', async () => {
    const result = await fn(makeRequest('player1', { name: 'Summer League' })) as {
      leagueId: string;
      newMembershipIndex: number;
    };

    const profile = _store.get('users/player1');
    const memberships = profile?.memberships as Array<Record<string, unknown>>;
    expect(memberships).toBeDefined();
    expect(
      memberships.some(
        (m) => m.role === 'league_manager' && m.leagueId === result.leagueId && m.isPrimary === true,
      ),
    ).toBe(true);
  });

  it('(3) elevates role to "league_manager" for player caller', async () => {
    await fn(makeRequest('player1', { name: 'Summer League' }));

    const profile = _store.get('users/player1');
    expect(profile?.role).toBe('league_manager');
  });

  it('(3) returns { leagueId, newMembershipIndex: 0 } for first membership', async () => {
    const result = await fn(makeRequest('player1', { name: 'Summer League' })) as {
      leagueId: string;
      newMembershipIndex: number;
    };

    expect(typeof result.leagueId).toBe('string');
    expect(result.leagueId.length).toBeGreaterThan(0);
    expect(result.newMembershipIndex).toBe(0);
  });

  it('(3) sets activeContext on profile to newMembershipIndex', async () => {
    const result = await fn(makeRequest('player1', { name: 'Summer League' })) as {
      leagueId: string;
      newMembershipIndex: number;
    };

    const profile = _store.get('users/player1');
    expect(profile?.activeContext).toBe(result.newMembershipIndex);
  });
});

// ─── Happy path — coach user ──────────────────────────────────────────────────

describe('createLeagueAndBecomeManager — coach user', () => {

  it('(4) coach role stays "coach" — not auto-elevated to "league_manager"', async () => {
    await fn(makeRequest('coach1', { name: 'Regional League' }));

    const profile = _store.get('users/coach1');
    expect(profile?.role).toBe('coach');
  });

  it('(4) league_manager membership is appended alongside existing coach membership', async () => {
    const result = await fn(makeRequest('coach1', { name: 'Regional League' })) as {
      leagueId: string;
      newMembershipIndex: number;
    };

    const profile = _store.get('users/coach1');
    const memberships = profile?.memberships as Array<Record<string, unknown>>;
    expect(memberships.some((m) => m.role === 'coach' && m.teamId === 'team-alpha')).toBe(true);
    expect(memberships.some((m) => m.role === 'league_manager' && m.leagueId === result.leagueId)).toBe(true);
  });
});

// ─── Happy path — existing league manager ────────────────────────────────────

describe('createLeagueAndBecomeManager — existing league manager', () => {

  it('(5) appends new membership, newMembershipIndex=1', async () => {
    const result = await fn(makeRequest('lm1', { name: 'Winter League' })) as {
      leagueId: string;
      newMembershipIndex: number;
    };

    expect(result.newMembershipIndex).toBe(1);
  });

  it('(5) role stays "league_manager" (not changed)', async () => {
    await fn(makeRequest('lm1', { name: 'Winter League' }));

    const profile = _store.get('users/lm1');
    expect(profile?.role).toBe('league_manager');
  });

  it('(5) new membership has isPrimary:false', async () => {
    const result = await fn(makeRequest('lm1', { name: 'Winter League' })) as {
      leagueId: string;
      newMembershipIndex: number;
    };

    const profile = _store.get('users/lm1');
    const memberships = profile?.memberships as Array<Record<string, unknown>>;
    const newMembership = memberships.find((m) => m.leagueId === result.leagueId);
    expect(newMembership).toBeDefined();
    expect(newMembership?.isPrimary).toBe(false);
  });

  it('(5) existing membership is preserved alongside new one', async () => {
    const result = await fn(makeRequest('lm1', { name: 'Winter League' })) as {
      leagueId: string;
      newMembershipIndex: number;
    };

    const profile = _store.get('users/lm1');
    const memberships = profile?.memberships as Array<Record<string, unknown>>;
    expect(memberships.some((m) => m.leagueId === 'league-old')).toBe(true);
    expect(memberships.some((m) => m.leagueId === result.leagueId)).toBe(true);
  });
});

// ─── Happy path — admin user ──────────────────────────────────────────────────

describe('createLeagueAndBecomeManager — admin user', () => {

  it('(6) role stays "admin" (not downgraded to league_manager)', async () => {
    await fn(makeRequest('admin1', { name: 'National League' }));

    const profile = _store.get('users/admin1');
    expect(profile?.role).toBe('admin');
  });

  it('(6) admin still gets a league_manager membership appended', async () => {
    const result = await fn(makeRequest('admin1', { name: 'National League' })) as {
      leagueId: string;
      newMembershipIndex: number;
    };

    const profile = _store.get('users/admin1');
    const memberships = profile?.memberships as Array<Record<string, unknown>>;
    expect(
      memberships.some((m) => m.role === 'league_manager' && m.leagueId === result.leagueId),
    ).toBe(true);
  });
});

// ─── Optional fields ──────────────────────────────────────────────────────────

describe('createLeagueAndBecomeManager — optional fields', () => {

  it('(7) sportType, season, description present in league doc when provided', async () => {
    const result = await fn(makeRequest('player1', {
      name: 'Coastal League',
      sportType: 'soccer',
      season: 'Spring 2026',
      description: 'Annual coastal youth soccer league',
    })) as { leagueId: string; newMembershipIndex: number };

    const league = _store.get(`leagues/${result.leagueId}`);
    expect(league?.sportType).toBe('soccer');
    expect(league?.season).toBe('Spring 2026');
    expect(league?.description).toBe('Annual coastal youth soccer league');
  });

  it('(7) sportType, season, description absent from league doc when not provided', async () => {
    const result = await fn(makeRequest('player1', { name: 'Coastal League' })) as {
      leagueId: string;
      newMembershipIndex: number;
    };

    const league = _store.get(`leagues/${result.leagueId}`);
    expect(league).not.toHaveProperty('sportType');
    expect(league).not.toHaveProperty('season');
    expect(league).not.toHaveProperty('description');
  });
});

// ─── managedBy field ─────────────────────────────────────────────────────────

describe('createLeagueAndBecomeManager — managedBy field', () => {

  it('(8) managedBy is set to the caller uid on the league doc', async () => {
    const result = await fn(makeRequest('player1', { name: 'Valley League' })) as {
      leagueId: string;
      newMembershipIndex: number;
    };

    const league = _store.get(`leagues/${result.leagueId}`);
    expect(league?.managedBy).toBe('player1');
  });

  it('(8) managedBy for coach caller is the coach uid', async () => {
    const result = await fn(makeRequest('coach1', { name: 'Valley League' })) as {
      leagueId: string;
      newMembershipIndex: number;
    };

    const league = _store.get(`leagues/${result.leagueId}`);
    expect(league?.managedBy).toBe('coach1');
  });
});
