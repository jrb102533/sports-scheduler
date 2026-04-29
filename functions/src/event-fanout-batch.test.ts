/**
 * fetchTeamsAndPlayersForEvents — unit tests
 *
 * The helper batch-reads teams + players referenced by a set of event docs,
 * eliminating the per-event re-reads that used to happen in sendEventReminders
 * and sendRsvpFollowups. Tests verify:
 *   - Returns empty maps when no events / no teamIds
 *   - Deduplicates teamIds across events (only ONE team-read per unique team)
 *   - Chunks team reads at the Firestore IN-query limit (30)
 *   - Maps players to their teamId correctly
 *   - Tolerates missing/empty teamIds on event docs
 *   - Returns empty player array for teams that exist but have no players
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Firebase Functions / Admin mocks ────────────────────────────────────────

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((handlerOrOptions: unknown, maybeHandler?: (req: unknown) => unknown) =>
    typeof maybeHandler === 'function' ? maybeHandler : handlerOrOptions),
  onRequest: vi.fn((handler: unknown) => handler),
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message); this.name = 'HttpsError'; this.code = code;
    }
  },
}));
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn(), onDocumentUpdated: vi.fn(), onDocumentWritten: vi.fn(),
}));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: vi.fn() }));
vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn(() => ({ value: vi.fn(() => '') })),
}));
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn().mockImplementation(() => ({})) }));
vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) })),
}));

// ─── Firestore mock infrastructure ───────────────────────────────────────────

interface DocData { [key: string]: unknown }
interface FakeDoc { id: string; data(): DocData }

// Per-collection in-memory store + recorded query log so tests can assert on
// the exact `where` calls the helper makes (essential for verifying batching).
const _teams = new Map<string, DocData>();
const _players = new Map<string, DocData>();
const queryLog: Array<{ collection: string; field: string; op: string; values: string[] }> = [];

function makeQuery(collectionName: string, store: Map<string, DocData>) {
  return {
    where(fieldPath: unknown, op: string, values: unknown) {
      const fieldKey = typeof fieldPath === 'object' && fieldPath !== null && '__id' in fieldPath
        ? '__id'
        : (fieldPath as string);
      const valueList = Array.isArray(values) ? values as string[] : [values as string];
      queryLog.push({ collection: collectionName, field: fieldKey, op, values: valueList });

      return {
        async get() {
          const docs: FakeDoc[] = [];
          if (fieldKey === '__id') {
            for (const id of valueList) {
              if (store.has(id)) docs.push({ id, data: () => store.get(id)! });
            }
          } else {
            for (const [id, data] of store.entries()) {
              const v = (data as Record<string, unknown>)[fieldKey];
              if (op === 'in' && valueList.includes(v as string)) {
                docs.push({ id, data: () => data });
              } else if (op === '==' && v === valueList[0]) {
                docs.push({ id, data: () => data });
              }
            }
          }
          return { docs };
        },
      };
    },
  };
}

const mockFirestore = {
  collection(name: string) {
    if (name === 'teams') return makeQuery('teams', _teams);
    if (name === 'players') return makeQuery('players', _players);
    throw new Error(`Unexpected collection: ${name}`);
  },
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

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (n: number) => ({ __increment: n }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
    delete: () => ({ __delete: true }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
  },
  FieldPath: {
    // Must match what the mockFirestore.where() sentinel check expects: { __id: true }
    documentId: () => ({ __id: true }),
  },
}));

// Import after mocks
import { fetchTeamsAndPlayersForEvents, FIRESTORE_IN_QUERY_LIMIT } from './index';

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeEventDoc(id: string, teamIds: string[]): { id: string; data(): DocData } {
  return { id, data: () => ({ teamIds }) };
}

function seedTeam(id: string, name: string): void {
  _teams.set(id, { name });
}

function seedPlayer(id: string, teamId: string, firstName = 'Test'): void {
  _players.set(id, { teamId, firstName, lastName: 'Player' });
}

beforeEach(() => {
  _teams.clear();
  _players.clear();
  queryLog.length = 0;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('fetchTeamsAndPlayersForEvents', () => {
  it('returns empty maps when no events provided', async () => {
    const { teamsById, playersByTeamId } = await fetchTeamsAndPlayersForEvents([] as never);
    expect(teamsById.size).toBe(0);
    expect(playersByTeamId.size).toBe(0);
    expect(queryLog).toHaveLength(0);
  });

  it('returns empty maps when no events have teamIds', async () => {
    const events = [makeEventDoc('e1', []), makeEventDoc('e2', [])];
    const { teamsById, playersByTeamId } = await fetchTeamsAndPlayersForEvents(events as never);
    expect(teamsById.size).toBe(0);
    expect(playersByTeamId.size).toBe(0);
    expect(queryLog).toHaveLength(0);
  });

  it('reads each unique team exactly ONCE across many events (the whole point)', async () => {
    seedTeam('t1', 'Lions');
    seedTeam('t2', 'Tigers');

    // 5 events, all referencing the same 2 teams
    const events = [
      makeEventDoc('e1', ['t1']),
      makeEventDoc('e2', ['t2']),
      makeEventDoc('e3', ['t1', 't2']),
      makeEventDoc('e4', ['t1']),
      makeEventDoc('e5', ['t2']),
    ];

    const { teamsById } = await fetchTeamsAndPlayersForEvents(events as never);

    expect(teamsById.size).toBe(2);
    expect(teamsById.get('t1')?.name).toBe('Lions');
    expect(teamsById.get('t2')?.name).toBe('Tigers');

    const teamQueries = queryLog.filter(q => q.collection === 'teams');
    expect(teamQueries).toHaveLength(1);
    // Both teamIds in a single batch
    expect(new Set(teamQueries[0].values)).toEqual(new Set(['t1', 't2']));
  });

  it('chunks team queries at the 30-id IN-query limit', async () => {
    expect(FIRESTORE_IN_QUERY_LIMIT).toBe(30);

    // Seed 35 unique teams across 35 events
    for (let i = 0; i < 35; i++) {
      seedTeam(`t${i}`, `Team ${i}`);
    }
    const events = Array.from({ length: 35 }, (_, i) => makeEventDoc(`e${i}`, [`t${i}`]));

    const { teamsById } = await fetchTeamsAndPlayersForEvents(events as never);

    expect(teamsById.size).toBe(35);
    const teamQueries = queryLog.filter(q => q.collection === 'teams');
    expect(teamQueries).toHaveLength(2);          // 30 + 5
    expect(teamQueries[0].values).toHaveLength(30);
    expect(teamQueries[1].values).toHaveLength(5);
  });

  it('groups players by teamId', async () => {
    seedTeam('t1', 'Lions');
    seedTeam('t2', 'Tigers');
    seedPlayer('p1', 't1', 'Alice');
    seedPlayer('p2', 't1', 'Bob');
    seedPlayer('p3', 't2', 'Carol');

    const events = [makeEventDoc('e1', ['t1', 't2'])];
    const { playersByTeamId } = await fetchTeamsAndPlayersForEvents(events as never);

    expect(playersByTeamId.get('t1')?.map(d => d.id).sort()).toEqual(['p1', 'p2']);
    expect(playersByTeamId.get('t2')?.map(d => d.id)).toEqual(['p3']);
  });

  it('returns empty player array for teams with no players (not undefined)', async () => {
    seedTeam('t1', 'Lions');
    // No players for t1

    const events = [makeEventDoc('e1', ['t1'])];
    const { playersByTeamId } = await fetchTeamsAndPlayersForEvents(events as never);

    expect(playersByTeamId.has('t1')).toBe(true);
    expect(playersByTeamId.get('t1')).toEqual([]);
  });

  it('tolerates events with non-string or empty teamIds', async () => {
    seedTeam('t1', 'Lions');
    seedPlayer('p1', 't1');

    const events = [
      makeEventDoc('e1', ['t1']),
      { id: 'e2', data: () => ({ teamIds: [null, '', undefined, 't1'] }) }, // mixed garbage
      { id: 'e3', data: () => ({ /* no teamIds */ }) },
    ];

    const { teamsById, playersByTeamId } = await fetchTeamsAndPlayersForEvents(events as never);

    expect(teamsById.size).toBe(1);
    expect(playersByTeamId.get('t1')?.map(d => d.id)).toEqual(['p1']);
  });

  it('drops nothing — every distinct teamId across events is fetched, regardless of per-event count', async () => {
    // Even if a single event references 30+ teams, the helper itself doesn't
    // truncate. (The CFs that consume the result preserve the legacy 10-team
    // cap on a SINGLE event for parity, but that's their concern.)
    for (let i = 0; i < 32; i++) seedTeam(`t${i}`, `Team ${i}`);
    const events = [
      makeEventDoc('e1', Array.from({ length: 32 }, (_, i) => `t${i}`)),
    ];

    const { teamsById } = await fetchTeamsAndPlayersForEvents(events as never);

    expect(teamsById.size).toBe(32);
  });
});
