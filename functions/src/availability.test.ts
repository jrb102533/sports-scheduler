import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

// ─── Firestore mock ───────────────────────────────────────────────────────────
//
// Strategy: build a single Firestore mock whose doc/collection/collectionGroup
// responses are driven by two in-memory registries (mockDocRegistry /
// mockCollectionRegistry).  Per-test setup writes to these registries; no
// per-test mockImplementation overrides required.

type DocData = Record<string, unknown>;

// Registries — reset in beforeEach
const mockDocRegistry: Record<string, { exists: boolean; data: () => DocData }> = {};
const mockCollectionRegistry: Record<string, Array<{ id: string; data: () => DocData }>> = {};

// Batch spies
const mockBatchSet = vi.fn();
const mockBatchUpdate = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);

// Collection-group query state — set per test
let mockCGroupQueryResults: Array<Array<ColGroupDoc>> = [];
let mockCGroupCallIndex = 0;

type ColGroupDoc = {
  id: string;
  ref: { update: ReturnType<typeof vi.fn>; parent: { parent: { id: string } | null } };
  data: () => DocData;
};

function makeColGroupDoc(id: string, data: DocData, leagueId = 'league-1'): ColGroupDoc {
  return {
    id,
    ref: {
      update: vi.fn().mockResolvedValue(undefined),
      parent: { parent: { id: leagueId } },
    },
    data: () => data,
  };
}

// ─── Chainable Firestore helper builders ──────────────────────────────────────

/** Minimal notification doc ref (returned from .collection('notifications').doc()) */
function makeNotifRef() {
  return {
    id: `notif-${Math.random().toString(36).slice(2)}`,
    set: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * A document reference that supports:
 *  .get()                          → registry lookup
 *  .update()                       → spy
 *  .set()                          → spy
 *  .collection(sub).doc()          → notification ref
 *  .collection(sub).get()          → registry lookup
 */
function makeDocRef(fullPath: string) {
  return {
    get: vi.fn().mockImplementation(async () => {
      return mockDocRegistry[fullPath] ?? { exists: false, data: () => ({}) };
    }),
    update: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    collection: vi.fn((sub: string) => {
      const subPath = `${fullPath}/${sub}`;
      return {
        doc: vi.fn((_id?: string) => makeNotifRef()),
        get: vi.fn().mockImplementation(async () => ({
          docs: (mockCollectionRegistry[subPath] ?? []).map(d => ({
            id: d.id,
            data: d.data,
          })),
        })),
      };
    }),
  };
}

/** Top-level db.collection(path) — supports .where().get() and .doc(id) */
function makeCollectionRef(path: string) {
  return {
    where: vi.fn().mockReturnValue({
      get: vi.fn().mockImplementation(async () => {
        const docs = mockCollectionRegistry[path] ?? [];
        return { empty: docs.length === 0, docs: docs.map(d => ({ id: d.id, data: d.data })) };
      }),
    }),
    doc: vi.fn((id: string) => makeDocRef(`${path}/${id}`)),
  };
}

// ─── Mock Firestore instance ──────────────────────────────────────────────────

const mockFirestoreInstance = {
  doc: vi.fn((path: string) => makeDocRef(path)),
  collection: vi.fn((path: string) => makeCollectionRef(path)),
  collectionGroup: vi.fn((_name: string) => {
    const chain = {
      where: vi.fn(() => chain),
      get: vi.fn().mockImplementation(async () => {
        const docs = mockCGroupQueryResults[mockCGroupCallIndex] ?? [];
        mockCGroupCallIndex++;
        return { docs };
      }),
    };
    return chain;
  }),
  batch: vi.fn(() => ({
    set: mockBatchSet,
    update: mockBatchUpdate,
    commit: mockBatchCommit,
  })),
};

const mockFirestore = vi.fn(() => mockFirestoreInstance);

// ─── firebase-admin mock ──────────────────────────────────────────────────────

vi.mock('firebase-admin', () => ({
  default: {
    initializeApp: vi.fn(),
    firestore: mockFirestore,
  },
  initializeApp: vi.fn(),
  firestore: mockFirestore,
}));

// ─── firebase-functions/v2/https ─────────────────────────────────────────────
// onCall may be called as onCall(handler) OR onCall(opts, handler).

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (optsOrHandler: unknown, handler?: Function) =>
    typeof handler === 'function' ? handler : (optsOrHandler as Function),
  onRequest: (_opts: unknown, handler: Function) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) {
      super(message);
      this.name = 'HttpsError';
    }
  },
}));

// ─── firebase-functions/v2/firestore ─────────────────────────────────────────

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn(),
  onDocumentUpdated: vi.fn(),
}));

// ─── firebase-functions/v2/scheduler ─────────────────────────────────────────
// Return the inner async handler so tests can call it directly.

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: unknown, handler: Function) => handler,
}));

// ─── firebase-functions/params ───────────────────────────────────────────────

vi.mock('firebase-functions/params', () => ({
  defineSecret: (name: string) => ({ value: () => `mock-${name}`, name }),
}));

// ─── nodemailer ───────────────────────────────────────────────────────────────

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) },
  createTransport: vi.fn(() => ({ sendMail: vi.fn() })),
}));

// ─── @anthropic-ai/sdk ────────────────────────────────────────────────────────

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));

// ─── twilio ───────────────────────────────────────────────────────────────────

vi.mock('twilio', () => ({
  default: vi.fn(() => ({})),
}));

// ─── Import handlers under test ───────────────────────────────────────────────
// onCall → handler directly; onSchedule → handler directly.
// The mocked onCall/onSchedule return the raw async handler (1-arg), so we
// type these as any to avoid argument-count mismatches from the real signatures.

 
let requestAvailability: (req: any) => Promise<any>;
 
let sendAvailabilityReminder: (req: any) => Promise<any>;
 
let autoCloseCollections: (event: any) => Promise<any>;

beforeAll(async () => {
  const mod = await import('./index');
  requestAvailability = mod.requestAvailability as any;
  sendAvailabilityReminder = mod.sendAvailabilityReminder as any;
  autoCloseCollections = mod.autoCloseCollections as any;
});

// ─── Test utilities ───────────────────────────────────────────────────────────

function regDoc(path: string, data: DocData) {
  mockDocRegistry[path] = { exists: true, data: () => data };
}

function regCollection(path: string, docs: Array<{ id: string; data: () => DocData }>) {
  mockCollectionRegistry[path] = docs;
}

function makeRequest(auth: { uid: string } | null, data: Record<string, unknown>) {
  return { auth, data };
}

function resetRegistries() {
  for (const k of Object.keys(mockDocRegistry)) delete mockDocRegistry[k];
  for (const k of Object.keys(mockCollectionRegistry)) delete mockCollectionRegistry[k];
  mockCGroupQueryResults = [];
  mockCGroupCallIndex = 0;
}

// ─── requestAvailability ──────────────────────────────────────────────────────

describe('requestAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRegistries();
    // Re-bind Firestore methods after clearAllMocks (they reference closures over
    // the registries, so they survive the mock reset automatically).
    mockFirestoreInstance.doc.mockImplementation((path: string) => makeDocRef(path));
    mockFirestoreInstance.collection.mockImplementation((path: string) => makeCollectionRef(path));
    mockFirestoreInstance.batch.mockReturnValue({
      set: mockBatchSet,
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    });
  });

  it('throws unauthenticated when no auth is provided', async () => {
    const req = makeRequest(null, { leagueId: 'league-1', collectionId: 'col-1' });
    await expect(requestAvailability(req as any)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('throws permission-denied when caller has coach role (not LM or admin)', async () => {
    regDoc('users/coach-uid', { role: 'coach' });

    const req = makeRequest({ uid: 'coach-uid' }, { leagueId: 'league-1', collectionId: 'col-1' });
    await expect(requestAvailability(req as any)).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('throws permission-denied when LM calls with a leagueId they do not own', async () => {
    // LM whose leagueId is 'my-league', but they are requesting 'other-league'
    regDoc('users/lm-uid', { role: 'league_manager', leagueId: 'my-league' });
    regDoc('leagues/other-league', { name: 'Other League', managedBy: 'someone-else' });

    const req = makeRequest({ uid: 'lm-uid' }, { leagueId: 'other-league', collectionId: 'col-1' });
    await expect(requestAvailability(req as any)).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('returns { notified: 0 } when league has no teams', async () => {
    regDoc('users/lm-uid', { role: 'league_manager', leagueId: 'league-1' });
    regDoc('leagues/league-1', { name: 'Test League', managedBy: 'lm-uid' });
    regDoc('leagues/league-1/availabilityCollections/col-1', { dueDate: '2026-04-01', status: 'open' });
    // 'teams' collection left empty (default: no docs)

    const req = makeRequest({ uid: 'lm-uid' }, { leagueId: 'league-1', collectionId: 'col-1' });
    const result = await requestAvailability(req as any);
    expect(result).toEqual({ notified: 0 });
  });

  it('creates one notification per coach and returns { notified: 3 }', async () => {
    regDoc('users/lm-uid', { role: 'league_manager', leagueId: 'league-1' });
    regDoc('leagues/league-1', { name: 'Test League', managedBy: 'lm-uid' });
    regDoc('leagues/league-1/availabilityCollections/col-1', { dueDate: '2026-04-01', status: 'open' });
    regDoc('users/c1', { displayName: 'Coach 1' });
    regDoc('users/c2', { displayName: 'Coach 2' });
    regDoc('users/c3', { displayName: 'Coach 3' });

    // The teams collection query returns 3 teams with distinct coaches
    regCollection('teams', [
      { id: 't1', data: () => ({ leagueId: 'league-1', coachId: 'c1' }) },
      { id: 't2', data: () => ({ leagueId: 'league-1', coachId: 'c2' }) },
      { id: 't3', data: () => ({ leagueId: 'league-1', coachId: 'c3' }) },
    ]);

    const req = makeRequest({ uid: 'lm-uid' }, { leagueId: 'league-1', collectionId: 'col-1' });
    const result = await requestAvailability(req as any);

    expect(result).toEqual({ notified: 3 });
    // One batch.set per coach notification
    expect(mockBatchSet).toHaveBeenCalledTimes(3);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });
});

// ─── sendAvailabilityReminder — 48-hour cooldown ──────────────────────────────

describe('sendAvailabilityReminder — cooldown logic', () => {
  const NOW = new Date('2026-03-28T12:00:00.000Z');
  const COACH_UID = 'coach-uid';
  const LEAGUE_ID = 'league-1';
  const COL_ID = 'col-1';

  function baseSetup(opts: { lastReminderSentAt?: string; hasResponded?: boolean } = {}) {
    const { lastReminderSentAt, hasResponded = false } = opts;

    regDoc('users/lm-uid', { role: 'league_manager', leagueId: LEAGUE_ID });
    regDoc(`leagues/${LEAGUE_ID}`, { name: 'Test League', managedBy: 'lm-uid' });
    regDoc(`leagues/${LEAGUE_ID}/availabilityCollections/${COL_ID}`, {
      status: 'open',
      dueDate: '2026-04-01',
      leagueName: 'Test League',
    });
    regDoc(`users/${COACH_UID}`, { displayName: 'Coach One' });

    if (lastReminderSentAt) {
      regDoc(`users/${COACH_UID}/config/reminderCooldown`, { lastReminderSentAt });
    }

    // Responses subcollection
    const responseDocs = hasResponded
      ? [{ id: COACH_UID, data: () => ({ coachUid: COACH_UID }) }]
      : [];
    regCollection(`leagues/${LEAGUE_ID}/availabilityCollections/${COL_ID}/responses`, responseDocs);

    // Teams query
    regCollection('teams', [
      { id: 't1', data: () => ({ leagueId: LEAGUE_ID, coachId: COACH_UID }) },
    ]);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    resetRegistries();
    mockFirestoreInstance.doc.mockImplementation((path: string) => makeDocRef(path));
    mockFirestoreInstance.collection.mockImplementation((path: string) => makeCollectionRef(path));
    mockFirestoreInstance.batch.mockReturnValue({
      set: mockBatchSet,
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips a coach reminded 47 hours ago (within 48-hour cooldown)', async () => {
    const fortySevenHoursAgo = new Date(NOW.getTime() - 47 * 60 * 60 * 1000).toISOString();
    baseSetup({ lastReminderSentAt: fortySevenHoursAgo });

    const req = makeRequest({ uid: 'lm-uid' }, { leagueId: LEAGUE_ID, collectionId: COL_ID });
    const result = await sendAvailabilityReminder(req as any);

    expect(result).toEqual({ reminded: 0 });
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  it('includes a coach reminded 49 hours ago (past 48-hour cooldown)', async () => {
    const fortyNineHoursAgo = new Date(NOW.getTime() - 49 * 60 * 60 * 1000).toISOString();
    baseSetup({ lastReminderSentAt: fortyNineHoursAgo });

    const req = makeRequest({ uid: 'lm-uid' }, { leagueId: LEAGUE_ID, collectionId: COL_ID });
    const result = await sendAvailabilityReminder(req as any);

    expect(result).toEqual({ reminded: 1 });
    // Two batch.set calls: one notification + one cooldown update
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
  });

  it('includes a coach with no prior reminder record', async () => {
    baseSetup({ lastReminderSentAt: undefined });

    const req = makeRequest({ uid: 'lm-uid' }, { leagueId: LEAGUE_ID, collectionId: COL_ID });
    const result = await sendAvailabilityReminder(req as any);

    expect(result).toEqual({ reminded: 1 });
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
  });

  it('skips a coach who has already responded', async () => {
    baseSetup({ hasResponded: true });

    const req = makeRequest({ uid: 'lm-uid' }, { leagueId: LEAGUE_ID, collectionId: COL_ID });
    const result = await sendAvailabilityReminder(req as any);

    expect(result).toEqual({ reminded: 0 });
    expect(mockBatchSet).not.toHaveBeenCalled();
  });
});

// ─── autoCloseCollections — date threshold logic ──────────────────────────────
//
// autoCloseCollections runs three collectionGroup queries.  We simulate the
// server-side WHERE filtering by routing each query invocation to a pre-set
// result array (mockCGroupQueryResults[0..2]).

describe('autoCloseCollections — date threshold logic', () => {
  const NOW = new Date('2026-03-28T00:05:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    resetRegistries();
    mockFirestoreInstance.doc.mockImplementation((path: string) => makeDocRef(path));
    mockFirestoreInstance.collection.mockImplementation((path: string) => makeCollectionRef(path));
    mockFirestoreInstance.collectionGroup.mockImplementation((_name: string) => {
      const chain = {
        where: vi.fn(() => chain),
        get: vi.fn().mockImplementation(async () => {
          const docs = mockCGroupQueryResults[mockCGroupCallIndex] ?? [];
          mockCGroupCallIndex++;
          return { docs };
        }),
      };
      return chain;
    });
    mockFirestoreInstance.batch.mockReturnValue({
      set: mockBatchSet,
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    });
    // Register a league doc so name lookups resolve
    regDoc('leagues/league-1', { name: 'Test League' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks an open collection with dueDate of yesterday as closed', async () => {
    const yesterday = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const colDoc = makeColGroupDoc('col-past-due', {
      status: 'open',
      dueDate: yesterday,
      leagueId: 'league-1',
      createdBy: 'lm-uid',
    });

    // Query 1 = open overdue, Query 2 = warn60, Query 3 = expire90
    mockCGroupQueryResults = [[colDoc], [], []];

    await autoCloseCollections(undefined as any);

    expect(colDoc.ref.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'closed', closedAt: expect.any(String) }),
    );
  });

  it('sends 60-day warning notification for a closed collection exactly 60 days old', async () => {
    const sixtyDaysAgo = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();

    const colDoc = makeColGroupDoc('col-60d', {
      status: 'closed',
      closedAt: sixtyDaysAgo,
      leagueId: 'league-1',
      createdBy: 'lm-uid',
    });

    // Query 1 empty, Query 2 = warn60, Query 3 empty
    mockCGroupQueryResults = [[], [colDoc], []];

    // Track notification set calls via the doc registry's collection chain
    const notifSetSpy = vi.fn().mockResolvedValue(undefined);
    mockFirestoreInstance.collection.mockImplementation((path: string) => {
      const base = makeCollectionRef(path);
      if (path === 'users') {
        return {
          ...base,
          doc: vi.fn((uid: string) => ({
            ...makeDocRef(`${path}/${uid}`),
            collection: vi.fn((_sub: string) => ({
              doc: vi.fn(() => ({ id: 'notif', set: notifSetSpy, update: vi.fn().mockResolvedValue(undefined) })),
              get: vi.fn().mockResolvedValue({ docs: [] }),
            })),
          })),
        };
      }
      return base;
    });

    await autoCloseCollections(undefined as any);

    expect(notifSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'info',
        title: expect.stringContaining('expiring'),
      }),
    );
  });

  it('marks a closed collection with closedAt 91 days ago as expired', async () => {
    const ninetyOneDaysAgo = new Date(NOW.getTime() - 91 * 24 * 60 * 60 * 1000).toISOString();
    const colDoc = makeColGroupDoc('col-91d', {
      status: 'closed',
      closedAt: ninetyOneDaysAgo,
      leagueId: 'league-1',
      createdBy: 'lm-uid',
    });

    // Query 1 empty, Query 2 empty, Query 3 = expire90
    mockCGroupQueryResults = [[], [], [colDoc]];

    await autoCloseCollections(undefined as any);

    // Expiry uses batch.update, not batch.set
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      colDoc.ref,
      expect.objectContaining({ status: 'expired', expiredAt: expect.any(String) }),
    );
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('takes no action for a collection closed 30 days ago', async () => {
    // All three queries return empty — nothing to do
    mockCGroupQueryResults = [[], [], []];

    await autoCloseCollections(undefined as any);

    // No writes issued
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(mockBatchSet).not.toHaveBeenCalled();
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });
});
