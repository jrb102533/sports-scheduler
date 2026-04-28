/**
 * refreshTeamCoachesDenorm — unit tests (FW-109)
 *
 * refreshTeamCoachesDenorm is a private helper inside index.ts, invoked by the
 * onTeamMembershipChanged trigger whenever coachIds changes. Tests drive the
 * public trigger with crafted before/after snapshots and assert the Firestore
 * writes produced by the denorm helper.
 *
 * Covers:
 *  1. Extracts coachIds from team memberships and writes a coaches map
 *  2. Includes both `name` and `email` fields when user has an email
 *  3. Falls back to email as name when displayName is absent
 *  4. Falls back to uid as name when both displayName and email are absent
 *  5. Skips user docs that don't exist (missing coach profile)
 *  6. Writes coaches: FieldValue.delete() when coachIds is empty
 *  7. Handles empty memberships (no coachIds on team) without crashing
 *  8. Idempotent: re-running with the same input writes the same output
 *  9. Does not call refreshTeamCoachesDenorm when coachIds did not change
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

// In-memory stores
const _users = new Map<string, DocData>();

// Track writes made by refreshTeamCoachesDenorm
interface DocWrite {
  path: string;
  data: DocData;
  options?: DocData;
}
interface DocUpdate {
  path: string;
  data: DocData;
}

const _docSets: DocWrite[] = [];
const _docUpdates: DocUpdate[] = [];

/**
 * Minimal doc reference factory. Supports .get(), .set(), and .update() — the
 * three methods called by refreshTeamCoachesDenorm.
 */
function makeDocRef(path: string) {
  return {
    path,
    async get() {
      // Resolve users/<uid> lookups; everything else returns not-found
      const parts = path.split('/');
      if (parts[0] === 'users') {
        const uid = parts[1];
        const data = _users.get(uid);
        if (data) return { exists: true, data: () => data };
      }
      return { exists: false, data: () => undefined };
    },
    async set(data: DocData, options?: DocData) {
      _docSets.push({ path, data, options });
    },
    async update(data: DocData) {
      _docUpdates.push({ path, data });
    },
  };
}

// Query builder used by rebuildRecipientsForTeam (called before the denorm
// helper). We need at minimum teams/events/players/users collections.
function makeQuery(_collectionName: string) {
  return {
    where() { return this; },
    async get() {
      // Return empty for everything — these tests focus on the denorm helper,
      // not on the recipient rebuild.
      return { empty: true, size: 0, docs: [] };
    },
  };
}

const mockBatch = {
  _ops: [] as Array<{ path: string; data: DocData }>,
  update(_ref: { path: string }, _data: DocData) { return mockBatch; },
  async commit() {},
  reset() { this._ops = []; },
};

const FieldValueDelete = Symbol('FieldValue.delete');

const mockFirestore = {
  doc(path: string) { return makeDocRef(path); },
  collection(name: string) { return makeQuery(name); },
  batch() { return mockBatch; },
};

vi.mock('firebase-admin', () => {
  const FieldPath = { documentId: () => ({ __id: true }) };
  const FieldValue = { delete: () => FieldValueDelete, arrayUnion: vi.fn() };
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

import { onTeamMembershipChanged } from './index';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Trigger = (e: unknown) => Promise<void>;
const trigger = onTeamMembershipChanged as unknown as Trigger;

function makeTeamSnap(data: DocData | undefined) {
  if (!data) return { exists: false, data: () => undefined };
  return { exists: true, data: () => data };
}

/**
 * Build a synthetic onDocumentWritten event for a teams/{teamId} document.
 * Pass `before: undefined` to simulate a create event.
 */
function makeTeamWrittenEvent(teamId: string, before: DocData | undefined, after: DocData) {
  return {
    params: { teamId },
    data: {
      before: makeTeamSnap(before),
      after: makeTeamSnap(after),
    },
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _users.clear();
  _docSets.length = 0;
  _docUpdates.length = 0;
  mockBatch.reset();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('refreshTeamCoachesDenorm (via onTeamMembershipChanged) — FW-109', () => {

  it('writes a coaches map with name and email for each coach uid', async () => {
    _users.set('coach-1', { displayName: 'Alice Smith', email: 'alice@example.com' });
    _users.set('coach-2', { displayName: 'Bob Jones', email: 'bob@example.com' });

    await trigger(makeTeamWrittenEvent(
      'team-lions',
      undefined, // create — coachIds always "changed"
      { name: 'Lions', coachIds: ['coach-1', 'coach-2'] },
    ));

    const teamSet = _docSets.find(w => w.path === 'teams/team-lions');
    expect(teamSet).toBeDefined();
    const coaches = teamSet!.data.coaches as Record<string, { name: string; email?: string }>;
    expect(coaches['coach-1']).toEqual({ name: 'Alice Smith', email: 'alice@example.com' });
    expect(coaches['coach-2']).toEqual({ name: 'Bob Jones', email: 'bob@example.com' });
  });

  it('falls back to email as name when displayName is absent', async () => {
    _users.set('coach-1', { email: 'noname@example.com' });

    await trigger(makeTeamWrittenEvent(
      'team-lions',
      undefined,
      { name: 'Lions', coachIds: ['coach-1'] },
    ));

    const teamSet = _docSets.find(w => w.path === 'teams/team-lions');
    const coaches = teamSet!.data.coaches as Record<string, { name: string; email?: string }>;
    expect(coaches['coach-1'].name).toBe('noname@example.com');
  });

  it('falls back to uid as name when both displayName and email are absent', async () => {
    _users.set('coach-1', {}); // no displayName, no email

    await trigger(makeTeamWrittenEvent(
      'team-lions',
      undefined,
      { name: 'Lions', coachIds: ['coach-1'] },
    ));

    const teamSet = _docSets.find(w => w.path === 'teams/team-lions');
    const coaches = teamSet!.data.coaches as Record<string, { name: string; email?: string }>;
    expect(coaches['coach-1'].name).toBe('coach-1');
  });

  it('omits email field from the entry when the user has no email', async () => {
    _users.set('coach-1', { displayName: 'NoEmail Coach' }); // no email field

    await trigger(makeTeamWrittenEvent(
      'team-lions',
      undefined,
      { name: 'Lions', coachIds: ['coach-1'] },
    ));

    const teamSet = _docSets.find(w => w.path === 'teams/team-lions');
    const coaches = teamSet!.data.coaches as Record<string, { name: string; email?: string }>;
    expect('email' in coaches['coach-1']).toBe(false);
  });

  it('skips user docs that do not exist (missing coach profile)', async () => {
    // coach-2 exists, coach-ghost does not
    _users.set('coach-2', { displayName: 'Bob Jones', email: 'bob@example.com' });
    // coach-ghost is not in _users → get() returns { exists: false }

    await trigger(makeTeamWrittenEvent(
      'team-lions',
      undefined,
      { name: 'Lions', coachIds: ['coach-ghost', 'coach-2'] },
    ));

    const teamSet = _docSets.find(w => w.path === 'teams/team-lions');
    const coaches = teamSet!.data.coaches as Record<string, { name: string; email?: string }>;
    // Ghost should be absent; coach-2 should be present
    expect('coach-ghost' in coaches).toBe(false);
    expect(coaches['coach-2'].name).toBe('Bob Jones');
  });

  it('writes coaches: FieldValue.delete() when coachIds is empty', async () => {
    await trigger(makeTeamWrittenEvent(
      'team-lions',
      undefined, // create — coachIds "changed"
      { name: 'Lions', coachIds: [] },
    ));

    const teamUpdate = _docUpdates.find(w => w.path === 'teams/team-lions');
    expect(teamUpdate).toBeDefined();
    expect(teamUpdate!.data.coaches).toBe(FieldValueDelete);
  });

  it('handles empty memberships (missing coachIds) without crashing', async () => {
    // Team doc has no coachIds field → treated as []
    await expect(
      trigger(makeTeamWrittenEvent(
        'team-lions',
        undefined,
        { name: 'Lions' }, // no coachIds
      )),
    ).resolves.not.toThrow();
  });

  it('is idempotent — re-running with the same coachIds produces the same coaches write', async () => {
    _users.set('coach-1', { displayName: 'Alice Smith', email: 'alice@example.com' });

    const event = makeTeamWrittenEvent(
      'team-lions',
      undefined,
      { name: 'Lions', coachIds: ['coach-1'] },
    );

    await trigger(event);
    const firstWrite = _docSets.find(w => w.path === 'teams/team-lions');
    const firstCoaches = JSON.stringify(firstWrite!.data.coaches);

    _docSets.length = 0; // reset write log

    await trigger(event);
    const secondWrite = _docSets.find(w => w.path === 'teams/team-lions');
    const secondCoaches = JSON.stringify(secondWrite!.data.coaches);

    expect(firstCoaches).toBe(secondCoaches);
  });

  it('does not call the denorm helper when coachIds did not change', async () => {
    _users.set('coach-1', { displayName: 'Alice Smith', email: 'alice@example.com' });

    // before and after have the same coachIds
    await trigger(makeTeamWrittenEvent(
      'team-lions',
      { name: 'Lions', coachIds: ['coach-1'] }, // before
      { name: 'Lions Updated', coachIds: ['coach-1'] }, // after — only name changed
    ));

    // No set() should have been issued for the coaches denorm field
    const teamSet = _docSets.find(w => w.path === 'teams/team-lions');
    expect(teamSet).toBeUndefined();
  });

  it('sets the coaches map with { merge: true } so other team fields are preserved', async () => {
    _users.set('coach-1', { displayName: 'Alice Smith', email: 'alice@example.com' });

    await trigger(makeTeamWrittenEvent(
      'team-lions',
      undefined,
      { name: 'Lions', coachIds: ['coach-1'] },
    ));

    const teamSet = _docSets.find(w => w.path === 'teams/team-lions');
    expect(teamSet!.options).toEqual({ merge: true });
  });
});
