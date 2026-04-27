/**
 * onTeamMessageCreated — throttle + lastMessageAt denorm tests
 *
 * The CF previously sent one email per opted-in team member per message. PR 1
 * adds two behaviors:
 *
 *  1. Always denorm `lastMessageAt: now` onto the team doc (drives the unread
 *     dot in the client; fire-and-forget, never blocks email sends).
 *  2. Throttle email sends per-recipient-per-team via
 *     `users/{uid}/messagingState/{teamId}.lastChatEmailedAt`. Skip recipients
 *     whose last chat email for this team was within
 *     TEAM_CHAT_EMAIL_THROTTLE_MS (1h).
 *
 * Tests cover the load-bearing invariants:
 *   - First message ever for a team → email sent + throttle state written
 *   - Second message <1h after → email skipped, throttle state unchanged
 *   - Second message >1h after → email sent + throttle state refreshed
 *   - Sender excluded; opted-out recipients excluded (regression guard)
 *   - team.lastMessageAt is updated regardless of recipient eligibility
 *   - Send failure does NOT advance throttle (next message retries)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Firebase Functions mocks (return handlers so tests can call them) ───────

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn((_opts: unknown, handler: unknown) => handler),
  onDocumentUpdated: vi.fn((_opts: unknown, handler: unknown) => handler),
  onDocumentWritten: vi.fn((_opts: unknown, handler: unknown) => handler),
}));
vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: vi.fn((_opts: unknown, handler: unknown) => handler),
}));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((handlerOrOptions: unknown, maybeHandler?: unknown) =>
    typeof maybeHandler === 'function' ? maybeHandler : handlerOrOptions),
  onRequest: vi.fn((opts: unknown, handler?: unknown) =>
    typeof handler === 'function' ? handler : opts),
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message); this.name = 'HttpsError'; this.code = code;
    }
  },
}));
vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn(() => ({ value: vi.fn(() => '') })),
}));
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn().mockImplementation(() => ({})) }));

// ─── nodemailer — capture sendMail calls + control resolved/rejected outcome ──

const sendMailMock = vi.fn().mockResolvedValue({});

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

// ─── Firestore mock infrastructure ───────────────────────────────────────────

interface DocData { [key: string]: unknown }

// In-memory store keyed by full doc path. Tests seed via seedDoc/seedUsers.
const _store = new Map<string, DocData>();

function seedDoc(path: string, data: DocData): void {
  _store.set(path, { ...data });
}

function makeDocRef(path: string) {
  return {
    path,
    async get() {
      const data = _store.get(path);
      return { exists: data !== undefined, data: () => data };
    },
    async update(patch: DocData) {
      const existing = _store.get(path) ?? {};
      _store.set(path, { ...existing, ...patch });
    },
    async set(patch: DocData, opts?: { merge?: boolean }) {
      const existing = opts?.merge ? (_store.get(path) ?? {}) : {};
      _store.set(path, { ...existing, ...patch });
    },
  };
}

function makeCollectionRef(collectionPath: string) {
  return {
    where(field: string, op: string, value: unknown) {
      return {
        async get() {
          const docs: Array<{ id: string; data: () => DocData }> = [];
          for (const [path, data] of _store.entries()) {
            if (!path.startsWith(collectionPath + '/')) continue;
            // Only direct children, not deeper subcollection docs
            const rest = path.slice(collectionPath.length + 1);
            if (rest.includes('/')) continue;
            if (op === '==' && data[field] === value) {
              docs.push({ id: rest, data: () => data });
            }
          }
          return { docs };
        },
      };
    },
    doc(id: string) {
      return makeDocRef(`${collectionPath}/${id}`);
    },
  };
}

const mockDb = {
  doc(path: string) { return makeDocRef(path); },
  collection(name: string) { return makeCollectionRef(name); },
  // getAll(...refs) returns snapshot per ref in the same order — used by the
  // throttle to batch-read messagingState docs for all recipients.
  async getAll(...refs: ReturnType<typeof makeDocRef>[]) {
    return Promise.all(refs.map(r => r.get()));
  },
};

vi.mock('firebase-admin', () => {
  const FieldValue = {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    increment: (n: number) => ({ __increment: n }),
    arrayUnion: (...vs: unknown[]) => ({ __arrayUnion: vs }),
  };
  const firestoreFn = Object.assign(() => mockDb, { FieldValue });
  return {
    default: { initializeApp: vi.fn(), firestore: firestoreFn },
    initializeApp: vi.fn(),
    firestore: firestoreFn,
  };
});

// Import AFTER mocks
import { onTeamMessageCreated, TEAM_CHAT_EMAIL_THROTTLE_MS } from './index';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEAM_ID = 'team-1';
const SENDER_UID = 'sender-1';
const RECIP_UID = 'recip-1';
const RECIP2_UID = 'recip-2';

function makeEvent(text = 'Hello team') {
  return {
    data: { data: () => ({ senderId: SENDER_UID, senderName: 'Coach', text }) },
    params: { teamId: TEAM_ID },
  } as unknown as Parameters<typeof onTeamMessageCreated>[0];
}

function seedBaseline(): void {
  seedDoc(`teams/${TEAM_ID}`, { name: 'Lions' });
  seedDoc(`users/${SENDER_UID}`, { uid: SENDER_UID, teamId: TEAM_ID, email: 'sender@x.com', displayName: 'Sender' });
  seedDoc(`users/${RECIP_UID}`, { uid: RECIP_UID, teamId: TEAM_ID, email: 'r1@x.com', displayName: 'R1' });
}

beforeEach(() => {
  _store.clear();
  sendMailMock.mockClear();
  sendMailMock.mockResolvedValue({});
});

// ─── lastMessageAt denorm ─────────────────────────────────────────────────────

describe('onTeamMessageCreated — lastMessageAt denorm', () => {
  it('updates team.lastMessageAt to a fresh ISO timestamp', async () => {
    seedBaseline();
    const before = new Date().toISOString();

    await onTeamMessageCreated(makeEvent());

    const team = _store.get(`teams/${TEAM_ID}`);
    expect(typeof team?.lastMessageAt).toBe('string');
    // ISO strings are lexicographically sortable; >= compares as a string
    expect((team!.lastMessageAt as string) >= before).toBe(true);
  });

  it('still updates lastMessageAt when no recipients are eligible', async () => {
    // Only the sender exists on the team — no eligible recipients
    seedDoc(`teams/${TEAM_ID}`, { name: 'Lions' });
    seedDoc(`users/${SENDER_UID}`, { uid: SENDER_UID, teamId: TEAM_ID, email: 'sender@x.com', displayName: 'Sender' });

    await onTeamMessageCreated(makeEvent());

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(typeof _store.get(`teams/${TEAM_ID}`)?.lastMessageAt).toBe('string');
  });
});

// ─── Throttle behavior ────────────────────────────────────────────────────────

describe('onTeamMessageCreated — email throttle', () => {
  it('sends an email on the first message and writes throttle state', async () => {
    seedBaseline();

    await onTeamMessageCreated(makeEvent());

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ to: expect.stringContaining('r1@x.com') }));
    const state = _store.get(`users/${RECIP_UID}/messagingState/${TEAM_ID}`);
    expect(typeof state?.lastChatEmailedAt).toBe('string');
  });

  it('skips a second email within the throttle window', async () => {
    seedBaseline();
    // Pre-seed a recent throttle state (5 min ago)
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    seedDoc(`users/${RECIP_UID}/messagingState/${TEAM_ID}`, { lastChatEmailedAt: fiveMinAgo });

    await onTeamMessageCreated(makeEvent());

    expect(sendMailMock).not.toHaveBeenCalled();
    // Throttle state stays at the seeded value (not advanced because no email was sent)
    expect(_store.get(`users/${RECIP_UID}/messagingState/${TEAM_ID}`)?.lastChatEmailedAt).toBe(fiveMinAgo);
  });

  it('sends a second email when the throttle window has elapsed', async () => {
    seedBaseline();
    // Pre-seed a stale throttle state (over the 1h window)
    const beyondWindow = new Date(Date.now() - TEAM_CHAT_EMAIL_THROTTLE_MS - 60_000).toISOString();
    seedDoc(`users/${RECIP_UID}/messagingState/${TEAM_ID}`, { lastChatEmailedAt: beyondWindow });

    await onTeamMessageCreated(makeEvent());

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    // Throttle state advanced past the original
    expect(_store.get(`users/${RECIP_UID}/messagingState/${TEAM_ID}`)?.lastChatEmailedAt).not.toBe(beyondWindow);
  });

  it('throttles per-team independently (same recipient gets emails for two different teams)', async () => {
    const TEAM_A = 'team-A';
    const TEAM_B = 'team-B';
    seedDoc(`teams/${TEAM_A}`, { name: 'A' });
    seedDoc(`teams/${TEAM_B}`, { name: 'B' });
    // Recipient is on both teams (legacy single teamId — set to A; we just
    // need them returned by the where query for each team).
    seedDoc(`users/${RECIP_UID}`, { uid: RECIP_UID, teamId: TEAM_A, email: 'r@x.com', displayName: 'R' });
    // Throttled for team A only
    seedDoc(`users/${RECIP_UID}/messagingState/${TEAM_A}`, { lastChatEmailedAt: new Date().toISOString() });

    // Message in team A → throttled
    await onTeamMessageCreated({
      data: { data: () => ({ senderId: SENDER_UID, senderName: 'X', text: 'a' }) },
      params: { teamId: TEAM_A },
    } as unknown as Parameters<typeof onTeamMessageCreated>[0]);
    expect(sendMailMock).not.toHaveBeenCalled();

    // For team B, recipient must be returned by where(teamId == TEAM_B). Re-seed.
    seedDoc(`users/${RECIP_UID}`, { uid: RECIP_UID, teamId: TEAM_B, email: 'r@x.com', displayName: 'R' });
    await onTeamMessageCreated({
      data: { data: () => ({ senderId: SENDER_UID, senderName: 'X', text: 'b' }) },
      params: { teamId: TEAM_B },
    } as unknown as Parameters<typeof onTeamMessageCreated>[0]);
    // Team B has no throttle state → email sent
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('throttles per-recipient independently (one throttled, one fresh)', async () => {
    seedBaseline();
    seedDoc(`users/${RECIP2_UID}`, { uid: RECIP2_UID, teamId: TEAM_ID, email: 'r2@x.com', displayName: 'R2' });
    // R1 is throttled; R2 has no state → R2 should still get email
    seedDoc(`users/${RECIP_UID}/messagingState/${TEAM_ID}`, { lastChatEmailedAt: new Date().toISOString() });

    await onTeamMessageCreated(makeEvent());

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ to: expect.stringContaining('r2@x.com') }));
  });

  it('does NOT advance throttle state when the email send fails', async () => {
    seedBaseline();
    sendMailMock.mockRejectedValueOnce(new Error('SMTP down'));

    await onTeamMessageCreated(makeEvent());

    // No throttle write because the per-send try wraps state-update after sendMail
    expect(_store.has(`users/${RECIP_UID}/messagingState/${TEAM_ID}`)).toBe(false);
  });
});

// ─── Regression guards (preserve existing behavior) ──────────────────────────

describe('onTeamMessageCreated — preserved exclusions', () => {
  it('excludes the sender from recipients', async () => {
    seedBaseline();
    // Sender's own user doc IS on the team but should be filtered out
    await onTeamMessageCreated(makeEvent());
    // Only RECIP_UID gets email; sender does not
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).not.toHaveBeenCalledWith(expect.objectContaining({ to: expect.stringContaining('sender@x.com') }));
  });

  it('excludes recipients with messagingNotificationsEnabled === false', async () => {
    seedBaseline();
    // Override RECIP_UID with opted-out
    seedDoc(`users/${RECIP_UID}`, { uid: RECIP_UID, teamId: TEAM_ID, email: 'r1@x.com', displayName: 'R1', messagingNotificationsEnabled: false });

    await onTeamMessageCreated(makeEvent());

    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('still includes recipients with messagingNotificationsEnabled undefined (default-on)', async () => {
    seedBaseline();
    // RECIP_UID has no messagingNotificationsEnabled field → treated as true

    await onTeamMessageCreated(makeEvent());

    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });
});
