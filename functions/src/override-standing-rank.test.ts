/**
 * Tests for the overrideStandingRank callable Cloud Function.
 *
 * Covers:
 *   1.  Unauthenticated caller → 'unauthenticated'
 *   2.  Coach caller (not admin/LM) → 'permission-denied'
 *   3.  Missing leagueId → 'invalid-argument'
 *   4.  Missing seasonId → 'invalid-argument'
 *   5.  Missing teamId → 'invalid-argument'
 *   6.  override.note is empty string → 'invalid-argument'
 *   7.  override.rank is not a positive integer (zero) → 'invalid-argument'
 *   8.  override.rank is not a positive integer (negative) → 'invalid-argument'
 *   9.  override.scope is invalid → 'invalid-argument'
 *  10.  League not found → 'not-found'
 *  11.  Caller is LM but does not manage this league → 'permission-denied'
 *  12.  Happy path: override is written to standings doc with caller's uid
 *  13.  Happy path: passing override=null clears the manualRankOverride field
 *  14.  Happy path: returns { status: 'ok' }
 *  15.  Admin can override standings for any league
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
        if (sentinel && sentinel['__delete']) {
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
    constructor(private _collectionPath: string) {}
    where(field: string, op: string, value: unknown): MockQuery {
      const q = new MockQuery(this._collectionPath);
      q._filters = [...this._filters, { field, op, value }];
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
        }
        if (matches) docs.push({ id: rest, ref: new MockDocRef(path), data: () => data });
      }
      return { empty: docs.length === 0, size: docs.length, docs };
    }
  }

  class MockBatch {
    private _ops: Array<() => Promise<void>> = [];
    set(ref: MockDocRef, data: DocData) { this._ops.push(() => ref.set(data)); }
    update(ref: MockDocRef, patch: DocData) { this._ops.push(() => ref.update(patch)); }
    delete(ref: MockDocRef) { this._ops.push(() => ref.delete()); }
    async commit() { for (const op of this._ops) await op(); }
  }

  const firestoreInstance = {
    doc: (path: string) => new MockDocRef(path),
    collection: (path: string) => new MockQuery(path),
    batch: () => new MockBatch(),
    runTransaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb({}),
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

import { overrideStandingRank } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type DocData = Record<string, unknown>;

function makeRequest(data: unknown, uid: string | null) {
  return uid ? { auth: { uid }, data } : { auth: null, data };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
}

const fn = overrideStandingRank as unknown as (req: unknown) => Promise<unknown>;

// ─── Constants ────────────────────────────────────────────────────────────────

const LEAGUE_ID = 'league-alpha';
const SEASON_ID = 'season-1';
const TEAM_ID = 'team-1';
const MANAGER_UID = 'manager1';
const OUTSIDER_UID = 'outsider1';
const ADMIN_UID = 'admin1';
const COACH_UID = 'coach1';

const VALID_OVERRIDE = {
  rank: 2,
  note: 'Adjustment for forfeited game',
  scope: 'display' as const,
};

const VALID_INPUT = {
  leagueId: LEAGUE_ID,
  seasonId: SEASON_ID,
  teamId: TEAM_ID,
  override: VALID_OVERRIDE,
};

function seedBaseFixtures() {
  seedDoc(`users/${ADMIN_UID}`, { role: 'admin' });
  seedDoc(`users/${MANAGER_UID}`, { role: 'league_manager', leagueId: LEAGUE_ID, subscriptionTier: 'league_manager_pro' });
  seedDoc(`users/${OUTSIDER_UID}`, { role: 'league_manager', leagueId: 'other-league', subscriptionTier: 'league_manager_pro' });
  seedDoc(`users/${COACH_UID}`, { role: 'coach' });
  seedDoc(`leagues/${LEAGUE_ID}`, {
    id: LEAGUE_ID,
    name: 'Alpha League',
    managerIds: [MANAGER_UID],
    managedBy: MANAGER_UID,
  });
  // Seed a standings doc so update() doesn't write to a nonexistent doc
  seedDoc(`leagues/${LEAGUE_ID}/seasons/${SEASON_ID}/standings/${TEAM_ID}`, {
    teamId: TEAM_ID,
    wins: 3,
    losses: 1,
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  vi.clearAllMocks();
  seedBaseFixtures();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('overrideStandingRank', () => {

  // ── Auth guards ───────────────────────────────────────────────────────────

  it('(1) rejects unauthenticated callers', async () => {
    await expect(fn(makeRequest(VALID_INPUT, null))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('(2) rejects a coach caller (not admin or league_manager)', async () => {
    await expect(fn(makeRequest(VALID_INPUT, COACH_UID))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  // ── Input validation ─────────────────────────────────────────────────────

  it('(3) rejects missing leagueId', async () => {
    await expect(fn(makeRequest({ ...VALID_INPUT, leagueId: '' }, MANAGER_UID))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('(4) rejects missing seasonId', async () => {
    await expect(fn(makeRequest({ ...VALID_INPUT, seasonId: '' }, MANAGER_UID))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('(5) rejects missing teamId', async () => {
    await expect(fn(makeRequest({ ...VALID_INPUT, teamId: '' }, MANAGER_UID))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('(6) rejects when override.note is empty', async () => {
    await expect(fn(makeRequest(
      { ...VALID_INPUT, override: { ...VALID_OVERRIDE, note: '' } },
      MANAGER_UID
    ))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('(7) rejects when override.rank is zero (not positive)', async () => {
    await expect(fn(makeRequest(
      { ...VALID_INPUT, override: { ...VALID_OVERRIDE, rank: 0 } },
      MANAGER_UID
    ))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('(8) rejects when override.rank is negative', async () => {
    await expect(fn(makeRequest(
      { ...VALID_INPUT, override: { ...VALID_OVERRIDE, rank: -1 } },
      MANAGER_UID
    ))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('(9) rejects when override.scope is not "display" or "seeding"', async () => {
    await expect(fn(makeRequest(
      { ...VALID_INPUT, override: { ...VALID_OVERRIDE, scope: 'invalid' } },
      MANAGER_UID
    ))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  // ── Permission / not-found guards ────────────────────────────────────────

  it('(10) rejects when league does not exist', async () => {
    await expect(fn(makeRequest(
      { ...VALID_INPUT, leagueId: 'no-such-league' },
      MANAGER_UID
    ))).rejects.toMatchObject({ code: 'not-found' });
  });

  it('(11) rejects a league_manager who does not manage this league', async () => {
    await expect(fn(makeRequest(VALID_INPUT, OUTSIDER_UID))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  // ── Happy paths ──────────────────────────────────────────────────────────

  it('(12) writes manualRankOverride to the standings document with caller uid', async () => {
    await fn(makeRequest(VALID_INPUT, MANAGER_UID));

    const standingPath = `leagues/${LEAGUE_ID}/seasons/${SEASON_ID}/standings/${TEAM_ID}`;
    const standingData = _store.get(standingPath) as DocData;
    const override = standingData.manualRankOverride as Record<string, unknown>;

    expect(override).toMatchObject({
      rank: 2,
      note: 'Adjustment for forfeited game',
      scope: 'display',
      overriddenBy: MANAGER_UID,
    });
    expect(typeof override.overriddenAt).toBe('string');
  });

  it('(13) clears manualRankOverride when override is null', async () => {
    // Pre-seed an existing override
    const standingPath = `leagues/${LEAGUE_ID}/seasons/${SEASON_ID}/standings/${TEAM_ID}`;
    seedDoc(standingPath, {
      teamId: TEAM_ID,
      wins: 3,
      losses: 1,
      manualRankOverride: { rank: 1, note: 'Old override', scope: 'display' },
    });

    await fn(makeRequest({ ...VALID_INPUT, override: null }, MANAGER_UID));

    const standingData = _store.get(standingPath) as DocData;
    // The field should have been deleted (our mock applies __delete sentinel)
    expect(standingData.manualRankOverride).toBeUndefined();
  });

  it('(14) returns { status: "ok" }', async () => {
    const result = await fn(makeRequest(VALID_INPUT, MANAGER_UID));
    expect(result).toMatchObject({ status: 'ok' });
  });

  it('(15) admin can override standings for any league', async () => {
    const result = await fn(makeRequest(VALID_INPUT, ADMIN_UID));
    expect(result).toMatchObject({ status: 'ok' });
  });

  it('(16) accepts "seeding" as a valid scope value', async () => {
    const result = await fn(makeRequest(
      { ...VALID_INPUT, override: { ...VALID_OVERRIDE, scope: 'seeding' } },
      MANAGER_UID
    ));
    expect(result).toMatchObject({ status: 'ok' });
  });
});
