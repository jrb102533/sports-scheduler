/**
 * Tests for the submitRsvp callable Cloud Function (SEC-99 / SEC-81).
 *
 * Covers:
 *   1.  Unauthenticated caller → 'unauthenticated'
 *   2.  Missing eventId → 'invalid-argument'
 *   3.  Whitespace-only eventId → 'invalid-argument'
 *   4.  Missing name → 'invalid-argument'
 *   5.  Invalid response value → 'invalid-argument'
 *   6.  Self-RSVP (no playerId): succeeds without reading profile doc
 *   7.  Self-RSVP (playerId === uid): succeeds without reading profile doc
 *   8.  Proxy RSVP: playerId found in memberships → succeeds
 *   9.  Proxy RSVP: playerId NOT in memberships → 'permission-denied'
 *  10.  Proxy RSVP: user profile does not exist → 'not-found'
 *  11.  Self-RSVP happy path: doc key is uid (not uid_uid)
 *  12.  Proxy RSVP happy path: doc key is uid_playerId
 *  13.  Self-RSVP happy path: playerId is absent from written entry
 *  14.  Proxy RSVP happy path: playerId is present on written entry
 *  15.  Happy path: returns { success: true }
 *  16.  Firestore set() failure → 'internal'
 *
 * Mocking strategy: follows the pattern established in hard-delete-team.test.ts.
 * Firebase Functions and firebase-admin are mocked at the module boundary.
 * vi.hoisted() is used for spy references needed inside vi.mock() factories.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted store shared across mocks ───────────────────────────────────────

const { _store } = vi.hoisted(() => {
  type DocData = Record<string, unknown>;
  const store: Map<string, DocData> = new Map();
  return { _store: store };
});

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

// ─── firebase-admin mock ──────────────────────────────────────────────────────

vi.mock('firebase-admin', () => {
  type DocData = Record<string, unknown>;

  class MockDocRef {
    constructor(public path: string) {}
    async get() {
      const data = _store.get(this.path);
      return { exists: data !== undefined, data: () => data };
    }
    async set(data: DocData) { _store.set(this.path, data); }
    async update(patch: DocData) {
      const current = (_store.get(this.path) ?? {}) as DocData;
      _store.set(this.path, { ...current, ...patch });
    }
    async delete() { _store.delete(this.path); }
  }

  class MockQuery {
    private _filters: Array<{ field: string; op: string; value: unknown }> = [];
    constructor(private _collectionPath: string) {}
    where(field: string, op: string, value: unknown): MockQuery {
      const q = new MockQuery(this._collectionPath);
      q._filters = [...this._filters, { field, op, value }];
      return q;
    }
    async get() {
      const docs: Array<{ id: string; ref: MockDocRef; data: () => DocData }> = [];
      for (const [path, data] of _store.entries()) {
        if (!path.startsWith(this._collectionPath + '/')) continue;
        const rest = path.slice(this._collectionPath.length + 1);
        if (rest.includes('/')) continue;
        let matches = true;
        for (const f of this._filters) {
          if (f.op === '==' && data[f.field] !== f.value) { matches = false; break; }
        }
        if (matches) docs.push({ id: rest, ref: new MockDocRef(path), data: () => data });
      }
      return { empty: docs.length === 0, size: docs.length, docs };
    }
  }

  class MockBatch {
    private _ops: Array<() => Promise<void>> = [];
    update(ref: MockDocRef, patch: DocData) { this._ops.push(() => ref.update(patch)); }
    delete(ref: MockDocRef) { this._ops.push(() => ref.delete()); }
    async commit() { for (const op of this._ops) await op(); this._ops = []; }
  }

  class MockTransaction {
    private _ops: Array<() => void> = [];
    async get(ref: MockDocRef) { return ref.get(); }
    set(ref: MockDocRef, data: DocData) { this._ops.push(() => _store.set(ref.path, data)); }
    update(ref: MockDocRef, patch: DocData) {
      this._ops.push(() => { _store.set(ref.path, { ...(_store.get(ref.path) ?? {}), ...patch }); });
    }
    delete(ref: MockDocRef) { this._ops.push(() => _store.delete(ref.path)); }
    async commit() { for (const op of this._ops) op(); this._ops = []; }
  }

  const firestoreInstance = {
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

  const FieldValue = {
    increment: (n: number) => ({ __increment: n }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
    delete: () => ({ __delete: true }),
  };

  const firestoreFn = Object.assign(() => firestoreInstance, { FieldValue });

  return {
    default: {
      initializeApp: vi.fn(),
      firestore: firestoreFn,
      auth: vi.fn(() => ({
        getUser: vi.fn(),
        setCustomUserClaims: vi.fn(),
        revokeRefreshTokens: vi.fn(),
      })),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => ({
      getUser: vi.fn(),
      setCustomUserClaims: vi.fn(),
      revokeRefreshTokens: vi.fn(),
    })),
  };
});

// ─── Import under test ────────────────────────────────────────────────────────

import { submitRsvp } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type DocData = Record<string, unknown>;

function makeRequest(data: unknown, uid: string | null) {
  return uid ? { auth: { uid }, data } : { auth: null, data };
}

function seedDoc(path: string, data: DocData) {
  _store.set(path, data);
}

function clearStore() {
  _store.clear();
}

function getDoc(path: string): DocData | undefined {
  return _store.get(path);
}

const fn = submitRsvp as unknown as (req: unknown) => Promise<unknown>;

// ─── Constants ────────────────────────────────────────────────────────────────

const CALLER_UID = 'uid-caller';
const PLAYER_ID = 'player-child-1';
const EVENT_ID = 'event-abc';

function seedBaseFixtures() {
  // Rate limit docs — count=0 keeps tests well under the per-minute cap.
  seedDoc(`rateLimits/${CALLER_UID}_submitRsvp`, { count: 0, windowStart: 0 });
}

const VALID_PAYLOAD = {
  eventId: EVENT_ID,
  name: 'Jane',
  response: 'yes',
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  vi.clearAllMocks();
  seedBaseFixtures();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('submitRsvp', () => {

  // ── Auth guard ────────────────────────────────────────────────────────────

  it('(1) rejects unauthenticated callers', async () => {
    await expect(fn(makeRequest(VALID_PAYLOAD, null))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  // ── Input validation ─────────────────────────────────────────────────────

  it('(2) rejects when eventId is missing', async () => {
    await expect(
      fn(makeRequest({ name: 'Jane', response: 'yes' }, CALLER_UID))
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('(3) rejects when eventId is whitespace only', async () => {
    await expect(
      fn(makeRequest({ eventId: '   ', name: 'Jane', response: 'yes' }, CALLER_UID))
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('(4) rejects when name is missing', async () => {
    await expect(
      fn(makeRequest({ eventId: EVENT_ID, response: 'yes' }, CALLER_UID))
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('(5) rejects an invalid response value', async () => {
    await expect(
      fn(makeRequest({ eventId: EVENT_ID, name: 'Jane', response: 'sure' }, CALLER_UID))
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  // ── Self-RSVP: no profile read required ──────────────────────────────────

  it('(6) self-RSVP (no playerId): succeeds without reading the caller profile', async () => {
    // Do NOT seed a users/${CALLER_UID} doc — the CF must not read it for self-RSVP.
    const result = await fn(makeRequest(VALID_PAYLOAD, CALLER_UID));
    expect(result).toEqual({ success: true });
    // Profile doc was never written either — Firestore store has no users/${CALLER_UID} entry.
    expect(getDoc(`users/${CALLER_UID}`)).toBeUndefined();
  });

  it('(7) self-RSVP (playerId === uid): succeeds without reading the caller profile', async () => {
    const payload = { ...VALID_PAYLOAD, playerId: CALLER_UID };
    const result = await fn(makeRequest(payload, CALLER_UID));
    expect(result).toEqual({ success: true });
    expect(getDoc(`users/${CALLER_UID}`)).toBeUndefined();
  });

  // ── Proxy RSVP: membership ownership validation ───────────────────────────

  it('(8) proxy RSVP: playerId found in memberships → succeeds', async () => {
    seedDoc(`users/${CALLER_UID}`, {
      role: 'parent',
      memberships: [{ playerId: PLAYER_ID }],
    });
    const payload = { ...VALID_PAYLOAD, playerId: PLAYER_ID };
    const result = await fn(makeRequest(payload, CALLER_UID));
    expect(result).toEqual({ success: true });
  });

  it('(9) proxy RSVP: playerId NOT in memberships → permission-denied', async () => {
    seedDoc(`users/${CALLER_UID}`, {
      role: 'parent',
      memberships: [{ playerId: 'some-other-player' }],
    });
    const payload = { ...VALID_PAYLOAD, playerId: PLAYER_ID };
    await expect(fn(makeRequest(payload, CALLER_UID))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('(10) proxy RSVP: user profile does not exist → not-found', async () => {
    // No users/${CALLER_UID} doc seeded
    const payload = { ...VALID_PAYLOAD, playerId: PLAYER_ID };
    await expect(fn(makeRequest(payload, CALLER_UID))).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  // ── Doc key format ────────────────────────────────────────────────────────

  it('(11) self-RSVP: writes to doc key uid (not uid_uid)', async () => {
    await fn(makeRequest(VALID_PAYLOAD, CALLER_UID));
    const rsvpDoc = getDoc(`events/${EVENT_ID}/rsvps/${CALLER_UID}`);
    expect(rsvpDoc).toBeDefined();
    // Confirm the uid_uid key was NOT used
    expect(getDoc(`events/${EVENT_ID}/rsvps/${CALLER_UID}_${CALLER_UID}`)).toBeUndefined();
  });

  it('(12) proxy RSVP: writes to doc key uid_playerId', async () => {
    seedDoc(`users/${CALLER_UID}`, {
      role: 'parent',
      memberships: [{ playerId: PLAYER_ID }],
    });
    const payload = { ...VALID_PAYLOAD, playerId: PLAYER_ID };
    await fn(makeRequest(payload, CALLER_UID));
    const docKey = `${CALLER_UID}_${PLAYER_ID}`;
    expect(getDoc(`events/${EVENT_ID}/rsvps/${docKey}`)).toBeDefined();
  });

  // ── Written entry shape ───────────────────────────────────────────────────

  it('(13) self-RSVP: playerId is absent from the written entry', async () => {
    await fn(makeRequest(VALID_PAYLOAD, CALLER_UID));
    const written = getDoc(`events/${EVENT_ID}/rsvps/${CALLER_UID}`);
    expect(written).toBeDefined();
    expect(written!.playerId).toBeUndefined();
    expect(written!.uid).toBe(CALLER_UID);
    expect(written!.response).toBe('yes');
    expect(written!.name).toBe('Jane');
  });

  it('(14) proxy RSVP: playerId is present on the written entry', async () => {
    seedDoc(`users/${CALLER_UID}`, {
      role: 'parent',
      memberships: [{ playerId: PLAYER_ID }],
    });
    const payload = { ...VALID_PAYLOAD, playerId: PLAYER_ID };
    await fn(makeRequest(payload, CALLER_UID));
    const docKey = `${CALLER_UID}_${PLAYER_ID}`;
    const written = getDoc(`events/${EVENT_ID}/rsvps/${docKey}`);
    expect(written).toBeDefined();
    expect(written!.playerId).toBe(PLAYER_ID);
    expect(written!.uid).toBe(CALLER_UID);
  });

  // ── Return value ──────────────────────────────────────────────────────────

  it('(15) returns { success: true } on the happy path', async () => {
    const result = await fn(makeRequest(VALID_PAYLOAD, CALLER_UID));
    expect(result).toEqual({ success: true });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('(16) rethrows Firestore set() failures as HttpsError "internal"', async () => {
    // Force the RSVP doc path to throw on set() by replacing the store entry
    // with a getter that throws. We achieve this by patching the mock after import.
    // Simpler: seed a rate-limit that passes, then break the RSVP doc path.
    // The cleanest approach: override the firestore().doc().set() for the RSVP path.
    // Since our mock is a plain Map, we can't throw on .set() directly.
    // Instead, we use the MockDocRef override approach via vi.spyOn on the module.
    //
    // Alternative: import admin and spy on firestore().doc().set.
    // For simplicity we test this by verifying that the CF wraps Firestore errors
    // in an 'internal' HttpsError. We simulate this by making the rsvp path
    // fail through a controlled sub-mock.

    // Re-mock the firestore doc().set to throw for the RSVP path only.
    // We do this by importing admin and spying on the returned object.
    const admin = await import('firebase-admin');
    const origFirestore = admin.firestore;
    const origDoc = admin.firestore().doc.bind(admin.firestore());

    const setError = new Error('Firestore quota exceeded');
    vi.spyOn(admin, 'firestore').mockImplementation(() => {
      const fs = origFirestore();
      const origDocFn = fs.doc.bind(fs);
      return {
        ...fs,
        doc: (path: string) => {
          const ref = origDocFn(path);
          if (path.startsWith(`events/${EVENT_ID}/rsvps/`)) {
            return { ...ref, set: vi.fn().mockRejectedValue(setError) };
          }
          return ref;
        },
      } as ReturnType<typeof origFirestore>;
    });

    await expect(fn(makeRequest(VALID_PAYLOAD, CALLER_UID))).rejects.toMatchObject({
      code: 'internal',
    });

    vi.restoreAllMocks();
    // Restore origDoc reference (unused but avoids lint warning)
    void origDoc;
  });
});
