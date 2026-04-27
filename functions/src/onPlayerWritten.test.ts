/**
 * onPlayerWritten — unit tests for FW-88
 *
 * Tests cover:
 *   - Player created with teamId → rebuild that team's event recipients
 *   - Player deleted (had teamId) → rebuild that team's event recipients
 *   - Player moved between teams → rebuild both teams
 *   - Player edited without team change → rebuild same team
 *   - Player with no teamId → no-op (no batch writes)
 *
 * Strategy: same mocking pattern as recipient-triggers.test.ts — lightweight
 * mocks of firebase-functions/v2/* and firebase-admin; assert on mockBatch._ops.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Firebase Functions / Admin mocks ─────────────────────────────────────────

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((h: unknown) => h),
  onRequest: vi.fn((h: unknown) => h),
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
  onDocumentWritten: vi.fn((
    _pattern: unknown,
    handler: (e: unknown) => Promise<unknown>,
  ) => handler),
}));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: vi.fn() }));
vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn(() => ({ value: vi.fn(() => '') })),
}));
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn().mockImplementation(() => ({})) }));
vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) })),
}));

// ─── Firestore mock infrastructure ────────────────────────────────────────────

interface DocData { [key: string]: unknown }

const _teams = new Map<string, DocData>();
const _users = new Map<string, DocData>();
const _players = new Map<string, DocData>();

// Events returned by where queries (keyed by teamId for array-contains lookups).
const _eventsByTeam = new Map<
  string,
  Array<{ id: string; data: DocData; ref: { path: string; update: ReturnType<typeof vi.fn> } }>
>();

function makeDocRef(path: string) {
  const updateFn = vi.fn((_data: DocData) => {
    Promise.resolve();
    return Promise.resolve();
  });
  return { path, update: updateFn };
}

type WhereClause = { field: string; op: string; values: unknown[] };

function makeQuery(collectionName: string, store: Map<string, DocData>) {
  const _clauses: WhereClause[] = [];

  const obj = {
    where(field: unknown, op: string, values: unknown) {
      const fieldKey =
        typeof field === 'object' && field !== null && '__id' in field
          ? '__id'
          : (field as string);
      _clauses.push({
        field: fieldKey,
        op,
        values: Array.isArray(values) ? values : [values],
      });
      return obj;
    },
    async get() {
      const docs: Array<{
        id: string;
        data(): DocData;
        ref: ReturnType<typeof makeDocRef>;
      }> = [];

      if (collectionName === 'events') {
        // Find the array-contains clause to get the teamId filter.
        const arrayContainsClause = _clauses.find(c => c.op === 'array-contains');
        if (arrayContainsClause) {
          const teamId = arrayContainsClause.values[0] as string;
          const evList = _eventsByTeam.get(teamId) ?? [];
          for (const ev of evList) {
            docs.push({ id: ev.id, data: () => ev.data, ref: ev.ref });
          }
        }
        return { empty: docs.length === 0, size: docs.length, docs };
      }

      for (const [id, data] of store.entries()) {
        const matches = _clauses.every(({ field, op, values }) => {
          if (field === '__id') {
            return op === 'in' ? (values as string[]).includes(id) : id === values[0];
          }
          const v = (data as Record<string, unknown>)[field];
          return op === 'in' ? (values as unknown[]).includes(v) : v === values[0];
        });
        if (matches) {
          docs.push({ id, data: () => data, ref: makeDocRef(`${collectionName}/${id}`) });
        }
      }
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  };
  return obj;
}

const mockBatch = {
  _ops: [] as Array<{ path: string; data: DocData }>,
  update(ref: { path: string }, data: DocData) {
    this._ops.push({ path: ref.path, data });
    return mockBatch;
  },
  commit: vi.fn().mockResolvedValue(undefined),
  reset() {
    this._ops = [];
    this.commit.mockClear();
  },
};

const mockFirestore = {
  collection(name: string) {
    if (name === 'teams') return makeQuery('teams', _teams);
    if (name === 'users') return makeQuery('users', _users);
    if (name === 'players') return makeQuery('players', _players);
    if (name === 'events') return makeQuery('events', new Map());
    throw new Error(`Unexpected collection: ${name}`);
  },
  batch() { return mockBatch; },
};

vi.mock('firebase-admin', () => {
  const FieldPath = { documentId: () => ({ __id: true }) };
  const firestoreFn = Object.assign(() => mockFirestore, { FieldPath });
  return {
    default: { initializeApp: vi.fn(), firestore: firestoreFn },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
  };
});

// Helper now imports FieldPath directly from firebase-admin/firestore (PR #657 follow-up).
vi.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => ({ __id: true }) },
}));

// Import after mocks are in place.
import { onPlayerWritten } from './index';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makePlayerSnap(id: string, data: DocData | undefined) {
  if (!data) {
    return { exists: false, data: () => undefined };
  }
  return {
    exists: true,
    data: () => data,
    ref: { path: `players/${id}`, update: vi.fn() },
  };
}

function makePlayerWrittenEvent(
  playerId: string,
  before: DocData | undefined,
  after: DocData | undefined,
) {
  return {
    params: { playerId },
    data: {
      before: makePlayerSnap(playerId, before),
      after: makePlayerSnap(playerId, after),
    },
  };
}

beforeEach(() => {
  _teams.clear();
  _users.clear();
  _players.clear();
  _eventsByTeam.clear();
  mockBatch.reset();
});

// ─── onPlayerWritten tests ────────────────────────────────────────────────────

describe('onPlayerWritten', () => {
  it('rebuilds recipients for the team when a player is created', async () => {
    const trigger = onPlayerWritten as unknown as (e: unknown) => Promise<void>;

    _teams.set('team-a', { name: 'Lions', coachIds: [] });
    _players.set('p1', { teamId: 'team-a', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' });

    const evRef = { path: 'events/ev-1', update: vi.fn() };
    _eventsByTeam.set('team-a', [
      { id: 'ev-1', data: { teamIds: ['team-a'], status: 'scheduled', date: '2099-01-01' }, ref: evRef },
    ]);

    const ev = makePlayerWrittenEvent(
      'p1',
      undefined, // create — no before
      { teamId: 'team-a', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' },
    );

    await trigger(ev);

    expect(mockBatch._ops).toHaveLength(1);
    const written = mockBatch._ops[0].data as { recipients: Array<{ email: string }> };
    expect(written.recipients.some(r => r.email === 'alice@example.com')).toBe(true);
    expect(mockBatch.commit).toHaveBeenCalledOnce();
  });

  it('rebuilds recipients for the team when a player is deleted', async () => {
    const trigger = onPlayerWritten as unknown as (e: unknown) => Promise<void>;

    _teams.set('team-b', { name: 'Tigers', coachIds: [] });
    _players.set('p2', { teamId: 'team-b', firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com' });

    const evRef = { path: 'events/ev-2', update: vi.fn() };
    _eventsByTeam.set('team-b', [
      { id: 'ev-2', data: { teamIds: ['team-b'], status: 'scheduled', date: '2099-02-01' }, ref: evRef },
    ]);

    const ev = makePlayerWrittenEvent(
      'p2',
      { teamId: 'team-b', firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com' }, // before
      undefined, // delete — no after
    );

    await trigger(ev);

    expect(mockBatch._ops).toHaveLength(1);
    expect(mockBatch.commit).toHaveBeenCalledOnce();
  });

  it('rebuilds recipients for both teams when a player moves between teams', async () => {
    const trigger = onPlayerWritten as unknown as (e: unknown) => Promise<void>;

    _teams.set('team-src', { name: 'Source', coachIds: [] });
    _teams.set('team-dst', { name: 'Dest', coachIds: [] });

    const evRefSrc = { path: 'events/ev-src', update: vi.fn() };
    const evRefDst = { path: 'events/ev-dst', update: vi.fn() };
    _eventsByTeam.set('team-src', [
      { id: 'ev-src', data: { teamIds: ['team-src'], status: 'scheduled', date: '2099-03-01' }, ref: evRefSrc },
    ]);
    _eventsByTeam.set('team-dst', [
      { id: 'ev-dst', data: { teamIds: ['team-dst'], status: 'scheduled', date: '2099-03-02' }, ref: evRefDst },
    ]);

    const ev = makePlayerWrittenEvent(
      'p3',
      { teamId: 'team-src', firstName: 'Carol', lastName: 'Lee', email: 'carol@example.com' },
      { teamId: 'team-dst', firstName: 'Carol', lastName: 'Lee', email: 'carol@example.com' },
    );

    await trigger(ev);

    // Two events updated — one per team.
    expect(mockBatch._ops).toHaveLength(2);
    expect(mockBatch.commit).toHaveBeenCalledTimes(2);
  });

  it('rebuilds the same team once when a player is edited without changing teams', async () => {
    const trigger = onPlayerWritten as unknown as (e: unknown) => Promise<void>;

    _teams.set('team-c', { name: 'Eagles', coachIds: [] });
    _players.set('p4', { teamId: 'team-c', firstName: 'Dave', lastName: 'K', email: 'dave@example.com' });

    const evRef = { path: 'events/ev-c', update: vi.fn() };
    _eventsByTeam.set('team-c', [
      { id: 'ev-c', data: { teamIds: ['team-c'], status: 'scheduled', date: '2099-04-01' }, ref: evRef },
    ]);

    const ev = makePlayerWrittenEvent(
      'p4',
      { teamId: 'team-c', firstName: 'Dave', lastName: 'K', email: 'dave@example.com' },
      { teamId: 'team-c', firstName: 'Dave', lastName: 'Kim', email: 'dave@example.com' }, // lastName changed
    );

    await trigger(ev);

    // Same teamId in both before/after — Set deduplicates, so only one rebuild.
    expect(mockBatch._ops).toHaveLength(1);
    expect(mockBatch.commit).toHaveBeenCalledOnce();
  });

  it('is a no-op when the player has no teamId set (before or after)', async () => {
    const trigger = onPlayerWritten as unknown as (e: unknown) => Promise<void>;

    // Player doc with no teamId — e.g. an orphaned record.
    const ev = makePlayerWrittenEvent(
      'p5',
      { firstName: 'Eve', lastName: 'X', email: 'eve@example.com' }, // no teamId
      { firstName: 'Eve', lastName: 'XY', email: 'eve@example.com' }, // no teamId
    );

    await trigger(ev);

    expect(mockBatch._ops).toHaveLength(0);
    expect(mockBatch.commit).not.toHaveBeenCalled();
  });

  it('is a no-op when the team has no upcoming scheduled events', async () => {
    const trigger = onPlayerWritten as unknown as (e: unknown) => Promise<void>;

    _teams.set('team-empty', { name: 'Empty', coachIds: [] });
    // _eventsByTeam has no entry for team-empty

    const ev = makePlayerWrittenEvent(
      'p6',
      undefined,
      { teamId: 'team-empty', firstName: 'Frank', email: 'frank@example.com' },
    );

    await trigger(ev);

    expect(mockBatch._ops).toHaveLength(0);
    expect(mockBatch.commit).not.toHaveBeenCalled();
  });
});
