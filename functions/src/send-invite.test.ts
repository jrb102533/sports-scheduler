/**
 * Tests for the sendInvite callable Cloud Function.
 *
 * Covers the allowlist write introduced in fix/invite-allowlist:
 * sendInvite now writes the invited email to system/signupConfig.allowedEmails
 * via arrayUnion so the invitee can register when signups are restricted.
 *
 * Coverage:
 *   1. Unauthenticated caller → 'unauthenticated'
 *   2. Player-role caller → 'permission-denied'
 *   3. Missing email → 'invalid-argument'
 *   4. Happy path: invite doc written to invites/{email}
 *   5. Happy path: email added to system/signupConfig.allowedEmails via arrayUnion
 *   6. Email is normalised to lowercase before write
 *   7. A second invite for the same email does not duplicate — arrayUnion semantics
 *   8. Invite for a different address does not clobber an existing allowlist entry
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

// ─── Firestore mock infrastructure ───────────────────────────────────────────
//
// arrayUnion is modelled as a sentinel that MockDocRef.set() resolves when the
// merge option is true.  The sentinel carries the values to union so the
// in-memory store ends up with a real array — this lets tests assert on the
// stored value rather than just on the sentinel object.

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
        // Resolve arrayUnion: merge new values into the existing array.
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

  async get(): Promise<MockQuerySnap> {
    const docs: Array<{ id: string; ref: MockDocRef; data: () => DocData }> = [];
    for (const [path, data] of _store.entries()) {
      if (!path.startsWith(this._collectionPath + '/')) continue;
      const rest = path.slice(this._collectionPath.length + 1);
      if (rest.includes('/')) continue;
      let matches = true;
      for (const f of this._filters) {
        if (f.op === '==' && (data as Record<string, unknown>)[f.field] !== f.value) {
          matches = false;
          break;
        }
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

class MockTransaction {
  private _ops: Array<() => void> = [];

  async get(ref: MockDocRef): Promise<MockDocSnap> {
    return ref.get();
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
  runTransaction: async <T>(cb: (tx: MockTransaction) => Promise<T>): Promise<T> => {
    const tx = new MockTransaction();
    const result = await cb(tx);
    await tx.commit();
    return result;
  },
};

// ─── firebase-admin mock ──────────────────────────────────────────────────────
// FieldValue is declared inline to avoid TDZ: vi.mock factories are hoisted
// before any const/let in source order.  mockDb is declared above so it is safe
// to reference here.

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
      auth: vi.fn(() => ({ createUser: vi.fn() })),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => ({ createUser: vi.fn() })),
  };
});

// Import the function under test AFTER all mocks are registered.
import { sendInvite } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type SendInviteData = {
  to: string;
  playerName: string;
  teamName: string;
  playerId: string;
  teamId: string;
};

function makeRequest(data: unknown, uid: string | null) {
  return uid ? { auth: { uid }, data } : { auth: null, data };
}

function validData(overrides: Partial<SendInviteData> = {}): SendInviteData {
  return {
    to: 'player@example.com',
    playerName: 'Alice Smith',
    teamName: 'Falcons',
    playerId: 'player1',
    teamId: 'team1',
    ...overrides,
  };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
}

const fn = sendInvite as unknown as (req: unknown) => Promise<unknown>;

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  seedDoc('users/coach1', { role: 'coach' });
  seedDoc('users/admin1', { role: 'admin' });
  seedDoc('users/player1', { role: 'player' });
});

// ─── sendInvite tests ─────────────────────────────────────────────────────────

describe('sendInvite', () => {

  // ── Auth / role guards ────────────────────────────────────────────────────

  it('(1) rejects unauthenticated callers', async () => {
    await expect(fn(makeRequest(validData(), null))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('(2) rejects callers with player role', async () => {
    await expect(fn(makeRequest(validData(), 'player1'))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  // ── Input validation ─────────────────────────────────────────────────────

  it('(3) rejects when the email address is empty', async () => {
    await expect(
      fn(makeRequest(validData({ to: '   ' }), 'coach1')),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  // ── Invite document write ─────────────────────────────────────────────────

  it('(4) writes the invite record to invites/{normalizedEmail}', async () => {
    await fn(makeRequest(validData({ to: 'Player@Example.COM' }), 'coach1'));

    const stored = _store.get('invites/player@example.com');
    expect(stored).toBeDefined();
    expect(stored?.playerId).toBe('player1');
    expect(stored?.teamId).toBe('team1');
    expect(stored?.playerName).toBe('Alice Smith');
    expect(stored?.teamName).toBe('Falcons');
  });

  // ── Allowlist write (new behaviour in fix/invite-allowlist) ───────────────

  it('(5) adds the invited email to system/signupConfig.allowedEmails', async () => {
    await fn(makeRequest(validData({ to: 'player@example.com' }), 'coach1'));

    const config = _store.get('system/signupConfig');
    expect(config).toBeDefined();
    expect(config?.allowedEmails).toEqual(expect.arrayContaining(['player@example.com']));
  });

  it('(6) normalises the invited email to lowercase before writing to allowlist', async () => {
    await fn(makeRequest(validData({ to: 'PLAYER@EXAMPLE.COM' }), 'coach1'));

    const config = _store.get('system/signupConfig');
    const list = config?.allowedEmails as string[];
    expect(list).toContain('player@example.com');
    expect(list).not.toContain('PLAYER@EXAMPLE.COM');
  });

  it('(7) does not duplicate an email already on the allowlist', async () => {
    // Pre-seed the allowlist with the same address.
    seedDoc('system/signupConfig', { allowedEmails: ['player@example.com'] });

    // Invite the same player a second time.
    await fn(makeRequest(validData({ to: 'player@example.com' }), 'coach1'));

    const list = (_store.get('system/signupConfig')?.allowedEmails as string[]) ?? [];
    const count = list.filter((e) => e === 'player@example.com').length;
    expect(count).toBe(1);
  });

  it('(8) preserves existing allowlist entries when a new invite is sent', async () => {
    seedDoc('system/signupConfig', { allowedEmails: ['existing@example.com'] });

    await fn(makeRequest(validData({ to: 'newplayer@example.com' }), 'coach1'));

    const list = (_store.get('system/signupConfig')?.allowedEmails as string[]) ?? [];
    expect(list).toContain('existing@example.com');
    expect(list).toContain('newplayer@example.com');
  });
});
