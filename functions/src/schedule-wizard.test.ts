/**
 * Tests for submitGameResult and publishSchedule Cloud Functions.
 *
 * These tests use in-process mocks for firebase-admin and firebase-functions/v2/https
 * so they run without a live Firebase project or emulator.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Firebase Functions mocks ─────────────────────────────────────────────────

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((handler: (req: unknown) => unknown) => handler),
  onRequest: vi.fn((handler: unknown) => handler),
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
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

/**
 * A minimal in-memory Firestore stub that supports the operations used by
 * submitGameResult and publishSchedule.
 */

type DocData = Record<string, unknown>;

const _store: Map<string, DocData> = new Map();

class MockDocRef {
  constructor(public path: string) {}

  async get(): Promise<MockDocSnap> {
    const data = _store.get(this.path);
    return new MockDocSnap(this.path, data);
  }

  async set(data: DocData, _opts?: unknown): Promise<void> {
    _store.set(this.path, { ...((_store.get(this.path)) ?? {}), ...data });
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
  constructor(public path: string, private _data: DocData | undefined) {
    this.exists = _data !== undefined;
  }
  data(): DocData | undefined { return this._data; }
}

class MockQuery {
  private _filters: Array<{ field: string; op: string; value: unknown }> = [];
  private _collectionPath: string;

  constructor(collectionPath: string) {
    this._collectionPath = collectionPath;
  }

  where(field: string, op: string, value: unknown): MockQuery {
    const q = new MockQuery(this._collectionPath);
    q._filters = [...this._filters, { field, op, value }];
    return q;
  }

  async get(): Promise<MockQuerySnap> {
    const docs: Array<{ id: string; ref: MockDocRef; data: () => DocData }> = [];
    for (const [path, data] of _store.entries()) {
      if (!path.startsWith(this._collectionPath + '/')) continue;
      // Only direct children (no sub-documents)
      const rest = path.slice(this._collectionPath.length + 1);
      if (rest.includes('/')) continue;

      let matches = true;
      for (const f of this._filters) {
        const val = (data as Record<string, unknown>)[f.field];
        if (f.op === '==' && val !== f.value) { matches = false; break; }
      }
      if (matches) {
        const id = rest;
        docs.push({ id, ref: new MockDocRef(path), data: () => data });
      }
    }
    return new MockQuerySnap(docs);
  }
}

class MockQuerySnap {
  docs: Array<{ id: string; ref: MockDocRef; data: () => DocData }>;
  empty: boolean;
  constructor(docs: Array<{ id: string; ref: MockDocRef; data: () => DocData }>) {
    this.docs = docs;
    this.empty = docs.length === 0;
  }
}

class MockBatch {
  private _ops: Array<() => void> = [];

  set(ref: MockDocRef, data: DocData, opts?: unknown): void {
    this._ops.push(() => {
      const existing = opts && (opts as Record<string, unknown>).merge ? (_store.get(ref.path) ?? {}) : {};
      _store.set(ref.path, { ...existing, ...data });
    });
  }

  update(ref: MockDocRef, data: DocData): void {
    this._ops.push(() => {
      const existing = _store.get(ref.path) ?? {};
      _store.set(ref.path, { ...existing, ...data });
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
    this._ops.push(() => {
      _store.set(ref.path, { ...data });
    });
  }

  update(ref: MockDocRef, data: DocData): void {
    this._ops.push(() => {
      const existing = _store.get(ref.path) ?? {};
      _store.set(ref.path, { ...existing, ...data });
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

vi.mock('firebase-admin', () => ({
  default: {
    initializeApp: vi.fn(),
    firestore: vi.fn(() => mockDb),
    auth: vi.fn(() => ({ createUser: vi.fn() })),
  },
  // also handle named imports
  initializeApp: vi.fn(),
  firestore: vi.fn(() => mockDb),
  auth: vi.fn(() => ({ createUser: vi.fn() })),
}));

// Import functions under test AFTER mocks are set up
import { submitGameResult, publishSchedule } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(data: unknown, uid: string) {
  return { auth: { uid }, data };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
}

// ─── submitGameResult tests ───────────────────────────────────────────────────

describe('submitGameResult', () => {
  const fn = submitGameResult as unknown as (req: unknown) => Promise<{ status: string }>;

  beforeEach(() => {
    clearStore();
    // Default game event — completed, with home and away teams
    seedDoc('events/event1', {
      type: 'game',
      status: 'completed',
      leagueId: 'league1',
      homeTeamId: 'teamHome',
      awayTeamId: 'teamAway',
    });
    // Home team — coach uid is "coach-home"
    seedDoc('teams/teamHome', { coachId: 'coach-home', createdBy: 'creator-home' });
    // Away team — coach uid is "coach-away"
    seedDoc('teams/teamAway', { coachId: 'coach-away', createdBy: 'creator-away' });
    // User doc for home coach (needed by assertAdminOrCoach indirectly)
    seedDoc('users/coach-home', { role: 'coach' });
    seedDoc('users/coach-away', { role: 'coach' });
  });

  it('(a) saves first submission as pending', async () => {
    const result = await fn(makeRequest(
      { eventId: 'event1', leagueId: 'league1', homeScore: 2, awayScore: 1 },
      'coach-home',
    ));

    expect(result.status).toBe('pending');
    const pending = _store.get('leagues/league1/pendingResults/event1');
    expect(pending).toBeDefined();
    expect(pending?.homeScore).toBe(2);
    expect(pending?.awayScore).toBe(1);
    expect(pending?.side).toBe('home');
  });

  it('(b) matching second submission auto-confirms and removes pending', async () => {
    // Seed an existing pending result from the away coach
    seedDoc('leagues/league1/pendingResults/event1', {
      homeScore: 2,
      awayScore: 1,
      submittedBy: 'coach-away',
      submittedAt: '2026-03-29T10:00:00.000Z',
      side: 'away',
      eventId: 'event1',
      leagueId: 'league1',
      createdAt: '2026-03-29T10:00:00.000Z',
      updatedAt: '2026-03-29T10:00:00.000Z',
    });

    const result = await fn(makeRequest(
      { eventId: 'event1', leagueId: 'league1', homeScore: 2, awayScore: 1 },
      'coach-home',
    ));

    expect(result.status).toBe('confirmed');
    // Pending record removed
    expect(_store.has('leagues/league1/pendingResults/event1')).toBe(false);
    // Event updated with confirmed result
    const ev = _store.get('events/event1');
    expect((ev?.result as Record<string, unknown>)?.homeScore).toBe(2);
    expect((ev?.result as Record<string, unknown>)?.awayScore).toBe(1);
  });

  it('(c) mismatching second submission creates a dispute', async () => {
    // Seed an existing pending result from the away coach with different scores
    seedDoc('leagues/league1/pendingResults/event1', {
      homeScore: 3,
      awayScore: 0,
      submittedBy: 'coach-away',
      submittedAt: '2026-03-29T10:00:00.000Z',
      side: 'away',
      eventId: 'event1',
      leagueId: 'league1',
      createdAt: '2026-03-29T10:00:00.000Z',
      updatedAt: '2026-03-29T10:00:00.000Z',
    });

    const result = await fn(makeRequest(
      { eventId: 'event1', leagueId: 'league1', homeScore: 2, awayScore: 1 },
      'coach-home',
    ));

    expect(result.status).toBe('dispute');
    // Dispute created
    const dispute = _store.get('leagues/league1/resultDisputes/event1');
    expect(dispute).toBeDefined();
    expect((dispute?.firstSubmission as Record<string, unknown>)?.homeScore).toBe(3);
    expect((dispute?.secondSubmission as Record<string, unknown>)?.homeScore).toBe(2);
    expect(dispute?.status).toBe('open');
    // Pending record removed
    expect(_store.has('leagues/league1/pendingResults/event1')).toBe(false);
  });

  it('throws unauthenticated when no auth', async () => {
    await expect(fn({ auth: null, data: { eventId: 'e1', leagueId: 'l1', homeScore: 0, awayScore: 0 } }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('throws not-found for missing event', async () => {
    await expect(fn(makeRequest(
      { eventId: 'nonexistent', leagueId: 'league1', homeScore: 1, awayScore: 0 },
      'coach-home',
    ))).rejects.toMatchObject({ code: 'not-found' });
  });

  it('throws permission-denied when caller is not a coach of either team', async () => {
    await expect(fn(makeRequest(
      { eventId: 'event1', leagueId: 'league1', homeScore: 1, awayScore: 0 },
      'random-user',
    ))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('throws failed-precondition when event is not completed or in_progress', async () => {
    seedDoc('events/event1', {
      type: 'game',
      status: 'scheduled',
      leagueId: 'league1',
      homeTeamId: 'teamHome',
      awayTeamId: 'teamAway',
    });
    await expect(fn(makeRequest(
      { eventId: 'event1', leagueId: 'league1', homeScore: 1, awayScore: 0 },
      'coach-home',
    ))).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

// ─── publishSchedule tests ────────────────────────────────────────────────────

describe('publishSchedule', () => {
  const fn = publishSchedule as unknown as (req: unknown) => Promise<{ publishedCount: number }>;

  beforeEach(() => {
    clearStore();
    // A league managed by "manager1"
    seedDoc('leagues/league1', { managedBy: 'manager1', name: 'Test League' });
    // User doc — league_manager role
    seedDoc('users/manager1', { role: 'league_manager', leagueId: 'league1' });
    // Season
    seedDoc('leagues/league1/seasons/season1', { status: 'setup', name: 'Spring 2026' });
    // Division
    seedDoc('leagues/league1/divisions/div1', { seasonId: 'season1', scheduleStatus: 'draft' });
    // Three draft events in this season + division
    seedDoc('events/e1', { type: 'game', status: 'draft', leagueId: 'league1', seasonId: 'season1', divisionId: 'div1' });
    seedDoc('events/e2', { type: 'game', status: 'draft', leagueId: 'league1', seasonId: 'season1', divisionId: 'div1' });
    seedDoc('events/e3', { type: 'game', status: 'draft', leagueId: 'league1', seasonId: 'season1', divisionId: 'div1' });
  });

  it('batch-updates draft events to scheduled and returns count', async () => {
    const result = await fn(makeRequest(
      { leagueId: 'league1', seasonId: 'season1', divisionId: 'div1' },
      'manager1',
    ));

    expect(result.publishedCount).toBe(3);
    expect((_store.get('events/e1') as Record<string, unknown>)?.status).toBe('scheduled');
    expect((_store.get('events/e2') as Record<string, unknown>)?.status).toBe('scheduled');
    expect((_store.get('events/e3') as Record<string, unknown>)?.status).toBe('scheduled');
  });

  it('updates division scheduleStatus to published', async () => {
    await fn(makeRequest(
      { leagueId: 'league1', seasonId: 'season1', divisionId: 'div1' },
      'manager1',
    ));

    const div = _store.get('leagues/league1/divisions/div1') as Record<string, unknown>;
    expect(div?.scheduleStatus).toBe('published');
  });

  it('activates season when all divisions are published', async () => {
    await fn(makeRequest(
      { leagueId: 'league1', seasonId: 'season1', divisionId: 'div1' },
      'manager1',
    ));

    const season = _store.get('leagues/league1/seasons/season1') as Record<string, unknown>;
    expect(season?.status).toBe('active');
  });

  it('returns 0 when no draft events exist', async () => {
    // Override events to not be draft
    _store.set('events/e1', { type: 'game', status: 'scheduled', leagueId: 'league1', seasonId: 'season1', divisionId: 'div1' });
    _store.set('events/e2', { type: 'game', status: 'scheduled', leagueId: 'league1', seasonId: 'season1', divisionId: 'div1' });
    _store.set('events/e3', { type: 'game', status: 'scheduled', leagueId: 'league1', seasonId: 'season1', divisionId: 'div1' });

    const result = await fn(makeRequest(
      { leagueId: 'league1', seasonId: 'season1', divisionId: 'div1' },
      'manager1',
    ));

    expect(result.publishedCount).toBe(0);
  });

  it('throws unauthenticated when no auth', async () => {
    await expect(fn({ auth: null, data: { leagueId: 'league1', seasonId: 'season1' } }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('throws not-found when league does not exist', async () => {
    await expect(fn(makeRequest(
      { leagueId: 'nonexistent', seasonId: 'season1' },
      'manager1',
    ))).rejects.toMatchObject({ code: 'not-found' });
  });

  it('throws permission-denied when caller is not this league manager', async () => {
    seedDoc('users/other-manager', { role: 'league_manager', leagueId: 'other-league' });
    await expect(fn(makeRequest(
      { leagueId: 'league1', seasonId: 'season1' },
      'other-manager',
    ))).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
