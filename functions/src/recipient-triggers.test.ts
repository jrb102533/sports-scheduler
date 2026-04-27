/**
 * recipient-triggers — unit tests for Phase B (FW-84)
 *
 * Tests cover:
 *   - onEventWrittenRecipients: only fires when teamId fields change; writes
 *     correct recipients; writes empty array when no teamIds.
 *   - onTeamMembershipChanged: only fires when coachIds change or on create;
 *     queries upcoming events correctly; batch-writes recipients.
 *
 * Strategy: extract the logic under test into the pure computeEventRecipients
 * helper (already unit-tested in recipientHelpers.test.ts) and test the
 * trigger decision logic independently using lightweight mocks of the Firestore
 * and Firebase Functions APIs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Firebase Functions / Admin mocks ─────────────────────────────────────────

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((h: unknown) => h),
  onRequest: vi.fn((h: unknown) => h),
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.name = 'HttpsError'; this.code = code; }
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

// Captured update calls so tests can assert on written data.
const updateCalls: Array<{ refPath: string; data: DocData }> = [];

// Per-collection in-memory stores.
const _teams = new Map<string, DocData>();
const _users = new Map<string, DocData>();
const _players = new Map<string, DocData>();

// Events returned by where queries (keyed by teamId for array-contains lookups).
const _eventsByTeam = new Map<string, Array<{ id: string; data: DocData; ref: { path: string; update: ReturnType<typeof vi.fn> } }>>();

function makeDocRef(path: string) {
  const updateFn = vi.fn((data: DocData) => {
    updateCalls.push({ refPath: path, data });
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
        typeof field === 'object' && field !== null && '__id' in field ? '__id' : (field as string);
      _clauses.push({ field: fieldKey, op, values: Array.isArray(values) ? values : [values] });
      return obj;
    },
    async get() {
      const docs: Array<{ id: string; data(): DocData; ref: ReturnType<typeof makeDocRef> }> = [];

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
  reset() { this._ops = []; this.commit.mockClear(); },
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
// Mock the modular import so the test mock's where() impl recognizes the sentinel.
vi.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => ({ __id: true }) },
}));

// Import after mocks
import { onEventWrittenRecipients, onTeamMembershipChanged } from './index';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRef(path: string) {
  return makeDocRef(path);
}

function makeEventSnap(id: string, data: DocData) {
  return {
    exists: true,
    data: () => data,
    ref: makeRef(`events/${id}`),
  };
}

function makeTeamSnap(id: string, data: DocData) {
  return {
    exists: true,
    data: () => data,
    ref: makeRef(`teams/${id}`),
  };
}

function makeEventWrittenEvent(
  eventId: string,
  before: DocData | null,
  after: DocData | null,
) {
  return {
    params: { eventId },
    data: {
      before: before ? makeEventSnap(eventId, before) : { exists: false, data: () => undefined, ref: makeRef(`events/${eventId}`) },
      after: after ? makeEventSnap(eventId, after) : null,
    },
  };
}

function makeTeamWrittenEvent(
  teamId: string,
  before: DocData | null,
  after: DocData | null,
) {
  return {
    params: { teamId },
    data: {
      before: before ? makeTeamSnap(teamId, before) : { exists: false, data: () => undefined },
      after: after ? makeTeamSnap(teamId, after) : null,
    },
  };
}

beforeEach(() => {
  _teams.clear();
  _users.clear();
  _players.clear();
  _eventsByTeam.clear();
  updateCalls.length = 0;
  mockBatch.reset();
});

// ─── onEventWrittenRecipients ─────────────────────────────────────────────────

describe('onEventWrittenRecipients', () => {
  it('skips update when teamIds did not change (idempotency guard)', async () => {
    const trigger = onEventWrittenRecipients as unknown as (e: unknown) => Promise<void>;

    const sameTeamIds = ['team-a'];
    const ev = makeEventWrittenEvent(
      'ev1',
      { teamIds: sameTeamIds, homeTeamId: null, awayTeamId: null },
      { teamIds: sameTeamIds, homeTeamId: null, awayTeamId: null },
    );

    await trigger(ev);

    // No updates should be called — teamIds unchanged.
    expect(updateCalls).toHaveLength(0);
  });

  it('fires on create (before is null) and writes recipients', async () => {
    const trigger = onEventWrittenRecipients as unknown as (e: unknown) => Promise<void>;

    _teams.set('team-a', { name: 'Lions', coachIds: [] });
    _players.set('p1', { teamId: 'team-a', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' });

    const ev = makeEventWrittenEvent(
      'ev1',
      null, // create — no before
      { teamIds: ['team-a'], homeTeamId: null, awayTeamId: null },
    );

    await trigger(ev);

    // Should have called update on the event ref.
    expect(updateCalls).toHaveLength(1);
    const written = updateCalls[0].data as { recipients: Array<{ email: string }> };
    expect(written.recipients.some(r => r.email === 'alice@example.com')).toBe(true);
  });

  it('fires when teamIds change', async () => {
    const trigger = onEventWrittenRecipients as unknown as (e: unknown) => Promise<void>;

    _teams.set('team-b', { name: 'Tigers', coachIds: [] });
    _players.set('p2', { teamId: 'team-b', firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com' });

    const ev = makeEventWrittenEvent(
      'ev2',
      { teamIds: ['team-a'], homeTeamId: null, awayTeamId: null },
      { teamIds: ['team-b'], homeTeamId: null, awayTeamId: null },
    );

    await trigger(ev);

    expect(updateCalls).toHaveLength(1);
    const written = updateCalls[0].data as { recipients: Array<{ email: string }> };
    expect(written.recipients.some(r => r.email === 'bob@example.com')).toBe(true);
  });

  it('writes empty recipients array when no teamIds', async () => {
    const trigger = onEventWrittenRecipients as unknown as (e: unknown) => Promise<void>;

    const ev = makeEventWrittenEvent(
      'ev3',
      null, // create
      { teamIds: [], homeTeamId: null, awayTeamId: null },
    );

    await trigger(ev);

    expect(updateCalls).toHaveLength(1);
    const written = updateCalls[0].data as { recipients: unknown[] };
    expect(written.recipients).toEqual([]);
  });

  it('returns early when after is null (delete event)', async () => {
    const trigger = onEventWrittenRecipients as unknown as (e: unknown) => Promise<void>;

    const ev = {
      params: { eventId: 'ev4' },
      data: {
        before: makeEventSnap('ev4', { teamIds: ['team-a'] }),
        after: null,
      },
    };

    await trigger(ev);
    expect(updateCalls).toHaveLength(0);
  });
});

// ─── onTeamMembershipChanged ──────────────────────────────────────────────────

describe('onTeamMembershipChanged', () => {
  it('skips rebuild when coachIds unchanged and not a create', async () => {
    const trigger = onTeamMembershipChanged as unknown as (e: unknown) => Promise<void>;

    const ev = makeTeamWrittenEvent(
      'team-a',
      { name: 'Lions', coachIds: ['uid-coach'] },
      { name: 'Lions Updated Name', coachIds: ['uid-coach'] }, // name changed but not coachIds
    );

    await trigger(ev);

    // No Firestore writes expected (no events queried).
    expect(mockBatch._ops).toHaveLength(0);
  });

  it('rebuilds when coachIds change', async () => {
    const trigger = onTeamMembershipChanged as unknown as (e: unknown) => Promise<void>;

    _users.set('uid-new-coach', { displayName: 'New Coach', email: 'newcoach@example.com' });

    const evRef = makeRef('events/ev-a');
    const evUpdateSpy = vi.spyOn(evRef, 'update');

    _eventsByTeam.set('team-a', [
      { id: 'ev-a', data: { teamIds: ['team-a'], status: 'scheduled', date: '2099-01-01' }, ref: evRef },
    ]);
    _teams.set('team-a', { name: 'Lions', coachIds: ['uid-new-coach'] });

    const ev = makeTeamWrittenEvent(
      'team-a',
      { name: 'Lions', coachIds: ['uid-old-coach'] },
      { name: 'Lions', coachIds: ['uid-new-coach'] },
    );

    await trigger(ev);

    // Batch should have one update for the event.
    expect(mockBatch._ops).toHaveLength(1);
    expect(mockBatch.commit).toHaveBeenCalledOnce();
    void evUpdateSpy; // referenced to satisfy linter
  });

  it('fires on team create (no before) and rebuilds', async () => {
    const trigger = onTeamMembershipChanged as unknown as (e: unknown) => Promise<void>;

    _users.set('uid-coach', { displayName: 'Coach', email: 'coach@example.com' });
    _teams.set('team-new', { name: 'New Team', coachIds: ['uid-coach'] });
    _players.set('p-new', { teamId: 'team-new', firstName: 'X', lastName: 'Y', email: 'xy@example.com' });

    const evRef = makeRef('events/ev-new');
    _eventsByTeam.set('team-new', [
      { id: 'ev-new', data: { teamIds: ['team-new'], status: 'scheduled', date: '2099-02-01' }, ref: evRef },
    ]);

    const ev = makeTeamWrittenEvent(
      'team-new',
      null, // create
      { name: 'New Team', coachIds: ['uid-coach'] },
    );

    await trigger(ev);

    expect(mockBatch._ops).toHaveLength(1);
    const written = mockBatch._ops[0].data as { recipients: Array<{ email: string }> };
    expect(written.recipients.some(r => r.email === 'coach@example.com')).toBe(true);
    expect(written.recipients.some(r => r.email === 'xy@example.com')).toBe(true);
  });

  it('returns early when after is null (deleted team)', async () => {
    const trigger = onTeamMembershipChanged as unknown as (e: unknown) => Promise<void>;

    const ev = {
      params: { teamId: 'team-gone' },
      data: {
        before: makeTeamSnap('team-gone', { name: 'Gone', coachIds: [] }),
        after: null,
      },
    };

    await trigger(ev);
    expect(mockBatch._ops).toHaveLength(0);
  });

  it('no-ops when no upcoming events for the team', async () => {
    const trigger = onTeamMembershipChanged as unknown as (e: unknown) => Promise<void>;

    // _eventsByTeam empty for team-empty
    const ev = makeTeamWrittenEvent(
      'team-empty',
      { name: 'Old', coachIds: ['uid-a'] },
      { name: 'New', coachIds: ['uid-b'] }, // changed
    );

    await trigger(ev);

    // No batch writes — no events found.
    expect(mockBatch._ops).toHaveLength(0);
    expect(mockBatch.commit).not.toHaveBeenCalled();
  });
});
