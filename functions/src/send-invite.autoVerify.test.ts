/**
 * Tests that sendInvite writes autoVerify: true to the invite document.
 *
 * This is the contract that verifyInvitedUser relies on when a new user
 * signs up via an invite link: if autoVerify is true on the invite, the CF
 * will pre-verify their email and skip the verification-email flow.
 *
 * Coverage:
 *   1. sendInvite writes autoVerify: true to the invite doc
 *   2. autoVerify is a boolean true, not a truthy string
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// ─── Firestore mock ───────────────────────────────────────────────────────────

type DocData = Record<string, unknown>;

interface ArrayUnionSentinel {
  __arrayUnion: unknown[];
}

function isArrayUnionSentinel(v: unknown): v is ArrayUnionSentinel {
  return typeof v === 'object' && v !== null && '__arrayUnion' in v;
}

const _store: Map<string, DocData> = new Map();

class MockDocRef {
  constructor(public path: string) {}

  async get(): Promise<MockDocSnap> {
    const data = _store.get(this.path);
    return new MockDocSnap(this.path, data);
  }

  async set(data: DocData, opts?: unknown): Promise<void> {
    const merge = !!(opts && (opts as Record<string, unknown>).merge);
    const existing: DocData = merge ? (_store.get(this.path) ?? {}) : {};
    const resolved: DocData = { ...existing };

    for (const [key, value] of Object.entries(data)) {
      if (isArrayUnionSentinel(value)) {
        const current = Array.isArray(existing[key]) ? (existing[key] as unknown[]) : [];
        const merged = [...current];
        for (const v of value.__arrayUnion) {
          if (!merged.includes(v)) merged.push(v);
        }
        resolved[key] = merged;
      } else {
        resolved[key] = value;
      }
    }
    _store.set(this.path, resolved);
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
  async get(): Promise<{ empty: boolean; docs: unknown[] }> {
    return { empty: true, docs: [] };
  }
}

const mockDb = {
  doc: (path: string) => new MockDocRef(path),
  collection: (path: string) => new MockQuery(path),
  batch: vi.fn(),
  runTransaction: vi.fn(),
};

vi.mock('firebase-admin', () => {
  const FieldValue = {
    increment: (n: number) => ({ __increment: n }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
    delete: () => ({ __delete: true }),
  };
  const firestoreFn = Object.assign(() => mockDb, { FieldValue });
  return {
    default: {
      initializeApp: vi.fn(),
      firestore: firestoreFn,
      auth: vi.fn(() => ({
        createUser: vi.fn(),
        getUserByEmail: vi.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
        updateUser: vi.fn().mockResolvedValue({}),
      })),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => ({
      createUser: vi.fn(),
      getUserByEmail: vi.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
      updateUser: vi.fn().mockResolvedValue({}),
    })),
  };
});

import { sendInvite } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fn = sendInvite as unknown as (req: unknown) => Promise<unknown>;

function makeRequest(uid: string) {
  return {
    auth: { uid },
    data: {
      to: 'player@example.com',
      playerName: 'Alice Smith',
      teamName: 'Falcons',
      playerId: 'player1',
      teamId: 'team1',
    },
  };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

beforeEach(() => {
  _store.clear();
  seedDoc('users/coach1', { role: 'coach' });
  // SEC-22: team doc required so coach1 passes the team-ownership check.
  seedDoc('teams/team1', { coachId: 'coach1', name: 'Falcons' });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sendInvite — autoVerify field', () => {

  it('(1) writes autoVerify: true to the invite document', async () => {
    await fn(makeRequest('coach1'));

    // SEC-20: invite key is now composite email_teamId_role.
    const invite = _store.get('invites/player@example.com_team1_player');
    expect(invite).toBeDefined();
    expect(invite?.autoVerify).toBe(true);
  });

  it('(2) autoVerify is a boolean true, not a truthy string', async () => {
    await fn(makeRequest('coach1'));

    const invite = _store.get('invites/player@example.com_team1_player');
    expect(typeof invite?.autoVerify).toBe('boolean');
    expect(invite?.autoVerify).toStrictEqual(true);
  });
});
