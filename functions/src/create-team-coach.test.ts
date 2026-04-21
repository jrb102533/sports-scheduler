/**
 * Tests for the createTeamAndBecomeCoach callable Cloud Function.
 *
 * The function atomically:
 *   - Writes a new team document (coachId, coachName, createdBy,
 *     attendanceWarningsEnabled, optional fields).
 *   - Appends a {role:'coach', teamId, isPrimary} membership to the caller's
 *     UserProfile via arrayUnion inside a Firestore transaction.
 *   - Elevates role to 'coach' for player/parent callers; preserves higher roles.
 *   - Returns { teamId, newMembershipIndex }.
 *
 * Coverage:
 *   1.  Unauthenticated caller → 'unauthenticated'
 *   2.  Missing name field → 'invalid-argument'
 *   3.  Empty string name → 'invalid-argument'
 *   4.  Happy path — player user: team doc correct, profile updated, role='coach',
 *       returns { teamId, newMembershipIndex: 0 }
 *   5.  Happy path — existing coach (one existing membership): membership appended,
 *       newMembershipIndex=1, role unchanged, isPrimary:false on new membership
 *   6.  Happy path — parent user: role elevated to 'coach'
 *   7.  Happy path — admin user: role unchanged (stays 'admin')
 *   8.  Optional fields (ageGroup, homeVenue) present when provided;
 *       absent when omitted
 *   9.  Both coachId and createdBy set to caller uid
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
// membership arrays are written as real arrays rather than sentinel objects.

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
// at the end.  arrayUnion sentinels are resolved during the commit sweep so the
// in-memory store holds real arrays that tests can assert on.
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
import { createTeamAndBecomeCoach } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type CreateTeamData = {
  name?: string;
  sportType?: string;
  color?: string;
  ageGroup?: string;
  homeVenue?: string;
};

const VALID_BASE: CreateTeamData = { name: 'Test Team', sportType: 'soccer', color: '#DC143C' };

function makeRequest(uid: string | null, data: CreateTeamData = {}) {
  const merged = { ...VALID_BASE, ...data };
  if (!uid) return { auth: null, data: merged };
  return { auth: { uid }, data: merged };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
}

const fn = createTeamAndBecomeCoach as unknown as (req: unknown) => Promise<unknown>;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  _autoId = 0;

  // Seed rate-limit docs so checkRateLimit passes without hitting resource-exhausted.
  seedDoc('rateLimits/player1_createTeam', { count: 0, windowStart: Date.now() });
  seedDoc('rateLimits/coach1_createTeam', { count: 0, windowStart: Date.now() });
  seedDoc('rateLimits/parent1_createTeam', { count: 0, windowStart: Date.now() });
  seedDoc('rateLimits/admin1_createTeam', { count: 0, windowStart: Date.now() });

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
    memberships: [{ role: 'coach', teamId: 'existing-team', isPrimary: true }],
  });
  seedDoc('users/parent1', {
    uid: 'parent1',
    displayName: 'Carol Parent',
    role: 'parent',
    memberships: [],
  });
  seedDoc('users/admin1', {
    uid: 'admin1',
    displayName: 'Dave Admin',
    role: 'admin',
    memberships: [],
  });
});

// ─── Auth / argument guards ───────────────────────────────────────────────────

describe('createTeamAndBecomeCoach — auth guards', () => {

  it('(1) rejects unauthenticated callers', async () => {
    await expect(fn(makeRequest(null, { name: 'Red Hawks' }))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
});

describe('createTeamAndBecomeCoach — input validation', () => {

  it('(2) rejects when name field is missing', async () => {
    await expect(fn(makeRequest('player1', { name: undefined }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('(3) rejects when name is an empty string', async () => {
    await expect(fn(makeRequest('player1', { name: '' }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('(3) rejects when name is whitespace only', async () => {
    await expect(fn(makeRequest('player1', { name: '   ' }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('(3) rejects when name exceeds 100 characters', async () => {
    await expect(fn(makeRequest('player1', { name: 'a'.repeat(101) }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('(3) rejects invalid sportType', async () => {
    await expect(fn(makeRequest('player1', { sportType: 'notARealSport' }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('(3) rejects invalid team color', async () => {
    await expect(fn(makeRequest('player1', { color: '<script>alert(1)</script>' }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });
});

// ─── Happy path — player user ─────────────────────────────────────────────────

describe('createTeamAndBecomeCoach — player user happy path', () => {

  it('(4) writes team doc with coachId, coachName, createdBy, attendanceWarningsEnabled', async () => {
    const result = await fn(makeRequest('player1', { name: 'Red Hawks' })) as {
      teamId: string;
      newMembershipIndex: number;
    };

    const team = _store.get(`teams/${result.teamId}`);
    expect(team).toBeDefined();
    expect(team?.coachId).toBe('player1');
    expect(team?.coachIds).toEqual(['player1']);
    expect(team?.coachName).toBe('Alice Player');
    expect(team?.createdBy).toBe('player1');
    expect(team?.attendanceWarningsEnabled).toBe(true);
    expect(team?.name).toBe('Red Hawks');
  });

  it('(4) updates profile with coach membership isPrimary:true', async () => {
    const result = await fn(makeRequest('player1', { name: 'Red Hawks' })) as {
      teamId: string;
      newMembershipIndex: number;
    };

    const profile = _store.get('users/player1');
    const memberships = profile?.memberships as Array<Record<string, unknown>>;
    expect(memberships).toBeDefined();
    expect(memberships.some((m) => m.role === 'coach' && m.teamId === result.teamId && m.isPrimary === true)).toBe(true);
  });

  it('(4) elevates role to "coach" for player caller', async () => {
    await fn(makeRequest('player1', { name: 'Red Hawks' }));

    const profile = _store.get('users/player1');
    expect(profile?.role).toBe('coach');
  });

  it('(4) returns { teamId, newMembershipIndex: 0 } for first membership', async () => {
    const result = await fn(makeRequest('player1', { name: 'Red Hawks' })) as {
      teamId: string;
      newMembershipIndex: number;
    };

    expect(typeof result.teamId).toBe('string');
    expect(result.teamId.length).toBeGreaterThan(0);
    expect(result.newMembershipIndex).toBe(0);
  });

  it('(4) sets activeContext on profile to newMembershipIndex', async () => {
    const result = await fn(makeRequest('player1', { name: 'Red Hawks' })) as {
      teamId: string;
      newMembershipIndex: number;
    };

    const profile = _store.get('users/player1');
    expect(profile?.activeContext).toBe(result.newMembershipIndex);
  });
});

// ─── Happy path — existing coach ─────────────────────────────────────────────

describe('createTeamAndBecomeCoach — existing coach (already has one membership)', () => {

  it('(5) appends new membership, newMembershipIndex=1', async () => {
    const result = await fn(makeRequest('coach1', { name: 'Blue Jays' })) as {
      teamId: string;
      newMembershipIndex: number;
    };

    expect(result.newMembershipIndex).toBe(1);
  });

  it('(5) new membership has isPrimary:false', async () => {
    const result = await fn(makeRequest('coach1', { name: 'Blue Jays' })) as {
      teamId: string;
      newMembershipIndex: number;
    };

    const profile = _store.get('users/coach1');
    const memberships = profile?.memberships as Array<Record<string, unknown>>;
    const newMembership = memberships.find((m) => m.teamId === result.teamId);
    expect(newMembership).toBeDefined();
    expect(newMembership?.isPrimary).toBe(false);
  });

  it('(5) role stays "coach" (not downgraded or changed)', async () => {
    await fn(makeRequest('coach1', { name: 'Blue Jays' }));

    const profile = _store.get('users/coach1');
    expect(profile?.role).toBe('coach');
  });

  it('(5) existing membership is preserved alongside new one', async () => {
    const result = await fn(makeRequest('coach1', { name: 'Blue Jays' })) as {
      teamId: string;
      newMembershipIndex: number;
    };

    const profile = _store.get('users/coach1');
    const memberships = profile?.memberships as Array<Record<string, unknown>>;
    expect(memberships.some((m) => m.teamId === 'existing-team')).toBe(true);
    expect(memberships.some((m) => m.teamId === result.teamId)).toBe(true);
  });
});

// ─── Happy path — parent user ─────────────────────────────────────────────────

describe('createTeamAndBecomeCoach — parent user', () => {

  it('(6) elevates role from "parent" to "coach"', async () => {
    await fn(makeRequest('parent1', { name: 'Green Wolves' }));

    const profile = _store.get('users/parent1');
    expect(profile?.role).toBe('coach');
  });
});

// ─── Happy path — admin user ──────────────────────────────────────────────────

describe('createTeamAndBecomeCoach — admin user', () => {

  it('(7) role stays "admin" (not downgraded to coach)', async () => {
    await fn(makeRequest('admin1', { name: 'Gold Stars' }));

    const profile = _store.get('users/admin1');
    expect(profile?.role).toBe('admin');
  });

  it('(7) admin still gets a coach membership appended', async () => {
    const result = await fn(makeRequest('admin1', { name: 'Gold Stars' })) as {
      teamId: string;
      newMembershipIndex: number;
    };

    const profile = _store.get('users/admin1');
    const memberships = profile?.memberships as Array<Record<string, unknown>>;
    expect(memberships.some((m) => m.role === 'coach' && m.teamId === result.teamId)).toBe(true);
  });
});

// ─── Optional fields ──────────────────────────────────────────────────────────

describe('createTeamAndBecomeCoach — optional fields', () => {

  it('(8) ageGroup and homeVenue present in team doc when provided', async () => {
    const result = await fn(makeRequest('player1', {
      name: 'Thunder FC',
      ageGroup: 'U12',
      homeVenue: 'Riverside Park',
    })) as { teamId: string; newMembershipIndex: number };

    const team = _store.get(`teams/${result.teamId}`);
    expect(team?.ageGroup).toBe('U12');
    expect(team?.homeVenue).toBe('Riverside Park');
  });

  it('(8) ageGroup and homeVenue absent from team doc when not provided', async () => {
    const result = await fn(makeRequest('player1', { name: 'Thunder FC' })) as {
      teamId: string;
      newMembershipIndex: number;
    };

    const team = _store.get(`teams/${result.teamId}`);
    expect(team).not.toHaveProperty('ageGroup');
    expect(team).not.toHaveProperty('homeVenue');
  });
});

// ─── coachId and createdBy ────────────────────────────────────────────────────

describe('createTeamAndBecomeCoach — coachId and createdBy', () => {

  it('(9) both coachId and createdBy are set to the caller uid', async () => {
    const result = await fn(makeRequest('player1', { name: 'Iron Clad' })) as {
      teamId: string;
      newMembershipIndex: number;
    };

    const team = _store.get(`teams/${result.teamId}`);
    expect(team?.coachId).toBe('player1');
    expect(team?.createdBy).toBe('player1');
  });
});
