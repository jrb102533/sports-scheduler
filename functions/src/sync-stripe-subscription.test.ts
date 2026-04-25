/**
 * Unit tests for FW-63 — Stripe subscription → user doc sync + JWT claim derivation.
 *
 * syncStripeSubscriptionToUser
 *   1.  active sub      → user doc subscriptionTier = 'league_manager_pro', expiresAt set
 *   2.  trialing sub    → user doc subscriptionTier = 'league_manager_pro'
 *   3.  past_due sub    → user doc subscriptionTier = 'league_manager_pro' (7-day grace)
 *   4.  canceled sub    → user doc subscriptionTier = 'free'
 *   5.  incomplete sub  → user doc subscriptionTier = 'free'
 *   6.  multiple subs (one active, one canceled) → picks active, tier = pro
 *   7.  no subs at all  → tier = 'free'
 *
 * syncUserClaims (FW-63 additions)
 *   8.  subscriptionTier='league_manager_pro'  → claims include subscription='league_manager_pro'
 *   9.  adminGrantedLM=true                    → claims include subscription='league_manager_pro' (bypass)
 *   10. tier='free' AND adminGrantedLM=false   → no subscription claim, just { role }
 *   11. both tier=pro AND adminGrantedLM=true  → claims include subscription (no double-set)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted state ────────────────────────────────────────────────────────────

const { firestoreStore, subscriptionsStore, mockSetCustomUserClaims, mockGetUser, mockRevokeRefreshTokens } = vi.hoisted(() => {
  const firestoreStore = new Map<string, Record<string, unknown>>();
  const subscriptionsStore = new Map<string, Array<Record<string, unknown>>>();
  const mockSetCustomUserClaims = vi.fn(async () => {});
  const mockGetUser = vi.fn().mockResolvedValue({ uid: 'test', customClaims: {}, email: 'test@test.com' });
  const mockRevokeRefreshTokens = vi.fn().mockResolvedValue(undefined);
  return { firestoreStore, subscriptionsStore, mockSetCustomUserClaims, mockGetUser, mockRevokeRefreshTokens };
});

// ─── Firebase Functions mocks ─────────────────────────────────────────────────

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((handlerOrOptions: unknown, maybeHandler?: (req: unknown) => unknown) =>
    typeof maybeHandler === 'function' ? maybeHandler : handlerOrOptions),
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
  onDocumentWritten: vi.fn((_doc: string | object, handler: (event: unknown) => Promise<unknown>) => handler),
}));

vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: vi.fn() }));

vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn(() => ({ value: vi.fn(() => '') })),
}));

vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn().mockImplementation(() => ({})) }));

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) })),
}));

// ─── Firebase Admin mock ──────────────────────────────────────────────────────

vi.mock('firebase-admin', () => {
  type DocData = Record<string, unknown>;

  class MockDocSnap {
    constructor(private _data: DocData | undefined, public exists: boolean, public id?: string) {}
    data() { return this._data; }
  }

  class MockDocRef {
    constructor(public path: string) {}
    async get() {
      const data = firestoreStore.get(this.path);
      return new MockDocSnap(data, data !== undefined);
    }
    async set(data: DocData, opts?: { merge?: boolean }) {
      if (opts?.merge && firestoreStore.has(this.path)) {
        firestoreStore.set(this.path, { ...firestoreStore.get(this.path), ...data });
      } else {
        firestoreStore.set(this.path, data);
      }
    }
    async update(data: DocData) {
      firestoreStore.set(this.path, { ...(firestoreStore.get(this.path) ?? {}), ...data });
    }
  }

  class MockCollectionRef {
    constructor(public path: string) {}
    doc(id: string) { return new MockDocRef(`${this.path}/${id}`); }
    where() { return { get: async () => ({ docs: [] }) }; }
    async get() {
      const subs = subscriptionsStore.get(this.path) ?? [];
      return {
        docs: subs.map((s, i) => new MockDocSnap(s, true, `sub-${i}`)),
      };
    }
  }

  const FieldValue = {
    increment: (n: number) => ({ __increment: n }),
    arrayUnion: (...v: unknown[]) => ({ __arrayUnion: v }),
    arrayRemove: (...v: unknown[]) => ({ __arrayRemove: v }),
    delete: () => ({ __delete: true }),
  };

  const mockDb = {
    doc: (path: string) => new MockDocRef(path),
    collection: (path: string) => new MockCollectionRef(path),
    batch: () => ({ set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) }),
    runTransaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb({}),
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
    default: { initializeApp: vi.fn(), firestore: firestoreFn, auth: vi.fn(() => authInstance) },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
    auth: vi.fn(() => authInstance),
  };
});

// ─── Imports under test ───────────────────────────────────────────────────────

import { syncUserClaims, syncStripeSubscriptionToUser } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStripeWriteEvent(uid: string, subId: string) {
  return {
    params: { uid, subId },
    data: {
      after: { exists: true, data: () => ({}) },
      before: { exists: false, data: () => undefined },
    },
  };
}

function makeUserWriteEvent(
  uid: string,
  afterData: Record<string, unknown> | null,
  beforeData: Record<string, unknown> | null = null,
) {
  const exists = afterData !== null;
  const beforeExists = beforeData !== null;
  return {
    params: { uid },
    data: {
      after: { exists, data: () => (exists ? afterData : undefined) },
      before: { exists: beforeExists, data: () => (beforeExists ? beforeData : undefined) },
    },
  };
}

function fakeTimestamp(iso: string) {
  return { toDate: () => new Date(iso) };
}

// ─── syncStripeSubscriptionToUser ─────────────────────────────────────────────

describe('syncStripeSubscriptionToUser (FW-63)', () => {
  beforeEach(() => {
    firestoreStore.clear();
    subscriptionsStore.clear();
    mockSetCustomUserClaims.mockClear();
  });

  it('writes tier=league_manager_pro for an active subscription', async () => {
    subscriptionsStore.set('customers/uid-1/subscriptions', [
      { status: 'active', current_period_end: fakeTimestamp('2026-12-01T00:00:00.000Z') },
    ]);
    await (syncStripeSubscriptionToUser as unknown as (e: unknown) => Promise<void>)(
      makeStripeWriteEvent('uid-1', 'sub_abc'),
    );
    expect(firestoreStore.get('users/uid-1')).toMatchObject({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'active',
      subscriptionExpiresAt: '2026-12-01T00:00:00.000Z',
    });
  });

  it('writes tier=league_manager_pro for a trialing subscription', async () => {
    subscriptionsStore.set('customers/uid-2/subscriptions', [
      { status: 'trialing', current_period_end: fakeTimestamp('2026-05-09T00:00:00.000Z') },
    ]);
    await (syncStripeSubscriptionToUser as unknown as (e: unknown) => Promise<void>)(
      makeStripeWriteEvent('uid-2', 'sub_abc'),
    );
    expect(firestoreStore.get('users/uid-2')).toMatchObject({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'trialing',
    });
  });

  it('writes tier=league_manager_pro for past_due (within 7-day grace per FW-58)', async () => {
    subscriptionsStore.set('customers/uid-3/subscriptions', [
      { status: 'past_due', current_period_end: fakeTimestamp('2026-04-30T00:00:00.000Z') },
    ]);
    await (syncStripeSubscriptionToUser as unknown as (e: unknown) => Promise<void>)(
      makeStripeWriteEvent('uid-3', 'sub_abc'),
    );
    expect(firestoreStore.get('users/uid-3')).toMatchObject({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'past_due',
    });
  });

  it('writes tier=free for a canceled subscription', async () => {
    subscriptionsStore.set('customers/uid-4/subscriptions', [
      { status: 'canceled', current_period_end: fakeTimestamp('2026-04-01T00:00:00.000Z') },
    ]);
    await (syncStripeSubscriptionToUser as unknown as (e: unknown) => Promise<void>)(
      makeStripeWriteEvent('uid-4', 'sub_abc'),
    );
    expect(firestoreStore.get('users/uid-4')).toMatchObject({
      subscriptionTier: 'free',
      subscriptionStatus: 'canceled',
    });
  });

  it('writes tier=free for incomplete subscription', async () => {
    subscriptionsStore.set('customers/uid-5/subscriptions', [
      { status: 'incomplete' },
    ]);
    await (syncStripeSubscriptionToUser as unknown as (e: unknown) => Promise<void>)(
      makeStripeWriteEvent('uid-5', 'sub_abc'),
    );
    expect(firestoreStore.get('users/uid-5')).toMatchObject({
      subscriptionTier: 'free',
      subscriptionStatus: 'incomplete',
    });
  });

  it('picks the entitling subscription when the customer has multiple', async () => {
    subscriptionsStore.set('customers/uid-6/subscriptions', [
      { status: 'canceled', current_period_end: fakeTimestamp('2026-01-01T00:00:00.000Z') },
      { status: 'active', current_period_end: fakeTimestamp('2026-12-01T00:00:00.000Z') },
    ]);
    await (syncStripeSubscriptionToUser as unknown as (e: unknown) => Promise<void>)(
      makeStripeWriteEvent('uid-6', 'sub_abc'),
    );
    expect(firestoreStore.get('users/uid-6')).toMatchObject({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'active',
      subscriptionExpiresAt: '2026-12-01T00:00:00.000Z',
    });
  });

  it('writes tier=free with status=canceled when no subscriptions exist', async () => {
    await (syncStripeSubscriptionToUser as unknown as (e: unknown) => Promise<void>)(
      makeStripeWriteEvent('uid-7', 'sub_abc'),
    );
    expect(firestoreStore.get('users/uid-7')).toMatchObject({
      subscriptionTier: 'free',
      subscriptionStatus: 'canceled',
    });
  });
});

// ─── syncUserClaims — FW-63 subscription claim derivation ────────────────────

describe('syncUserClaims — subscription claim (FW-63)', () => {
  beforeEach(() => {
    firestoreStore.clear();
    subscriptionsStore.clear();
    mockSetCustomUserClaims.mockClear();
    mockRevokeRefreshTokens.mockClear();
  });

  it('sets subscription claim when subscriptionTier=league_manager_pro', async () => {
    await (syncUserClaims as unknown as (e: unknown) => Promise<void>)(
      makeUserWriteEvent('uid-pro', { role: 'league_manager', subscriptionTier: 'league_manager_pro' }),
    );
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('uid-pro', {
      role: 'league_manager',
      subscription: 'league_manager_pro',
    });
  });

  it('sets subscription claim via adminGrantedLM bypass even when tier=free', async () => {
    await (syncUserClaims as unknown as (e: unknown) => Promise<void>)(
      makeUserWriteEvent('uid-comp', { role: 'league_manager', subscriptionTier: 'free', adminGrantedLM: true }),
    );
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('uid-comp', {
      role: 'league_manager',
      subscription: 'league_manager_pro',
    });
  });

  it('omits subscription claim when tier=free AND adminGrantedLM is not true', async () => {
    await (syncUserClaims as unknown as (e: unknown) => Promise<void>)(
      makeUserWriteEvent('uid-free', { role: 'coach', subscriptionTier: 'free' }),
    );
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('uid-free', { role: 'coach' });
  });

  it('sets a single subscription claim when both tier=pro and adminGrantedLM=true', async () => {
    await (syncUserClaims as unknown as (e: unknown) => Promise<void>)(
      makeUserWriteEvent('uid-both', { role: 'league_manager', subscriptionTier: 'league_manager_pro', adminGrantedLM: true }),
    );
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('uid-both', {
      role: 'league_manager',
      subscription: 'league_manager_pro',
    });
  });

  // SEC-85: revoke refresh tokens on subscription downgrade so stale Pro tokens
  // are limited to the remaining ID-token TTL (~1h) instead of refresh-token life.
  it('revokes refresh tokens on subscription downgrade (Pro → free)', async () => {
    await (syncUserClaims as unknown as (e: unknown) => Promise<void>)(
      makeUserWriteEvent(
        'uid-cancel',
        { role: 'league_manager', subscriptionTier: 'free' },
        { role: 'league_manager', subscriptionTier: 'league_manager_pro' },
      ),
    );
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('uid-cancel');
  });

  it('revokes refresh tokens when adminGrantedLM is removed', async () => {
    await (syncUserClaims as unknown as (e: unknown) => Promise<void>)(
      makeUserWriteEvent(
        'uid-comp-revoked',
        { role: 'league_manager', subscriptionTier: 'free', adminGrantedLM: false },
        { role: 'league_manager', subscriptionTier: 'free', adminGrantedLM: true },
      ),
    );
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('uid-comp-revoked');
  });

  it('does NOT revoke refresh tokens on subscription upgrade (free → Pro)', async () => {
    await (syncUserClaims as unknown as (e: unknown) => Promise<void>)(
      makeUserWriteEvent(
        'uid-upgrade',
        { role: 'league_manager', subscriptionTier: 'league_manager_pro' },
        { role: 'league_manager', subscriptionTier: 'free' },
      ),
    );
    expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('does NOT revoke refresh tokens when subscription stays the same', async () => {
    await (syncUserClaims as unknown as (e: unknown) => Promise<void>)(
      makeUserWriteEvent(
        'uid-stable',
        { role: 'league_manager', subscriptionTier: 'league_manager_pro' },
        { role: 'league_manager', subscriptionTier: 'league_manager_pro' },
      ),
    );
    expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
  });
});
