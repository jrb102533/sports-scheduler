/**
 * onEventWrittenRecipients — unit tests (GH-684)
 *
 * Covers the FieldPath.documentId() crash reported in issue #684 where
 * admin.firestore.FieldPath was undefined in the emulator context. The fix
 * imports FieldPath directly from firebase-admin/firestore. These tests drive
 * the trigger and verify both the happy path and previously-crashing paths.
 *
 * Covers:
 *  1. Returns early when the event doc is deleted (no after data)
 *  2. Returns early when teamIds did not change between before and after
 *  3. Writes recipients: [] when teamIds is empty — does NOT call FieldPath.documentId()
 *  4. Happy path: computes and writes recipients when teamIds is non-empty
 *     (exercises the FieldPath.documentId() batch-read path that was crashing)
 *  5. No crash when teamIds field is absent from the document
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
interface FakeDoc { id: string; data(): DocData }

const _teams = new Map<string, DocData>();
const _users = new Map<string, DocData>();
const _players = new Map<string, DocData>();

// Track updates written by the trigger
interface DocUpdate { path: string; data: DocData }
const _refUpdates: DocUpdate[] = [];

// Recorded FieldPath.documentId() call count — the bug was calling into
// admin.firestore.FieldPath (undefined in emulator). We verify no throw.
let _documentIdCallCount = 0;

const FieldValueDelete = Symbol('FieldValue.delete');

/** Minimal query builder matching what the trigger uses. */
function makeQuery(collectionName: string) {
  return {
    where(fieldPath: unknown, op: string, values: unknown) {
      const isDocId =
        typeof fieldPath === 'object' &&
        fieldPath !== null &&
        '__id' in (fieldPath as object);
      if (isDocId) _documentIdCallCount++;

      const valueList = Array.isArray(values) ? (values as string[]) : [values as string];

      const queryResult = {
        limit(_n: number) { return queryResult; }, // no-op: mock returns all matching docs
        async get() {
          const store =
            collectionName === 'teams' ? _teams :
            collectionName === 'users' ? _users :
            _players;
          const docs: FakeDoc[] = [];
          if (isDocId) {
            for (const id of valueList) {
              if (store.has(id)) docs.push({ id, data: () => store.get(id)! });
            }
          } else {
            // Support array-contains and == and 'in' for non-id queries
            for (const [id, data] of store.entries()) {
              const v = (data as Record<string, unknown>)[fieldPath as string];
              if (op === 'in' && Array.isArray(v)) {
                if (valueList.some(val => (v as string[]).includes(val))) {
                  docs.push({ id, data: () => data });
                }
              } else if (op === 'in' && valueList.includes(v as string)) {
                docs.push({ id, data: () => data });
              } else if (op === '==' && v === valueList[0]) {
                docs.push({ id, data: () => data });
              } else if (op === 'array-contains' && Array.isArray(v)) {
                if ((v as string[]).includes(valueList[0])) {
                  docs.push({ id, data: () => data });
                }
              } else if (op === '>=' && typeof v === 'string' && v >= valueList[0]) {
                docs.push({ id, data: () => data });
              }
            }
          }
          return { docs, empty: docs.length === 0, size: docs.length };
        },
      };
      return queryResult;
    },
  };
}

const mockBatch = {
  update: vi.fn(),
  commit: vi.fn().mockResolvedValue(undefined),
  reset() {
    this.update.mockClear();
    this.commit.mockClear();
  },
};

const mockFirestore = {
  collection: (name: string) => makeQuery(name),
  doc: (path: string) => ({
    path,
    async get() { return { exists: false, data: () => undefined }; },
    async update(data: DocData) { _refUpdates.push({ path, data }); },
    async set() {},
  }),
  batch: () => mockBatch,
};

vi.mock('firebase-admin', () => {
  const FieldPath = { documentId: () => ({ __id: true }) };
  const FieldValue = { delete: () => FieldValueDelete, arrayUnion: vi.fn(), arrayRemove: vi.fn(), serverTimestamp: vi.fn(), increment: vi.fn() };
  const firestoreFn = Object.assign(() => mockFirestore, { FieldPath, FieldValue });
  return {
    default: { initializeApp: vi.fn(), firestore: firestoreFn },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
  };
});

vi.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => ({ __id: true }) },
  FieldValue: { delete: () => FieldValueDelete, arrayUnion: vi.fn(), arrayRemove: vi.fn(), serverTimestamp: vi.fn(), increment: vi.fn() },
}));

// ─── Import trigger after mocks ───────────────────────────────────────────────

import { onEventWrittenRecipients } from './index';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Trigger = (e: unknown) => Promise<void>;
const trigger = onEventWrittenRecipients as unknown as Trigger;

/** Minimal Firestore snapshot ref — tracks update() calls per document. */
function makeRef(eventId: string) {
  return {
    path: `events/${eventId}`,
    async update(data: DocData) {
      _refUpdates.push({ path: `events/${eventId}`, data });
    },
  };
}

function makeSnap(data: DocData | undefined, eventId = 'ev1') {
  if (!data) return { exists: false, data: () => undefined, ref: makeRef(eventId) };
  return { exists: true, data: () => data, ref: makeRef(eventId) };
}

function makeEventWrittenEvent(
  eventId: string,
  before: DocData | undefined,
  after: DocData | undefined,
) {
  return {
    params: { eventId },
    data: {
      before: makeSnap(before, eventId),
      after: makeSnap(after, eventId),
    },
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _teams.clear();
  _users.clear();
  _players.clear();
  _refUpdates.length = 0;
  _documentIdCallCount = 0;
  mockBatch.reset();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('onEventWrittenRecipients — GH-684 FieldPath.documentId() guard', () => {

  it('returns early and makes no writes when the event document is deleted', async () => {
    await trigger(makeEventWrittenEvent('ev1', { teamIds: ['t1'] }, undefined));

    expect(_refUpdates).toHaveLength(0);
    expect(_documentIdCallCount).toBe(0);
  });

  it('returns early and makes no writes when teamIds did not change', async () => {
    await trigger(makeEventWrittenEvent(
      'ev1',
      { teamIds: ['t1'], homeTeamId: undefined, awayTeamId: undefined },
      { teamIds: ['t1'], homeTeamId: undefined, awayTeamId: undefined },
    ));

    expect(_refUpdates).toHaveLength(0);
    expect(_documentIdCallCount).toBe(0);
  });

  it('writes recipients: [] and does not call FieldPath.documentId() when teamIds is empty', async () => {
    await trigger(makeEventWrittenEvent(
      'ev1',
      undefined, // create
      { teamIds: [] },
    ));

    expect(_refUpdates).toHaveLength(1);
    expect(_refUpdates[0].data).toEqual({ recipients: [] });
    // Empty teamIds exits before the batch-read loop — FieldPath never called.
    expect(_documentIdCallCount).toBe(0);
  });

  it('writes recipients without throwing when teamIds is absent from the document', async () => {
    // Absence of teamIds is equivalent to empty — the trigger coerces undefined to [].
    await expect(
      trigger(makeEventWrittenEvent('ev1', undefined, { status: 'scheduled' })),
    ).resolves.not.toThrow();

    // Should write empty recipients (same code path as empty teamIds).
    expect(_refUpdates).toHaveLength(1);
    expect(_refUpdates[0].data).toEqual({ recipients: [] });
  });

  it('happy path — calls FieldPath.documentId() without throwing when teamIds is non-empty', async () => {
    // Seed a team so the query returns something
    _teams.set('t1', { name: 'Lions', coachIds: ['coach-1'] });
    _users.set('coach-1', { displayName: 'Alice Smith', email: 'alice@example.com' });

    // This exercises the FieldPath.documentId() batch-read loop that was crashing.
    await expect(
      trigger(makeEventWrittenEvent(
        'ev1',
        undefined, // create → teamIdsChanged = true
        { teamIds: ['t1'] },
      )),
    ).resolves.not.toThrow();

    // FieldPath.documentId() must have been called (teams batch-read) —
    // verifies the imported FieldPath was reachable, not undefined.
    expect(_documentIdCallCount).toBeGreaterThanOrEqual(1);

    // Trigger wrote recipients onto the event doc.
    expect(_refUpdates).toHaveLength(1);
    expect(_refUpdates[0].path).toBe('events/ev1');
    expect(Array.isArray(_refUpdates[0].data.recipients)).toBe(true);
  });

  it('happy path — writes updated recipients when teamIds changes between before and after', async () => {
    _teams.set('t2', { name: 'Tigers', coachIds: [] });

    await expect(
      trigger(makeEventWrittenEvent(
        'ev1',
        { teamIds: ['t1'] }, // before
        { teamIds: ['t2'] }, // after — changed
      )),
    ).resolves.not.toThrow();

    expect(_refUpdates).toHaveLength(1);
    expect(_refUpdates[0].path).toBe('events/ev1');
  });

  it('path B — registered parent user with matching membership is included in recipients', async () => {
    // Seed team with no coaches or path-A parent contacts
    _teams.set('t1', { name: 'Lions', coachIds: [] });
    // Seed a registered parent user in the users collection (path B identity)
    _users.set('uid-parent', {
      role: 'parent',
      displayName: 'Registered Parent',
      email: 'registered-parent@example.com',
      memberships: [{ role: 'parent', teamId: 't1' }],
    });

    await expect(
      trigger(makeEventWrittenEvent('ev1', undefined, { teamIds: ['t1'] })),
    ).resolves.not.toThrow();

    expect(_refUpdates).toHaveLength(1);
    const written = _refUpdates[0].data as { recipients: Array<{ email: string; type: string }> };
    const parentEntry = written.recipients.find(r => r.email === 'registered-parent@example.com');
    expect(parentEntry).toBeDefined();
    expect(parentEntry?.type).toBe('parent');
  });

  it('path B — parent user membership for a different team is excluded', async () => {
    _teams.set('t1', { name: 'Lions', coachIds: [] });
    _users.set('uid-parent', {
      role: 'parent',
      displayName: 'Other Team Parent',
      email: 'other-team@example.com',
      memberships: [{ role: 'parent', teamId: 'team-other' }],
    });

    await expect(
      trigger(makeEventWrittenEvent('ev1', undefined, { teamIds: ['t1'] })),
    ).resolves.not.toThrow();

    expect(_refUpdates).toHaveLength(1);
    const written = _refUpdates[0].data as { recipients: Array<{ email: string }> };
    expect(written.recipients.find(r => r.email === 'other-team@example.com')).toBeUndefined();
  });
});
