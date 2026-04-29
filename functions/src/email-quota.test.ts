/**
 * Tests for the Brevo daily email quota guard (`checkEmailQuota`).
 *
 * checkEmailQuota is not exported — it is exercised through the `sendEmail`
 * callable, which calls it before opening the SMTP connection.
 *
 * Coverage:
 *   1. At count 239 (below warn threshold): email sends, no console.error
 *   2. At count 240 (80% warn threshold): email sends AND console.error fires
 *   3. At count 285 (95% block threshold exactly): blocked, resource-exhausted thrown, counter rolled back
 *   4. At count 286 (above block threshold): blocked, resource-exhausted thrown, counter rolled back
 *
 * Constants:
 *   DAILY_LIMIT = 300
 *   WARN_THRESHOLD  = floor(300 * 0.80) = 240
 *   BLOCK_THRESHOLD = floor(300 * 0.95) = 285
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
  defineSecret: vi.fn(() => ({ value: vi.fn(() => 'test-secret-value-that-is-long-enough') })),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: vi.fn().mockResolvedValue({ messageId: 'test-message-id' }),
  })),
}));

// ─── Firestore mock infrastructure ───────────────────────────────────────────

type DocData = Record<string, unknown>;

interface IncrementSentinel { __increment: number; }
function isIncrementSentinel(v: unknown): v is IncrementSentinel {
  return typeof v === 'object' && v !== null && '__increment' in v;
}

// In-memory store — reset before each test.
const _store: Map<string, DocData> = new Map();

class MockDocRef {
  constructor(public path: string) {}

  get id(): string { return this.path.split('/').pop()!; }

  async get(): Promise<MockDocSnap> {
    return new MockDocSnap(this.path, _store.get(this.path));
  }

  async set(data: DocData, opts?: { merge?: boolean }): Promise<void> {
    const merge = opts?.merge ?? false;
    const existing: DocData = merge ? (_store.get(this.path) ?? {}) : {};
    const resolved: DocData = { ...existing };
    for (const [key, value] of Object.entries(data)) {
      if (isIncrementSentinel(value)) {
        resolved[key] = ((existing[key] as number) ?? 0) + value.__increment;
      } else if (value !== null && typeof value === 'object' && '__serverTimestamp' in value) {
        resolved[key] = new Date().toISOString();
      } else {
        resolved[key] = value;
      }
    }
    _store.set(this.path, resolved);
  }

  async update(data: DocData): Promise<void> {
    if (!_store.has(this.path)) {
      throw Object.assign(new Error(`NOT_FOUND: ${this.path}`), { code: 5 });
    }
    const existing = _store.get(this.path)!;
    const resolved: DocData = { ...existing };
    for (const [key, value] of Object.entries(data)) {
      if (isIncrementSentinel(value)) {
        resolved[key] = ((existing[key] as number) ?? 0) + value.__increment;
      } else {
        resolved[key] = value;
      }
    }
    _store.set(this.path, resolved);
  }

  async delete(): Promise<void> { _store.delete(this.path); }
}

class MockDocSnap {
  exists: boolean;
  ref: MockDocRef;
  constructor(public path: string, private _data: DocData | undefined) {
    this.exists = _data !== undefined;
    this.ref = new MockDocRef(path);
  }
  data(): DocData | undefined { return this._data; }
}

class MockCollectionSnap {
  constructor(public docs: MockDocSnap[]) {}
}

const mockDb = {
  doc: (path: string) => new MockDocRef(path),
  collection: (collectionPath: string) => ({
    doc: (id?: string) => new MockDocRef(`${collectionPath}/${id ?? 'auto'}`),
    get: async (): Promise<MockCollectionSnap> => {
      const prefix = `${collectionPath}/`;
      const docs = [..._store.entries()]
        .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map(([k, v]) => new MockDocSnap(k, v));
      return new MockCollectionSnap(docs);
    },
    where: () => ({
      get: async (): Promise<MockCollectionSnap> => new MockCollectionSnap([]),
    }),
  }),
  batch: () => ({
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
  }),
  runTransaction: async <T>(cb: (txn: unknown) => Promise<T>): Promise<T> => {
    const txn = {
      get: async (ref: MockDocRef) => ref.get(),
      set: (ref: MockDocRef, data: DocData, opts?: { merge?: boolean }) => {
        // Execute synchronously within the transaction callback.
        const merge = opts?.merge ?? false;
        const existing: DocData = merge ? (_store.get(ref.path) ?? {}) : {};
        const resolved: DocData = { ...existing };
        for (const [key, value] of Object.entries(data)) {
          if (isIncrementSentinel(value)) {
            resolved[key] = ((existing[key] as number) ?? 0) + value.__increment;
          } else if (value !== null && typeof value === 'object' && '__serverTimestamp' in value) {
            resolved[key] = new Date().toISOString();
          } else {
            resolved[key] = value;
          }
        }
        _store.set(ref.path, resolved);
      },
      update: (ref: MockDocRef, data: DocData) => {
        const existing = _store.get(ref.path) ?? {};
        const resolved: DocData = { ...existing };
        for (const [key, value] of Object.entries(data)) {
          if (isIncrementSentinel(value)) {
            resolved[key] = ((existing[key] as number) ?? 0) + value.__increment;
          } else {
            resolved[key] = value;
          }
        }
        _store.set(ref.path, resolved);
      },
    };
    return cb(txn);
  },
};

// ─── firebase-admin mock ──────────────────────────────────────────────────────

vi.mock('firebase-admin', () => {
  const FieldValue = {
    increment: (n: number) => ({ __increment: n }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
    delete: () => ({ __delete: true }),
  };
  const firestoreFn = Object.assign(() => mockDb, { FieldValue });

  const authInstance = {
    createUser: vi.fn().mockResolvedValue({ uid: 'test-uid' }),
    updateUser: vi.fn().mockResolvedValue({}),
    getUser: vi.fn().mockResolvedValue({ uid: 'test-uid', customClaims: null }),
    setCustomUserClaims: vi.fn().mockResolvedValue(undefined),
    revokeRefreshTokens: vi.fn().mockResolvedValue(undefined),
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

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (n: number) => ({ __increment: n }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
    delete: () => ({ __delete: true }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
  },
  FieldPath: {
    documentId: () => '__name__',
  },
}));

// Import AFTER mocks are registered.
import { sendEmail as _sendEmail } from './index';
const sendEmail = _sendEmail as unknown as (req: unknown) => Promise<unknown>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Seed the Firestore store so that the quota counter for today appears to
 * already be at `existingCount`. The sendEmail callable will increment by
 * `to.length` (1 by default) before sending.
 */
function seedQuotaCount(existingCount: number): void {
  const today = new Date().toISOString().slice(0, 10);
  _store.set(`system/emailQuota_${today}`, { count: existingCount });
}

function quotaCount(): number {
  const today = new Date().toISOString().slice(0, 10);
  return (_store.get(`system/emailQuota_${today}`)?.count as number) ?? 0;
}

/** Minimal admin caller request for sendEmail. */
function makeRequest(data: Record<string, unknown>) {
  return { auth: { uid: 'admin-uid' }, data };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('email quota guard', () => {
  beforeEach(() => {
    _store.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Seed the admin user profile so assertAdminOrCoach passes.
    _store.set('users/admin-uid', {
      uid: 'admin-uid',
      role: 'admin',
      memberships: [{ role: 'admin', isPrimary: true }],
    });
  });

  it('count 239 → email sends, no quota warning logged', async () => {
    seedQuotaCount(238); // 238 existing + 1 being sent = 239

    await sendEmail(makeRequest({
      to: ['user@example.com'],
      subject: 'Test',
      message: 'Hello world',
    }));

    expect(quotaCount()).toBe(239);
    const errorCalls = (console.error as ReturnType<typeof vi.spyOn>).mock.calls;
    const quotaWarning = errorCalls.find((args: unknown[]) =>
      typeof args[0] === 'string' && (args[0] as string).includes('[emailQuota] WARNING')
    );
    expect(quotaWarning).toBeUndefined();
  });

  it('count 240 (80% threshold) → email sends AND console.error quota warning fired', async () => {
    seedQuotaCount(239); // 239 existing + 1 being sent = 240 (exactly at warn threshold)

    await sendEmail(makeRequest({
      to: ['user@example.com'],
      subject: 'Test',
      message: 'Hello world',
    }));

    expect(quotaCount()).toBe(240);
    const errorCalls = (console.error as ReturnType<typeof vi.spyOn>).mock.calls;
    const quotaWarning = errorCalls.find((args: unknown[]) =>
      typeof args[0] === 'string' && (args[0] as string).includes('[emailQuota] WARNING')
    );
    expect(quotaWarning).toBeDefined();
    expect(quotaWarning![0]).toContain('240/300');
    expect(quotaWarning![0]).toContain('80%');
  });

  it('count 285 (95% block threshold) → throws resource-exhausted, counter rolled back', async () => {
    seedQuotaCount(284); // 284 existing + 1 being sent = 285 (exactly at block threshold)

    await expect(
      sendEmail(makeRequest({
        to: ['user@example.com'],
        subject: 'Test',
        message: 'Hello world',
      }))
    ).rejects.toMatchObject({ code: 'resource-exhausted' });

    // Counter should be rolled back to 284 (the increment is reversed).
    expect(quotaCount()).toBe(284);
  });

  it('count 286 (above block threshold) → throws resource-exhausted, counter rolled back', async () => {
    seedQuotaCount(285); // 285 existing + 1 being sent = 286 (above block threshold)

    await expect(
      sendEmail(makeRequest({
        to: ['user@example.com'],
        subject: 'Test',
        message: 'Hello world',
      }))
    ).rejects.toMatchObject({ code: 'resource-exhausted' });

    // Counter should be rolled back to 285.
    expect(quotaCount()).toBe(285);
  });

  it('multi-recipient send reserves slots equal to recipient count', async () => {
    seedQuotaCount(230); // 230 existing + 5 being sent = 235 (below warn threshold)

    await sendEmail(makeRequest({
      to: [
        'a@example.com',
        'b@example.com',
        'c@example.com',
        'd@example.com',
        'e@example.com',
      ],
      subject: 'Broadcast',
      message: 'Team update',
    }));

    expect(quotaCount()).toBe(235);
  });

  it('multi-recipient send blocked when batch would exceed threshold', async () => {
    // 280 existing + 10 being sent = 290 > 285 block threshold
    seedQuotaCount(280);

    await expect(
      sendEmail(makeRequest({
        to: Array.from({ length: 10 }, (_, i) => `player${i}@example.com`),
        subject: 'Big blast',
        message: 'Hello everyone',
      }))
    ).rejects.toMatchObject({ code: 'resource-exhausted' });

    // Counter rolled back to pre-call value.
    expect(quotaCount()).toBe(280);
  });
});
