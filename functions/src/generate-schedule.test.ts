/**
 * Tests for the generateSchedule callable Cloud Function.
 *
 * These tests use in-process mocks for firebase-admin and firebase-functions/v2/https
 * so they run without a live Firebase project or emulator.
 *
 * Coverage:
 *   1. Outer catch wraps raw non-HttpsError as failed-precondition with "DEBUG [outer] — " prefix
 *   2. Outer catch re-throws HttpsError unchanged
 *   3. Unauthenticated call → 'unauthenticated'
 *   4. coach role → 'permission-denied'
 *   5. Happy path: authenticated league_manager who owns league → valid ScheduleAlgorithmOutput
 *   6. League document does not exist → 'not-found'
 *   7. League manager who does not own league → 'permission-denied'
 *   8. admin role bypasses ownership check → valid output
 *   9. Inner algorithm error (step 8) → 'failed-precondition' with "DEBUG — " prefix (not outer)
 *  10. SEC-74: LM passing their own division → succeeds
 *  11. SEC-74: LM passing a division from another league → permission-denied
 *  12. SEC-74: Admin passing a division from any league → succeeds (admin bypasses division check)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Firebase Functions mocks ─────────────────────────────────────────────────
// These vi.mock calls are hoisted by vitest to run before any imports.
// Factories that reference outer variables must only reference variables defined
// in source order before the factory (const/let are captured by closure reference).

vi.mock('firebase-functions/v2/https', () => ({
  // onCall supports two call signatures:
  //   onCall(handler)           — 1-arg form
  //   onCall(options, handler)  — 2-arg form (used by generateSchedule)
  // The mock extracts the handler from whichever position it occupies.
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
  createTransport: vi.fn(() => ({})),
}));

// ─── Firestore mock infrastructure ───────────────────────────────────────────
// Defined before vi.mock('firebase-admin') so the factory closure can reference _store and mockDb.

type DocData = Record<string, unknown>;

const _store: Map<string, DocData> = new Map();

class MockDocRef {
  constructor(public path: string) {}

  async get(): Promise<MockDocSnap> {
    const data = _store.get(this.path);
    return new MockDocSnap(this.path, data);
  }

  async set(data: DocData, _opts?: unknown): Promise<void> {
    _store.set(this.path, { ...(_store.get(this.path) ?? {}), ...data });
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

class MockQuery {
  private _filters: Array<{ field: string; op: string; value: unknown }> = [];

  constructor(private _collectionPath: string) {}

  where(field: string, op: string, value: unknown): MockQuery {
    const q = new MockQuery(this._collectionPath);
    q._filters = [...this._filters, { field, op, value }];
    return q;
  }

  limit(_n: number): MockQuery { return this; }

  async get(): Promise<MockQuerySnap> {
    const docs: Array<{ id: string; ref: MockDocRef; data: () => DocData }> = [];
    for (const [path, data] of _store.entries()) {
      if (!path.startsWith(this._collectionPath + '/')) continue;
      const rest = path.slice(this._collectionPath.length + 1);
      if (rest.includes('/')) continue;
      let matches = true;
      for (const f of this._filters) {
        const val = (data as Record<string, unknown>)[f.field];
        if (f.op === '==' && val !== f.value) { matches = false; break; }
      }
      if (matches) {
        docs.push({ id: rest, ref: new MockDocRef(path), data: () => data });
      }
    }
    return new MockQuerySnap(docs);
  }
}

class MockQuerySnap {
  empty: boolean;
  constructor(public docs: Array<{ id: string; ref: MockDocRef; data: () => DocData }>) {
    this.empty = docs.length === 0;
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

/**
 * Transaction mock that supports get/set/update used by checkRateLimit.
 * Resolves FieldValue increment sentinels so the in-memory store stays numeric.
 */
class MockTransaction {
  private _ops: Array<() => void> = [];

  async get(ref: MockDocRef): Promise<MockDocSnap> {
    const data = _store.get(ref.path);
    return new MockDocSnap(ref.path, data);
  }

  set(ref: MockDocRef, data: DocData, _opts?: unknown): void {
    this._ops.push(() => {
      _store.set(ref.path, { ...(_store.get(ref.path) ?? {}), ...data });
    });
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
  runTransaction: async (cb: (tx: MockTransaction) => Promise<void>) => {
    const tx = new MockTransaction();
    await cb(tx);
    await tx.commit();
  },
};

// ─── firebase-admin mock ──────────────────────────────────────────────────────
// FieldValue is inlined here to avoid the TDZ error: vi.mock factories are
// hoisted to the top of the module, so they must not reference const/let
// variables declared later in source order.  mockDb is declared above, so it
// is safe to reference in this factory.

vi.mock('firebase-admin', () => {
  const FieldValue = {
    increment: (n: number) => ({ __increment: n }),
  };
  const firestoreFn = Object.assign(() => mockDb, { FieldValue });
  return {
    default: {
      initializeApp: vi.fn(),
      firestore: firestoreFn,
      auth: vi.fn(() => ({ createUser: vi.fn() })),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => ({ createUser: vi.fn() })),
  };
});

// Import the function under test AFTER all mocks are registered.
import { generateSchedule } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(data: unknown, uid: string | null) {
  return uid ? { auth: { uid }, data } : { auth: null, data };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
}

/**
 * A valid GenerateScheduleInput that will produce an assignable schedule.
 * 2 teams, single round-robin, ample Sat/Sun slots → always feasible.
 */
function baseScheduleInput(leagueId = 'league1') {
  return {
    leagueId,
    leagueName: 'Test League',
    teams: [
      { id: 't1', name: 'Alpha' },
      { id: 't2', name: 'Beta' },
    ],
    venues: [
      {
        id: 'v1',
        name: 'Stadium',
        concurrentPitches: 1,
        availabilityWindows: [
          { dayOfWeek: 6, startTime: '09:00', endTime: '17:00' },
          { dayOfWeek: 0, startTime: '10:00', endTime: '16:00' },
        ],
      },
    ],
    seasonStart: '2026-04-04',
    seasonEnd: '2026-06-30',
    format: 'single_round_robin',
    matchDurationMinutes: 60,
    bufferMinutes: 15,
    minRestDays: 1,
    softConstraintPriority: [],
    homeAwayMode: 'relaxed',
  };
}

// ─── Test setup ───────────────────────────────────────────────────────────────

const fn = generateSchedule as unknown as (req: unknown) => Promise<unknown>;

beforeEach(() => {
  clearStore();
  // League owned by manager1
  seedDoc('leagues/league1', { managedBy: 'manager1', name: 'Test League' });
  // Users
  seedDoc('users/manager1', { role: 'league_manager', leagueId: 'league1', subscriptionTier: 'league_manager_pro' });
  seedDoc('users/admin1',   { role: 'admin' });
  seedDoc('users/coach1',   { role: 'coach' });
});

// ─── generateSchedule tests ───────────────────────────────────────────────────

describe('generateSchedule', () => {

  // ── Minimum blocker cases ──────────────────────────────────────────────────

  it('(1) outer catch wraps a raw Error from steps 1–4 as failed-precondition with "Schedule generation failed: " prefix', async () => {
    // Inject a plain Error during the Firestore read for the league doc (step 4).
    const spy = vi.spyOn(mockDb, 'doc').mockImplementation((path: string) => {
      if (path.startsWith('leagues/')) {
        throw new Error('Simulated SDK failure');
      }
      return new MockDocRef(path);
    });

    try {
      await expect(fn(makeRequest(baseScheduleInput(), 'manager1')))
        .rejects.toMatchObject({
          code: 'failed-precondition',
          message: expect.stringMatching(/^Schedule generation failed: Error: Simulated SDK failure/),
        });
    } finally {
      spy.mockRestore();
    }
  });

  it('(2) outer catch re-throws an HttpsError from steps 1–4 unchanged (not wrapped)', async () => {
    // League not found → HttpsError('not-found') is thrown in step 4.
    // The outer catch must re-throw it as-is, not wrap it.
    _store.delete('leagues/league1');

    await expect(fn(makeRequest(baseScheduleInput(), 'manager1')))
      .rejects.toMatchObject({
        code: 'not-found',
        message: expect.not.stringContaining('DEBUG [outer]'),
      });
  });

  it('(3) unauthenticated call returns unauthenticated error', async () => {
    await expect(fn(makeRequest(baseScheduleInput(), null)))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('(4) coach role returns permission-denied', async () => {
    await expect(fn(makeRequest(baseScheduleInput(), 'coach1')))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  // ── Full callable boundary cases ───────────────────────────────────────────

  it('(5) happy path: league_manager who owns the league returns a valid schedule object', async () => {
    const result = await fn(makeRequest(baseScheduleInput(), 'manager1')) as Record<string, unknown>;

    expect(Array.isArray(result.fixtures)).toBe(true);
    expect(result).toHaveProperty('stats');
    expect(result).toHaveProperty('warnings');
    expect((result.stats as Record<string, unknown>).feasible).toBe(true);
  });

  it('(6) league document does not exist returns not-found', async () => {
    _store.delete('leagues/league1');

    await expect(fn(makeRequest(baseScheduleInput(), 'manager1')))
      .rejects.toMatchObject({ code: 'not-found' });
  });

  it('(7) league manager who does not own the league returns permission-denied', async () => {
    // manager2 has league_manager role but their leagueId points to a different league.
    seedDoc('users/manager2', { role: 'league_manager', leagueId: 'other-league' });

    await expect(fn(makeRequest(baseScheduleInput('league1'), 'manager2')))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('(8) admin role bypasses ownership check and receives a valid schedule', async () => {
    // admin1 has no ownership relationship with league1 — the check is skipped for admin.
    const result = await fn(makeRequest(baseScheduleInput(), 'admin1')) as Record<string, unknown>;

    expect(Array.isArray(result.fixtures)).toBe(true);
    expect((result.stats as Record<string, unknown>).feasible).toBe(true);
  });

  // ── SEC-74: division ownership guard ──────────────────────────────────────

  it('(10) league_manager passing their own division (exists in their league) → succeeds', async () => {
    // Seed the division document under the manager's league.
    seedDoc('leagues/league1/divisions/div1', { name: 'Division A' });

    const input = {
      ...baseScheduleInput('league1'),
      divisions: [{ id: 'div1', name: 'Division A', teamIds: ['t1', 't2'], format: 'single_round_robin' as const }],
    };

    const result = await fn(makeRequest(input, 'manager1')) as Record<string, unknown>;
    expect(Array.isArray(result.fixtures)).toBe(true);
    expect((result.stats as Record<string, unknown>).feasible).toBe(true);
  });

  it('(11) league_manager passing a division from another league → permission-denied', async () => {
    // div-other is seeded under a different league, not league1.
    seedDoc('leagues/other-league/divisions/div-other', { name: 'Foreign Division' });
    // div-other is NOT in leagues/league1/divisions — so the check should fire.

    const input = {
      ...baseScheduleInput('league1'),
      divisions: [{ id: 'div-other', name: 'Foreign Division', teamIds: ['t1', 't2'], format: 'single_round_robin' as const }],
    };

    await expect(fn(makeRequest(input, 'manager1')))
      .rejects.toMatchObject({
        code: 'permission-denied',
        message: expect.stringContaining('do not belong to this league'),
      });
  });

  it('(12) admin passing a division from a different league → succeeds (admin bypasses division check)', async () => {
    // The division only exists under other-league, not under league1 that input references.
    // An admin must be able to operate on any league/division combination without restriction.
    seedDoc('leagues/other-league/divisions/div-other', { name: 'Foreign Division' });

    const input = {
      ...baseScheduleInput('league1'),
      divisions: [{ id: 'div-other', name: 'Foreign Division', teamIds: ['t1', 't2'], format: 'single_round_robin' as const }],
    };

    const result = await fn(makeRequest(input, 'admin1')) as Record<string, unknown>;
    expect(Array.isArray(result.fixtures)).toBe(true);
    expect((result.stats as Record<string, unknown>).feasible).toBe(true);
  });

  it('(9) inner algorithm error (step 8) surfaces as failed-precondition with "DEBUG — " prefix, not "Schedule generation failed: "', async () => {
    // Patch runScheduleAlgorithm to throw a raw TypeError so the inner try/catch (step 8) fires.
    // The inner catch wraps it as HttpsError('failed-precondition', 'DEBUG — TypeError: ...')
    // then re-throws; the outer catch sees an HttpsError and passes it through unchanged.
    const scheduleAlgorithm = await import('./scheduleAlgorithm');
    const spy = vi.spyOn(scheduleAlgorithm, 'runScheduleAlgorithm').mockImplementation(() => {
      throw new TypeError('Unexpected slot shape');
    });

    try {
      await expect(fn(makeRequest(baseScheduleInput(), 'manager1')))
        .rejects.toMatchObject({
          code: 'failed-precondition',
          message: expect.stringMatching(/^DEBUG — TypeError: Unexpected slot shape/),
        });
    } finally {
      spy.mockRestore();
    }
  });
});
