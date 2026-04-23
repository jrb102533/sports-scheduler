/**
 * Unit tests for syncUserClaims (Firestore trigger) and refreshClaims (callable).
 *
 * syncUserClaims
 *   1.  Document created/updated with role='admin'     → setCustomUserClaims({ role: 'admin' })
 *   2.  Document created/updated with role='coach'     → setCustomUserClaims({ role: 'coach' })
 *   3.  Document created/updated with role=undefined   → setCustomUserClaims({ role: null })
 *   4.  Document deleted (after.exists = false)        → setCustomUserClaims({}) — claims cleared
 *   5.  setCustomUserClaims throws                     → logs error and re-throws (SEC-78: allow retry)
 *
 * refreshClaims
 *   6.  Unauthenticated caller                         → HttpsError('unauthenticated')
 *   7.  Authenticated, user doc has role='coach'       → setCustomUserClaims({ role: 'coach' }), returns { success: true }
 *   8.  Authenticated, user doc does not exist         → setCustomUserClaims({ role: null }), returns { success: true }
 *   9.  setCustomUserClaims throws inside refreshClaims → HttpsError('internal')
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted state shared between mock factories and tests ────────────────────
// vi.mock factories are hoisted to the top of the file by Vitest before any
// other code runs. Variables inside vi.hoisted() are also hoisted and can be
// referenced safely inside vi.mock() factories.

const { claimsStore, firestoreStore, mockSetCustomUserClaims, mockGetUser, mockRevokeRefreshTokens } = vi.hoisted(() => {
  const claimsStore = new Map<string, Record<string, unknown>>();
  const firestoreStore = new Map<string, Record<string, unknown>>();
  const mockSetCustomUserClaims = vi.fn(async (uid: string, claims: Record<string, unknown>) => {
    claimsStore.set(uid, claims);
  });
  const mockGetUser = vi.fn().mockResolvedValue({ uid: 'test', customClaims: {}, email: 'test@test.com' });
  const mockRevokeRefreshTokens = vi.fn().mockResolvedValue(undefined);
  return { claimsStore, firestoreStore, mockSetCustomUserClaims, mockGetUser, mockRevokeRefreshTokens };
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
  onDocumentWritten: vi.fn(
    (_doc: string, handler: (event: unknown) => Promise<unknown>) => handler,
  ),
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

// ─── Firebase Admin mock ──────────────────────────────────────────────────────

vi.mock('firebase-admin', () => {
  type DocData = Record<string, unknown>;

  class MockDocSnap {
    constructor(
      private _data: DocData | undefined,
      public exists: boolean,
    ) {}
    data() { return this._data; }
  }

  class MockDocRef {
    constructor(public path: string) {}
    async get() {
      const data = firestoreStore.get(this.path);
      return new MockDocSnap(data, data !== undefined);
    }
    async set(data: DocData) { firestoreStore.set(this.path, data); }
    async update(data: DocData) {
      if (!firestoreStore.has(this.path)) {
        throw Object.assign(new Error(`NOT_FOUND: ${this.path}`), { code: 5 });
      }
      firestoreStore.set(this.path, { ...firestoreStore.get(this.path), ...data });
    }
  }

  class MockCollectionRef {
    constructor(public path: string) {}
    doc(id: string) { return new MockDocRef(`${this.path}/${id}`); }
    where() { return { get: async () => ({ docs: [] }) }; }
    async get() { return { docs: [] }; }
  }

  const FieldValue = {
    increment: (n: number) => ({ __increment: n }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
    delete: () => ({ __delete: true }),
  };

  const mockDb = {
    doc: (path: string) => new MockDocRef(path),
    collection: (path: string) => new MockCollectionRef(path),
    batch: () => ({
      set: vi.fn(), update: vi.fn(), delete: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    }),
    runTransaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      const tx = {
        get: async (ref: MockDocRef) => ref.get(),
        set: (ref: MockDocRef, data: DocData) => { firestoreStore.set(ref.path, { ...data }); },
        update: (ref: MockDocRef, data: DocData) => {
          firestoreStore.set(ref.path, { ...(firestoreStore.get(ref.path) ?? {}), ...data });
        },
      };
      return cb(tx);
    },
    recursiveDelete: vi.fn().mockResolvedValue(undefined),
  };

  const firestoreFn = Object.assign(() => mockDb, { FieldValue });

  const authInstance = {
    setCustomUserClaims: mockSetCustomUserClaims,
    revokeRefreshTokens: mockRevokeRefreshTokens,
    getUser: mockGetUser,
    createUser: vi.fn().mockResolvedValue({ uid: 'new-uid' }),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    generatePasswordResetLink: vi.fn().mockResolvedValue('https://reset.link'),
    updateUser: vi.fn().mockResolvedValue({}),
  };

  return {
    default: {
      initializeApp: vi.fn(),
      firestore: firestoreFn,
      auth: vi.fn(() => authInstance),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => authInstance),
  };
});

// ─── Import under test (must come after vi.mock calls) ────────────────────────

import { syncUserClaims, refreshClaims } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type DocData = Record<string, unknown>;

function makeWriteEvent(uid: string, afterData: DocData | null) {
  const afterExists = afterData !== null;
  return {
    params: { uid },
    data: {
      after: {
        exists: afterExists,
        data: () => (afterExists ? afterData : undefined),
      },
    },
  };
}

function makeCallableRequest(uid: string | null) {
  return { auth: uid ? { uid } : null, data: {} };
}

// ─── syncUserClaims ───────────────────────────────────────────────────────────

describe('syncUserClaims', () => {
  beforeEach(() => {
    claimsStore.clear();
    firestoreStore.clear();
    mockSetCustomUserClaims.mockClear();
    mockRevokeRefreshTokens.mockClear();
  });

  it('sets role=admin when user doc has role=admin', async () => {
    const event = makeWriteEvent('uid-1', { role: 'admin', email: 'a@test.com' });
    await (syncUserClaims as unknown as (e: unknown) => Promise<void>)(event);
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('uid-1', { role: 'admin' });
  });

  it('sets role=coach when user doc has role=coach', async () => {
    const event = makeWriteEvent('uid-2', { role: 'coach', email: 'b@test.com' });
    await (syncUserClaims as unknown as (e: unknown) => Promise<void>)(event);
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('uid-2', { role: 'coach' });
  });

  it('sets role=null when user doc has no role field', async () => {
    const event = makeWriteEvent('uid-3', { email: 'c@test.com' });
    await (syncUserClaims as unknown as (e: unknown) => Promise<void>)(event);
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('uid-3', { role: null });
  });

  it('clears claims (calls setCustomUserClaims(uid, {})) when document is deleted', async () => {
    const event = makeWriteEvent('uid-4', null);
    await (syncUserClaims as unknown as (e: unknown) => Promise<void>)(event);
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('uid-4', {});
  });

  it('logs error and re-throws when setCustomUserClaims throws on write (SEC-78: allow platform retry)', async () => {
    const authError = new Error('Auth SDK unavailable');
    mockSetCustomUserClaims.mockRejectedValueOnce(authError);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const event = makeWriteEvent('uid-5', { role: 'coach' });
    await expect(
      (syncUserClaims as unknown as (e: unknown) => Promise<void>)(event)
    ).rejects.toThrow('Auth SDK unavailable');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('uid-5'),
      expect.any(String),
    );
    consoleSpy.mockRestore();
  });
});

// ─── refreshClaims ────────────────────────────────────────────────────────────

describe('refreshClaims', () => {
  beforeEach(() => {
    claimsStore.clear();
    firestoreStore.clear();
    mockSetCustomUserClaims.mockClear();
    mockGetUser.mockResolvedValue({ uid: 'test', customClaims: {}, email: 'test@test.com' });
  });

  it('throws unauthenticated when caller has no auth', async () => {
    const req = makeCallableRequest(null);
    await expect(
      (refreshClaims as unknown as (r: unknown) => Promise<unknown>)(req)
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('syncs role=coach from Firestore and returns { success: true }', async () => {
    firestoreStore.set('users/uid-coach', { role: 'coach', email: 'd@test.com' });
    const req = makeCallableRequest('uid-coach');
    const result = await (refreshClaims as unknown as (r: unknown) => Promise<unknown>)(req);
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('uid-coach', { role: 'coach' });
    expect(result).toEqual({ success: true });
  });

  it('syncs role=null when user doc does not exist', async () => {
    // SEC-79: getUser must return a non-null existing claim so the shortcut does not fire
    mockGetUser.mockResolvedValueOnce({ uid: 'uid-ghost', customClaims: { role: 'coach' }, email: '' });
    const req = makeCallableRequest('uid-ghost');
    const result = await (refreshClaims as unknown as (r: unknown) => Promise<unknown>)(req);
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('uid-ghost', { role: null });
    expect(result).toEqual({ success: true });
  });

  it('throws HttpsError internal when setCustomUserClaims fails', async () => {
    firestoreStore.set('users/uid-fail', { role: 'admin' });
    mockSetCustomUserClaims.mockRejectedValueOnce(new Error('quota exceeded'));
    const req = makeCallableRequest('uid-fail');
    await expect(
      (refreshClaims as unknown as (r: unknown) => Promise<unknown>)(req)
    ).rejects.toMatchObject({ code: 'internal' });
  });
});
