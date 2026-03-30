/**
 * Tests for practiceSlotSignUp, practiceSlotCancel, and practiceSlotAddBlackout
 * callable Cloud Functions — Issue #130.
 *
 * Uses an in-process Firestore stub (matching the pattern in schedule-wizard.test.ts)
 * so tests run without a live Firebase project or emulator.
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

// ─── In-process Firestore mock ────────────────────────────────────────────────

type DocData = Record<string, unknown>;

const _store: Map<string, DocData> = new Map();
let _docIdCounter = 0;

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

  get id(): string {
    return this.path.split('/').pop()!;
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
  private _orderByField: string | null = null;
  private _limitVal: number | null = null;
  private _collectionPath: string;

  constructor(collectionPath: string) {
    this._collectionPath = collectionPath;
  }

  where(field: string, op: string, value: unknown): MockQuery {
    const q = new MockQuery(this._collectionPath);
    q._filters = [...this._filters, { field, op, value }];
    q._orderByField = this._orderByField;
    q._limitVal = this._limitVal;
    return q;
  }

  orderBy(field: string, _dir?: string): MockQuery {
    const q = new MockQuery(this._collectionPath);
    q._filters = [...this._filters];
    q._orderByField = field;
    q._limitVal = this._limitVal;
    return q;
  }

  limit(n: number): MockQuery {
    const q = new MockQuery(this._collectionPath);
    q._filters = [...this._filters];
    q._orderByField = this._orderByField;
    q._limitVal = n;
    return q;
  }

  doc(id?: string): MockDocRef {
    const docId = id ?? `auto-${++_docIdCounter}`;
    return new MockDocRef(`${this._collectionPath}/${docId}`);
  }

  async get(): Promise<MockQuerySnap> {
    const docs: Array<{ id: string; ref: MockDocRef; data: () => DocData }> = [];
    for (const [path, data] of _store.entries()) {
      if (!path.startsWith(this._collectionPath + '/')) continue;
      const rest = path.slice(this._collectionPath.length + 1);
      if (rest.includes('/')) continue;

      let matches = true;
      for (const f of this._filters) {
        const val = (data as Record<string, unknown>)[f.field];
        if (f.op === '==') {
          if (val !== f.value) { matches = false; break; }
        } else if (f.op === 'in') {
          if (!Array.isArray(f.value) || !f.value.includes(val)) { matches = false; break; }
        }
      }
      if (matches) {
        const id = rest;
        docs.push({ id, ref: new MockDocRef(path), data: () => data });
      }
    }

    if (this._orderByField) {
      const field = this._orderByField;
      docs.sort((a, b) => {
        const av = String(a.data()[field] ?? '');
        const bv = String(b.data()[field] ?? '');
        return av < bv ? -1 : av > bv ? 1 : 0;
      });
    }

    const limited = this._limitVal !== null ? docs.slice(0, this._limitVal) : docs;
    return new MockQuerySnap(limited);
  }
}

class MockQuerySnap {
  docs: Array<{ id: string; ref: MockDocRef; data: () => DocData }>;
  empty: boolean;
  size: number;
  constructor(docs: Array<{ id: string; ref: MockDocRef; data: () => DocData }>) {
    this.docs = docs;
    this.empty = docs.length === 0;
    this.size = docs.length;
  }
}

class MockTransaction {
  private _ops: Array<() => void> = [];
  private _reads: Map<string, MockDocSnap> = new Map();

  async get(refOrQuery: MockDocRef | MockQuery): Promise<MockDocSnap | MockQuerySnap> {
    if (refOrQuery instanceof MockDocRef) {
      const data = _store.get(refOrQuery.path);
      const snap = new MockDocSnap(refOrQuery.path, data);
      this._reads.set(refOrQuery.path, snap);
      return snap;
    }
    // MockQuery
    return refOrQuery.get();
  }

  set(ref: MockDocRef, data: DocData, _opts?: unknown): void {
    this._ops.push(() => {
      _store.set(ref.path, { ...((_store.get(ref.path)) ?? {}), ...data });
    });
  }

  update(ref: MockDocRef, data: DocData): void {
    this._ops.push(() => {
      const existing = _store.get(ref.path) ?? {};
      // Handle FieldValue.arrayUnion
      const merged: DocData = { ...existing };
      for (const [key, val] of Object.entries(data)) {
        if (val && typeof val === 'object' && '_methodName' in val && (val as Record<string, string>)._methodName === 'FieldValue.arrayUnion') {
          const elements = (val as Record<string, unknown[]>)._elements ?? [];
          merged[key] = [...(Array.isArray(existing[key]) ? existing[key] as unknown[] : []), ...elements];
        } else {
          merged[key] = val;
        }
      }
      _store.set(ref.path, merged);
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

vi.mock('firebase-admin', () => {
  const fieldValue = {
    arrayUnion: (...elements: unknown[]) => ({ _methodName: 'FieldValue.arrayUnion', _elements: elements }),
    increment: (n: number) => ({ _methodName: 'FieldValue.increment', _n: n }),
  };

  const db = {
    doc: (path: string) => new MockDocRef(path),
    collection: (path: string) => new MockQuery(path),
    runTransaction: async (cb: (tx: MockTransaction) => Promise<unknown>) => {
      const tx = new MockTransaction();
      const result = await cb(tx);
      await tx.commit();
      return result;
    },
  };

  const firestoreFn = Object.assign(() => db, { FieldValue: fieldValue });

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

// ─── Import functions under test AFTER mocks ─────────────────────────────────

import { practiceSlotSignUp, practiceSlotCancel, practiceSlotAddBlackout } from './practiceSlots';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type CallableFn<T = unknown> = (req: { auth: { uid: string }; data: T }) => Promise<unknown>;

const signUpFn = practiceSlotSignUp as unknown as CallableFn<{
  leagueId: string; seasonId: string; windowId: string;
  occurrenceDate: string; teamId: string; teamName: string;
}>;

const cancelFn = practiceSlotCancel as unknown as CallableFn<{
  leagueId: string; seasonId: string; signupId: string;
}>;

const blackoutFn = practiceSlotAddBlackout as unknown as CallableFn<{
  leagueId: string; seasonId: string; windowId: string; date: string;
}>;

function makeReq<T>(data: T, uid: string) {
  return { auth: { uid }, data };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
  _docIdCounter = 0;
}

const LEAGUE = 'league1';
const SEASON = 'season1';
const WINDOW_ID = 'window1';
const OCCURRENCE = '2026-04-08';
const TEAM_A = 'teamA';
const TEAM_B = 'teamB';
const COACH_A = 'coach-a';
const COACH_B = 'coach-b';
const LM_UID = 'lm-1';

function seedBaseData() {
  seedDoc(`users/${COACH_A}`, { role: 'coach', displayName: 'Alice' });
  seedDoc(`users/${COACH_B}`, { role: 'coach', displayName: 'Bob' });
  seedDoc(`users/${LM_UID}`, { role: 'league_manager', leagueId: LEAGUE, displayName: 'LM' });
  seedDoc(`teams/${TEAM_A}`, { coachId: COACH_A, createdBy: COACH_A, name: 'Team A' });
  seedDoc(`teams/${TEAM_B}`, { coachId: COACH_B, createdBy: COACH_B, name: 'Team B' });
  seedDoc(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotWindows/${WINDOW_ID}`, {
    id: WINDOW_ID,
    name: 'Tuesday Evening',
    venueId: 'venue1',
    venueName: 'Main Ground',
    fieldId: null,
    fieldName: null,
    dayOfWeek: 2,
    startTime: '18:00',
    endTime: '20:00',
    effectiveStart: '2026-04-01',
    effectiveEnd: '2026-06-30',
    oneOffDate: null,
    capacity: 2,
    blackoutDates: [],
    status: 'active',
    createdBy: LM_UID,
    createdAt: '2026-03-29T00:00:00.000Z',
    updatedAt: '2026-03-29T00:00:00.000Z',
  });
}

function signupId(teamId: string) {
  return `${WINDOW_ID}_${OCCURRENCE}_${teamId}`;
}

// ─── practiceSlotSignUp tests ─────────────────────────────────────────────────

describe('practiceSlotSignUp', () => {
  beforeEach(() => {
    clearStore();
    seedBaseData();
  });

  it('confirms a signup when capacity is available', async () => {
    const result = await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
      COACH_A,
    )) as { status: string };

    expect(result.status).toBe('confirmed');

    const doc = _store.get(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotSignups/${signupId(TEAM_A)}`);
    expect(doc).toBeDefined();
    expect(doc?.status).toBe('confirmed');
    expect(doc?.waitlistPosition).toBeNull();
    expect(doc?.eventId).toBeTruthy();
  });

  it('creates a ScheduledEvent of type "practice" when confirmed', async () => {
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
      COACH_A,
    ));

    const signup = _store.get(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotSignups/${signupId(TEAM_A)}`);
    const eventId = signup?.eventId as string;
    expect(eventId).toBeTruthy();

    const event = _store.get(`events/${eventId}`);
    expect(event).toBeDefined();
    expect(event?.type).toBe('practice');
    expect(event?.teamIds).toEqual([TEAM_A]);
  });

  it('waitlists a signup when capacity is full', async () => {
    // Fill capacity (2 teams)
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
      COACH_A,
    ));
    seedDoc(`users/coach-c`, { role: 'coach', displayName: 'Carol' });
    seedDoc(`teams/teamC`, { coachId: 'coach-c', createdBy: 'coach-c', name: 'Team C' });
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_B, teamName: 'Team B' },
      COACH_B,
    ));

    const result = await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: 'teamC', teamName: 'Team C' },
      'coach-c',
    )) as { status: string };

    expect(result.status).toBe('waitlisted');

    const doc = _store.get(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotSignups/${WINDOW_ID}_${OCCURRENCE}_teamC`);
    expect(doc?.status).toBe('waitlisted');
    expect(doc?.waitlistPosition).toBe(1);
    expect(doc?.eventId).toBeNull();
  });

  it('does not create a ScheduledEvent for a waitlisted signup', async () => {
    // Fill the slot first
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
      COACH_A,
    ));
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_B, teamName: 'Team B' },
      COACH_B,
    ));
    seedDoc(`users/coach-c`, { role: 'coach', displayName: 'Carol' });
    seedDoc(`teams/teamC`, { coachId: 'coach-c', createdBy: 'coach-c', name: 'Team C' });

    // Count events before waitlist signup
    const eventsBefore = [..._store.keys()].filter(k => k.startsWith('events/')).length;

    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: 'teamC', teamName: 'Team C' },
      'coach-c',
    ));

    const eventsAfter = [..._store.keys()].filter(k => k.startsWith('events/')).length;
    expect(eventsAfter).toBe(eventsBefore); // no new event created
  });

  it('rejects signup for a blacked-out date', async () => {
    _store.set(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotWindows/${WINDOW_ID}`, {
      ..._store.get(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotWindows/${WINDOW_ID}`)!,
      blackoutDates: [OCCURRENCE],
    });

    await expect(
      signUpFn(makeReq(
        { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
        COACH_A,
      )),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects double-booking the same team on the same occurrence', async () => {
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
      COACH_A,
    ));

    await expect(
      signUpFn(makeReq(
        { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
        COACH_A,
      )),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('rejects signup when the window is paused', async () => {
    _store.set(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotWindows/${WINDOW_ID}`, {
      ..._store.get(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotWindows/${WINDOW_ID}`)!,
      status: 'paused',
    });

    await expect(
      signUpFn(makeReq(
        { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
        COACH_A,
      )),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects signup from a non-coach user', async () => {
    seedDoc(`users/parent-1`, { role: 'parent', displayName: 'Parent' });
    seedDoc(`teams/${TEAM_A}`, { coachId: COACH_A, createdBy: COACH_A, name: 'Team A' });

    await expect(
      signUpFn(makeReq(
        { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
        'parent-1',
      )),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects signup from a coach who does not own the team', async () => {
    seedDoc(`users/other-coach`, { role: 'coach', displayName: 'Other' });

    await expect(
      signUpFn(makeReq(
        { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
        'other-coach',
      )),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects unauthenticated requests', async () => {
    await expect(
      (practiceSlotSignUp as unknown as CallableFn)(
        { auth: null as unknown as { uid: string }, data: { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' } },
      ),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('writes a confirmed notification to the coach', async () => {
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
      COACH_A,
    ));

    const notifs = [..._store.entries()]
      .filter(([k]) => k.startsWith(`users/${COACH_A}/notifications/`))
      .map(([, v]) => v);

    expect(notifs.length).toBe(1);
    expect(notifs[0].type).toBe('practice_slot_confirmed');
  });

  it('writes a waitlisted notification when capacity is full', async () => {
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
      COACH_A,
    ));
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_B, teamName: 'Team B' },
      COACH_B,
    ));
    seedDoc(`users/coach-c`, { role: 'coach', displayName: 'Carol' });
    seedDoc(`teams/teamC`, { coachId: 'coach-c', createdBy: 'coach-c', name: 'Team C' });

    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: 'teamC', teamName: 'Team C' },
      'coach-c',
    ));

    const notifs = [..._store.entries()]
      .filter(([k]) => k.startsWith(`users/coach-c/notifications/`))
      .map(([, v]) => v);

    expect(notifs.length).toBe(1);
    expect(notifs[0].type).toBe('practice_slot_waitlisted');
  });
});

// ─── practiceSlotCancel tests ─────────────────────────────────────────────────

describe('practiceSlotCancel', () => {
  beforeEach(() => {
    clearStore();
    seedBaseData();
  });

  async function signUpTeamA() {
    return signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
      COACH_A,
    )) as Promise<{ signupId: string }>;
  }

  async function signUpTeamB() {
    return signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_B, teamName: 'Team B' },
      COACH_B,
    )) as Promise<{ signupId: string }>;
  }

  it('cancels a confirmed booking and deletes the ScheduledEvent', async () => {
    const { signupId: sid } = await signUpTeamA();
    const signup = _store.get(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotSignups/${sid}`)!;
    const eventId = signup.eventId as string;

    await cancelFn(makeReq({ leagueId: LEAGUE, seasonId: SEASON, signupId: sid }, COACH_A));

    const updated = _store.get(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotSignups/${sid}`);
    expect(updated?.status).toBe('cancelled');
    expect(_store.has(`events/${eventId}`)).toBe(false);
  });

  it('auto-promotes the first waitlisted team when a confirmed booking is cancelled', async () => {
    // Fill capacity and add a waitlisted team
    await signUpTeamA();
    await signUpTeamB();
    seedDoc(`users/coach-c`, { role: 'coach', displayName: 'Carol' });
    seedDoc(`teams/teamC`, { coachId: 'coach-c', createdBy: 'coach-c', name: 'Team C' });
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: 'teamC', teamName: 'Team C' },
      'coach-c',
    ));

    // Verify teamC is waitlisted
    const waitlistedDoc = _store.get(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotSignups/${WINDOW_ID}_${OCCURRENCE}_teamC`);
    expect(waitlistedDoc?.status).toBe('waitlisted');

    // Cancel Team A
    await cancelFn(makeReq({ leagueId: LEAGUE, seasonId: SEASON, signupId: signupId(TEAM_A) }, COACH_A));

    // teamC should now be confirmed
    const promoted = _store.get(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotSignups/${WINDOW_ID}_${OCCURRENCE}_teamC`);
    expect(promoted?.status).toBe('confirmed');
    expect(promoted?.waitlistPosition).toBeNull();
    expect(promoted?.eventId).toBeTruthy();
  });

  it('creates a ScheduledEvent for the promoted team', async () => {
    await signUpTeamA();
    await signUpTeamB();
    seedDoc(`users/coach-c`, { role: 'coach', displayName: 'Carol' });
    seedDoc(`teams/teamC`, { coachId: 'coach-c', createdBy: 'coach-c', name: 'Team C' });
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: 'teamC', teamName: 'Team C' },
      'coach-c',
    ));

    const eventsBefore = [..._store.keys()].filter(k => k.startsWith('events/')).length;

    await cancelFn(makeReq({ leagueId: LEAGUE, seasonId: SEASON, signupId: signupId(TEAM_A) }, COACH_A));

    const eventsAfter = [..._store.keys()].filter(k => k.startsWith('events/')).length;
    // One event deleted (Team A), one created (Team C) — net change = 0
    expect(eventsAfter).toBe(eventsBefore);
  });

  it('writes a practice_slot_promoted notification to the promoted coach', async () => {
    await signUpTeamA();
    await signUpTeamB();
    seedDoc(`users/coach-c`, { role: 'coach', displayName: 'Carol' });
    seedDoc(`teams/teamC`, { coachId: 'coach-c', createdBy: 'coach-c', name: 'Team C' });
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: 'teamC', teamName: 'Team C' },
      'coach-c',
    ));

    await cancelFn(makeReq({ leagueId: LEAGUE, seasonId: SEASON, signupId: signupId(TEAM_A) }, COACH_A));

    const notifs = [..._store.entries()]
      .filter(([k]) => k.startsWith('users/coach-c/notifications/'))
      .map(([, v]) => v);

    const promoted = notifs.find(n => n.type === 'practice_slot_promoted');
    expect(promoted).toBeDefined();
  });

  it('rejects cancellation from a coach who did not sign up', async () => {
    const { signupId: sid } = await signUpTeamA();
    seedDoc(`users/other-coach`, { role: 'coach', displayName: 'Other' });

    await expect(
      cancelFn(makeReq({ leagueId: LEAGUE, seasonId: SEASON, signupId: sid }, 'other-coach')),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('allows an LM to cancel any booking', async () => {
    const { signupId: sid } = await signUpTeamA();

    await expect(
      cancelFn(makeReq({ leagueId: LEAGUE, seasonId: SEASON, signupId: sid }, LM_UID)),
    ).resolves.toEqual({ success: true });

    const updated = _store.get(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotSignups/${sid}`);
    expect(updated?.status).toBe('cancelled');
  });

  it('rejects cancelling an already-cancelled signup', async () => {
    const { signupId: sid } = await signUpTeamA();
    await cancelFn(makeReq({ leagueId: LEAGUE, seasonId: SEASON, signupId: sid }, COACH_A));

    await expect(
      cancelFn(makeReq({ leagueId: LEAGUE, seasonId: SEASON, signupId: sid }, COACH_A)),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

// ─── practiceSlotAddBlackout tests ────────────────────────────────────────────

describe('practiceSlotAddBlackout', () => {
  beforeEach(() => {
    clearStore();
    seedBaseData();
  });

  it('adds the date to the window\'s blackoutDates array', async () => {
    await blackoutFn(makeReq({ leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, date: OCCURRENCE }, LM_UID));

    const window = _store.get(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotWindows/${WINDOW_ID}`);
    expect(window?.blackoutDates).toContain(OCCURRENCE);
  });

  it('cancels all confirmed bookings on the blacked-out date', async () => {
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
      COACH_A,
    ));
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_B, teamName: 'Team B' },
      COACH_B,
    ));

    await blackoutFn(makeReq({ leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, date: OCCURRENCE }, LM_UID));

    const docA = _store.get(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotSignups/${signupId(TEAM_A)}`);
    const docB = _store.get(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotSignups/${signupId(TEAM_B)}`);
    expect(docA?.status).toBe('cancelled');
    expect(docB?.status).toBe('cancelled');
  });

  it('deletes the ScheduledEvents for all cancelled bookings', async () => {
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
      COACH_A,
    ));
    const docA = _store.get(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotSignups/${signupId(TEAM_A)}`);
    const eventId = docA?.eventId as string;

    await blackoutFn(makeReq({ leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, date: OCCURRENCE }, LM_UID));

    expect(_store.has(`events/${eventId}`)).toBe(false);
  });

  it('also cancels waitlisted signups on the blacked-out date', async () => {
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
      COACH_A,
    ));
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_B, teamName: 'Team B' },
      COACH_B,
    ));
    seedDoc(`users/coach-c`, { role: 'coach', displayName: 'Carol' });
    seedDoc(`teams/teamC`, { coachId: 'coach-c', createdBy: 'coach-c', name: 'Team C' });
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: 'teamC', teamName: 'Team C' },
      'coach-c',
    ));

    // Verify teamC is waitlisted before blackout
    const waitlisted = _store.get(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotSignups/${WINDOW_ID}_${OCCURRENCE}_teamC`);
    expect(waitlisted?.status).toBe('waitlisted');

    await blackoutFn(makeReq({ leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, date: OCCURRENCE }, LM_UID));

    const afterBlackout = _store.get(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotSignups/${WINDOW_ID}_${OCCURRENCE}_teamC`);
    expect(afterBlackout?.status).toBe('cancelled');
  });

  it('notifies all affected coaches with practice_slot_blackout', async () => {
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
      COACH_A,
    ));
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_B, teamName: 'Team B' },
      COACH_B,
    ));

    await blackoutFn(makeReq({ leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, date: OCCURRENCE }, LM_UID));

    for (const coachUid of [COACH_A, COACH_B]) {
      const notifs = [..._store.entries()]
        .filter(([k]) => k.startsWith(`users/${coachUid}/notifications/`))
        .map(([, v]) => v);
      const blackoutNotif = notifs.find(n => n.type === 'practice_slot_blackout');
      expect(blackoutNotif).toBeDefined();
    }
  });

  it('returns the list of affected team names', async () => {
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_A, teamName: 'Team A' },
      COACH_A,
    ));
    await signUpFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, occurrenceDate: OCCURRENCE, teamId: TEAM_B, teamName: 'Team B' },
      COACH_B,
    ));

    const result = await blackoutFn(makeReq(
      { leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, date: OCCURRENCE },
      LM_UID,
    )) as { affectedTeams: string[] };

    expect(result.affectedTeams).toHaveLength(2);
    expect(result.affectedTeams).toContain('Team A');
    expect(result.affectedTeams).toContain('Team B');
  });

  it('rejects blackout from a non-LM user', async () => {
    await expect(
      blackoutFn(makeReq({ leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, date: OCCURRENCE }, COACH_A)),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects adding a date that is already blacked out', async () => {
    _store.set(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotWindows/${WINDOW_ID}`, {
      ..._store.get(`leagues/${LEAGUE}/seasons/${SEASON}/practiceSlotWindows/${WINDOW_ID}`)!,
      blackoutDates: [OCCURRENCE],
    });

    await expect(
      blackoutFn(makeReq({ leagueId: LEAGUE, seasonId: SEASON, windowId: WINDOW_ID, date: OCCURRENCE }, LM_UID)),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });
});
