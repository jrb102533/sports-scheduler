/**
 * Unit tests for submitRsvp (callable Cloud Function).
 *
 * SEC-81: validates server-side playerId ownership before writing to the
 * /events/{eventId}/rsvps/{uid}_{playerId} subcollection.
 *
 * submitRsvp
 *   1.  Unauthenticated caller                          → HttpsError('unauthenticated')
 *   2.  Missing eventId                                 → HttpsError('invalid-argument')
 *   3.  Missing playerId                                → HttpsError('invalid-argument')
 *   4.  Invalid status value                            → HttpsError('invalid-argument')
 *   5.  User profile not found                          → HttpsError('not-found')
 *   6.  playerId NOT in caller memberships              → HttpsError('permission-denied')
 *   7.  playerId in caller memberships                  → writes rsvp doc, returns { success: true }
 *   8.  Optional note is stored when provided           → rsvp doc includes note field
 *   9.  Empty/whitespace note is omitted from doc       → rsvp doc excludes note field
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted state shared between mock factories and tests ────────────────────

const { firestoreStore, mockSetDoc, mockGetDoc } = vi.hoisted(() => {
  const firestoreStore = new Map<string, Record<string, unknown>>();

  const mockSetDoc = vi.fn(async (path: string, data: Record<string, unknown>) => {
    firestoreStore.set(path, data);
  });

  const mockGetDoc = vi.fn(async (path: string) => {
    const data = firestoreStore.get(path);
    return {
      exists: data !== undefined,
      data: () => data,
    };
  });

  return { firestoreStore, mockSetDoc, mockGetDoc };
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
    async set(data: DocData) {
      await mockSetDoc(this.path, data);
    }
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

  const Timestamp = {
    now: () => ({ seconds: 1700000000, nanoseconds: 0, toDate: () => new Date() }),
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

  const firestoreFn = Object.assign(() => mockDb, { FieldValue, Timestamp });

  const authInstance = {
    setCustomUserClaims: vi.fn().mockResolvedValue(undefined),
    revokeRefreshTokens: vi.fn().mockResolvedValue(undefined),
    getUser: vi.fn().mockResolvedValue({ uid: 'test', customClaims: {}, email: 'test@test.com' }),
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

import { submitRsvp } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCallableRequest(
  uid: string | null,
  data: Record<string, unknown> = {},
) {
  return { auth: uid ? { uid } : null, data };
}

const VALID_DATA = {
  eventId: 'event-abc',
  playerId: 'player-xyz',
  status: 'yes' as const,
};

// ─── submitRsvp ───────────────────────────────────────────────────────────────

describe('submitRsvp', () => {
  beforeEach(() => {
    firestoreStore.clear();
    mockSetDoc.mockClear();
  });

  it('throws unauthenticated when caller has no auth', async () => {
    const req = makeCallableRequest(null, VALID_DATA);
    await expect(
      (submitRsvp as unknown as (r: unknown) => Promise<unknown>)(req)
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('throws invalid-argument when eventId is missing', async () => {
    const req = makeCallableRequest('uid-1', { playerId: 'p1', status: 'yes' });
    await expect(
      (submitRsvp as unknown as (r: unknown) => Promise<unknown>)(req)
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('throws invalid-argument when playerId is missing', async () => {
    const req = makeCallableRequest('uid-1', { eventId: 'e1', status: 'yes' });
    await expect(
      (submitRsvp as unknown as (r: unknown) => Promise<unknown>)(req)
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('throws invalid-argument when status is not a valid value', async () => {
    const req = makeCallableRequest('uid-1', { eventId: 'e1', playerId: 'p1', status: 'attending' });
    await expect(
      (submitRsvp as unknown as (r: unknown) => Promise<unknown>)(req)
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('throws not-found when caller user profile does not exist', async () => {
    // No user doc seeded — profile lookup returns exists=false
    const req = makeCallableRequest('uid-no-profile', VALID_DATA);
    await expect(
      (submitRsvp as unknown as (r: unknown) => Promise<unknown>)(req)
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('throws permission-denied when playerId is not in caller memberships (SEC-81)', async () => {
    firestoreStore.set('users/uid-parent', {
      memberships: [
        { role: 'parent', playerId: 'player-MY-CHILD', teamId: 'team-1' },
      ],
    });
    const req = makeCallableRequest('uid-parent', {
      eventId: 'event-abc',
      playerId: 'player-SOMEONE-ELSES-CHILD',
      status: 'yes',
    });
    await expect(
      (submitRsvp as unknown as (r: unknown) => Promise<unknown>)(req)
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('writes RSVP doc and returns { success: true } when playerId is in memberships', async () => {
    firestoreStore.set('users/uid-parent', {
      memberships: [
        { role: 'parent', playerId: 'player-xyz', teamId: 'team-1' },
      ],
    });
    const req = makeCallableRequest('uid-parent', VALID_DATA);
    const result = await (submitRsvp as unknown as (r: unknown) => Promise<unknown>)(req);

    expect(result).toEqual({ success: true });
    expect(mockSetDoc).toHaveBeenCalledOnce();

    const [writtenPath, writtenData] = mockSetDoc.mock.calls[0] as [string, Record<string, unknown>];
    expect(writtenPath).toBe('events/event-abc/rsvps/uid-parent_player-xyz');
    expect(writtenData).toMatchObject({
      uid: 'uid-parent',
      playerId: 'player-xyz',
      status: 'yes',
      submittedBy: 'uid-parent',
    });
    expect(writtenData).toHaveProperty('updatedAt');
    expect(writtenData).not.toHaveProperty('note');
  });

  it('includes note field in RSVP doc when a non-empty note is provided', async () => {
    firestoreStore.set('users/uid-parent', {
      memberships: [{ role: 'parent', playerId: 'player-xyz', teamId: 'team-1' }],
    });
    const req = makeCallableRequest('uid-parent', { ...VALID_DATA, note: 'Running 5 min late' });
    await (submitRsvp as unknown as (r: unknown) => Promise<unknown>)(req);

    const [, writtenData] = mockSetDoc.mock.calls[0] as [string, Record<string, unknown>];
    expect(writtenData.note).toBe('Running 5 min late');
  });

  it('omits note field from RSVP doc when note is empty or whitespace only', async () => {
    firestoreStore.set('users/uid-parent', {
      memberships: [{ role: 'parent', playerId: 'player-xyz', teamId: 'team-1' }],
    });
    const req = makeCallableRequest('uid-parent', { ...VALID_DATA, note: '   ' });
    await (submitRsvp as unknown as (r: unknown) => Promise<unknown>)(req);

    const [, writtenData] = mockSetDoc.mock.calls[0] as [string, Record<string, unknown>];
    expect(writtenData).not.toHaveProperty('note');
  });
});
