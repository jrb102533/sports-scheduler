/**
 * SEC-91 (FW-64) — assertSubscribedOrAdmin server-side paywall enforcement
 *
 * Closes the gap where 5 LM-only callable Cloud Functions used the Admin SDK
 * to bypass Firestore rules and could be called by canceled LM accounts.
 *
 * Note: assertSubscribedOrAdmin is not exported, so we test it indirectly
 * through the simplest gated callable (deleteLeague). The matrix is identical
 * for all 5 callables since they share the same helper.
 *
 * Cases:
 *   1. admin (no subscription)         → passes (admin override)
 *   2. league_manager + tier=pro       → passes
 *   3. league_manager + adminGrantedLM → passes (comp bypass)
 *   4. league_manager + tier=free      → throws permission-denied
 *   5. league_manager + status=past_due tier=pro → passes (mirror written by sync)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { firestoreStore, mockHttpsErrorCtor } = vi.hoisted(() => {
  const firestoreStore = new Map<string, Record<string, unknown>>();
  class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { firestoreStore, mockHttpsErrorCtor: HttpsError };
});

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((handlerOrOptions: unknown, maybeHandler?: (req: unknown) => unknown) =>
    typeof maybeHandler === 'function' ? maybeHandler : handlerOrOptions),
  onRequest: vi.fn((h: unknown) => h),
  HttpsError: mockHttpsErrorCtor,
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn(),
  onDocumentUpdated: vi.fn(),
  onDocumentWritten: vi.fn(),
}));

vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: vi.fn() }));

vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn(() => ({ value: vi.fn(() => '') })),
}));

vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn().mockImplementation(() => ({})) }));

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) })),
}));

vi.mock('firebase-admin', () => {
  type DocData = Record<string, unknown>;

  class MockDocSnap {
    constructor(private _data: DocData | undefined, public exists: boolean) {}
    data() { return this._data; }
  }

  class MockDocRef {
    constructor(public path: string) {}
    async get() {
      const data = firestoreStore.get(this.path);
      return new MockDocSnap(data, data !== undefined);
    }
    async set(d: DocData) { firestoreStore.set(this.path, d); }
    async update(d: DocData) { firestoreStore.set(this.path, { ...(firestoreStore.get(this.path) ?? {}), ...d }); }
  }

  class MockCollectionRef {
    constructor(public path: string) {}
    doc(id: string) { return new MockDocRef(`${this.path}/${id}`); }
    where() { return { get: async () => ({ docs: [] }) }; }
    async get() { return { docs: [] }; }
  }

  const mockDb = {
    doc: (path: string) => new MockDocRef(path),
    collection: (path: string) => new MockCollectionRef(path),
    batch: () => ({ set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) }),
    runTransaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      const tx = {
        get: async (ref: MockDocRef) => ref.get(),
        set: (ref: MockDocRef, d: DocData) => { firestoreStore.set(ref.path, { ...d }); },
        update: (ref: MockDocRef, d: DocData) => {
          firestoreStore.set(ref.path, { ...(firestoreStore.get(ref.path) ?? {}), ...d });
        },
      };
      return cb(tx);
    },
    recursiveDelete: vi.fn().mockResolvedValue(undefined),
  };

  const firestoreFn = Object.assign(() => mockDb, {
    FieldValue: {
      increment: (n: number) => ({ __increment: n }),
      arrayUnion: (...v: unknown[]) => ({ __arrayUnion: v }),
      arrayRemove: (...v: unknown[]) => ({ __arrayRemove: v }),
      delete: () => ({ __delete: true }),
    },
  });

  return {
    default: {
      initializeApp: vi.fn(),
      firestore: firestoreFn,
      auth: vi.fn(() => ({
        setCustomUserClaims: vi.fn(),
        revokeRefreshTokens: vi.fn(),
        getUser: vi.fn().mockResolvedValue({ customClaims: {} }),
      })),
    },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => ({
      setCustomUserClaims: vi.fn(),
      revokeRefreshTokens: vi.fn(),
      getUser: vi.fn().mockResolvedValue({ customClaims: {} }),
    })),
  };
});

import { deleteLeague } from './index';

beforeEach(() => firestoreStore.clear());

function setupLeagueAndUser(uid: string, userData: Record<string, unknown>) {
  firestoreStore.set('users/' + uid, userData);
  firestoreStore.set('leagues/lg1', {
    name: 'Test League',
    managerIds: [uid],
    isDeleted: false,
  });
  firestoreStore.set('rateLimits/deleteLeague_' + uid, {});
}

function makeRequest(uid: string) {
  return { auth: { uid }, data: { leagueId: 'lg1' } };
}

describe('SEC-91 — assertSubscribedOrAdmin paywall enforcement (via deleteLeague)', () => {
  it('admin without subscription PASSES (admin override)', async () => {
    setupLeagueAndUser('admin-1', { role: 'admin' });
    await expect(
      (deleteLeague as unknown as (r: unknown) => Promise<unknown>)(makeRequest('admin-1')),
    ).resolves.toMatchObject({ success: true });
  });

  it('league_manager with subscriptionTier=league_manager_pro PASSES', async () => {
    setupLeagueAndUser('lm-1', { role: 'league_manager', subscriptionTier: 'league_manager_pro' });
    await expect(
      (deleteLeague as unknown as (r: unknown) => Promise<unknown>)(makeRequest('lm-1')),
    ).resolves.toMatchObject({ success: true });
  });

  it('league_manager with adminGrantedLM=true PASSES (comp bypass)', async () => {
    setupLeagueAndUser('lm-comp', { role: 'league_manager', subscriptionTier: 'free', adminGrantedLM: true });
    await expect(
      (deleteLeague as unknown as (r: unknown) => Promise<unknown>)(makeRequest('lm-comp')),
    ).resolves.toMatchObject({ success: true });
  });

  it('league_manager with tier=free THROWS permission-denied', async () => {
    setupLeagueAndUser('lm-free', { role: 'league_manager', subscriptionTier: 'free' });
    await expect(
      (deleteLeague as unknown as (r: unknown) => Promise<unknown>)(makeRequest('lm-free')),
    ).rejects.toMatchObject({
      code: 'permission-denied',
      message: expect.stringContaining('League Manager Pro subscription'),
    });
  });

  it('league_manager with no subscription fields at all THROWS permission-denied', async () => {
    setupLeagueAndUser('lm-empty', { role: 'league_manager' });
    await expect(
      (deleteLeague as unknown as (r: unknown) => Promise<unknown>)(makeRequest('lm-empty')),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
