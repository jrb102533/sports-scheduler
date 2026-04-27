/**
 * sendScheduledNotifications — unit tests (Phase C, FW-85)
 *
 * Tests cover:
 *   - Shadow mode: logs but does not call sendMail
 *   - Day-before reminder: sent when event.date==tomorrow && !dayBeforeSent
 *   - Game-day reminder: sent when event.date==today && !gameDaySent
 *   - Snack reminder: sent when event.date==in2days && snackSlot/slot unclaimed && !snackReminderSent
 *                     (fail-closed on snackSlot read failure)
 *   - RSVP follow-up: sent to unresponded recipients only when event.date==tomorrow && !rsvpFollowupSent
 *   - Idempotency: not sent when flag already set
 *   - Events with no recipients are skipped
 *   - shouldRunScheduledJobs() guard: returns early when disabled
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Firebase Functions / Admin mocks ─────────────────────────────────────────

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((h: unknown) => h),
  onRequest: vi.fn((h: unknown) => h),
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.name = 'HttpsError'; this.code = code; }
  },
}));
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn(),
  onDocumentUpdated: vi.fn(),
  onDocumentWritten: vi.fn(),
}));

// Capture all registered handlers so we can find sendScheduledNotifications.
// vi.hoisted() ensures this runs before the vi.mock factory so the variable
// is initialized when the factory closure runs.
const { capturedHandlers } = vi.hoisted(() => ({
  capturedHandlers: [] as Array<() => Promise<void>>,
}));
vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: vi.fn((_opts: unknown, handler: () => Promise<void>) => {
    capturedHandlers.push(handler);
    return handler;
  }),
}));

vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn(() => ({ value: vi.fn(() => 'test-secret') })),
}));
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn().mockImplementation(() => ({})) }));

// Mock ENV to control shouldRunScheduledJobs per test.
const { mockShouldRun } = vi.hoisted(() => ({ mockShouldRun: { value: true } }));
vi.mock('./env', () => ({
  ENV: {
    isStaging: () => false,
    isProduction: () => true,
    isEmulator: () => false,
    shouldRunScheduledJobs: () => mockShouldRun.value,
  },
}));

// Capture sendMail calls for assertions.
const sendMailMock = vi.fn().mockResolvedValue({});
vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
}));

// ─── Firestore mock ────────────────────────────────────────────────────────────

interface DocData { [key: string]: unknown }

const _events: Array<{ id: string; data: DocData; ref: { update: ReturnType<typeof vi.fn> } }> = [];
const updateMocks: Array<{ id: string; data: DocData }> = [];

/**
 * Per-event snackSlot data. Set in tests to control the snack reminder branch.
 *   undefined     → no snackSlot doc exists (legacy / no snack tracking) — reminder fires
 *   { claimedBy: '' | null } → slot exists but unclaimed — reminder fires
 *   { claimedBy: 'someone' } → claimed — reminder skipped
 *   'THROW'       → simulate read failure — reminder skipped (fail-closed)
 */
const _snackSlots = new Map<string, { claimedBy?: string | null } | 'THROW'>();

/**
 * Per-event RSVP subcollection docs (FW-90a).
 * Key: eventId. Value: array of RSVP subcollection docs or 'THROW' to simulate a read error.
 * Each doc may carry uid, email, and/or playerId for deduplication.
 */
interface RsvpSubDoc { uid?: string; email?: string; playerId?: string; response?: string }
const _rsvpSubcollection = new Map<string, RsvpSubDoc[] | 'THROW'>();

function makeEventDoc(id: string, data: DocData) {
  const updateFn = vi.fn((d: DocData) => {
    updateMocks.push({ id, data: d });
    return Promise.resolve();
  });
  return { id, data, ref: { update: updateFn } };
}

const mockFirestore = {
  collection(name: string) {
    // Route subcollection reads: events/{eventId}/rsvps
    const subcollMatch = name.match(/^events\/([^/]+)\/rsvps$/);
    if (subcollMatch) {
      const eventId = subcollMatch[1];
      return {
        async get() {
          const entry = _rsvpSubcollection.get(eventId);
          if (entry === 'THROW') throw new Error('mocked rsvp subcollection read failure');
          const docs = (entry ?? []).map((d, i) => ({
            id: `rsvp-doc-${i}`,
            data: () => d,
          }));
          return { empty: docs.length === 0, size: docs.length, docs };
        },
      };
    }

    // Default: events top-level query with where() chaining.
    let _conditions: Array<{ field: string; op: string; values: unknown[] }> = [];
    const obj = {
      where(field: string, op: string, values: unknown) {
        _conditions.push({ field, op, values: Array.isArray(values) ? values : [values] });
        return obj;
      },
      async get() {
        // For the events query: filter by status=scheduled and date in targetDates.
        const statusCond = _conditions.find(c => c.field === 'status');
        const dateCond = _conditions.find(c => c.field === 'date');

        const docs = _events.filter(ev => {
          if (statusCond && ev.data.status !== statusCond.values[0]) return false;
          if (dateCond && dateCond.op === 'in') {
            if (!(dateCond.values as string[]).includes(ev.data.date as string)) return false;
          }
          return true;
        }).map(ev => ({
          id: ev.id,
          data: () => ev.data,
          ref: ev.ref,
        }));

        return { empty: docs.length === 0, size: docs.length, docs };
      },
    };
    return obj;
  },

  // Used by the snack-reminder branch: db.doc('events/{eventId}/snackSlot/slot')
  doc(path: string) {
    const match = path.match(/^events\/([^/]+)\/snackSlot\/slot$/);
    return {
      async get() {
        if (!match) return { exists: false, data: () => undefined };
        const eventId = match[1];
        const entry = _snackSlots.get(eventId);
        if (entry === 'THROW') throw new Error('mocked snackSlot read failure');
        if (entry === undefined) return { exists: false, data: () => undefined };
        return { exists: true, data: () => entry };
      },
    };
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

// Import the module after mocks — this registers the scheduled handler.
import './index';
// Also import the named export for direct invocation fallback.
// (onSchedule mock captures the handler on module load.)

// ─── ENV mock ─────────────────────────────────────────────────────────────────

// We need to control ENV.shouldRunScheduledJobs — easiest to spy on process.env.
// The mock captures the handler registered for sendScheduledNotifications.
// We re-import env to spy on it after the module loads.

// ─── Date helpers ─────────────────────────────────────────────────────────────

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const TODAY = isoDate(0);
const TOMORROW = isoDate(1);
const IN_2_DAYS = isoDate(2);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRecipient(email = 'test@example.com', name = 'Test User') {
  return { uid: 'uid-test', email, name, type: 'player' as const };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _events.length = 0;
  updateMocks.length = 0;
  _snackSlots.clear();
  _rsvpSubcollection.clear();
  sendMailMock.mockClear();
  // Ensure DISPATCHER_SHADOW_MODE is off by default in tests.
  delete process.env.DISPATCHER_SHADOW_MODE;
  // Default: scheduled jobs run.
  mockShouldRun.value = true;
});

function getHandler(): () => Promise<void> {
  // index.ts registers multiple onSchedule CFs. sendScheduledNotifications is the
  // first one registered (it appears before the legacy CFs in the file).
  // capturedHandlers[0] is therefore the dispatcher.
  const handler = capturedHandlers[0];
  if (!handler) throw new Error('No handler captured from onSchedule mock');
  return handler;
}

describe('sendScheduledNotifications', () => {
  describe('shadow mode', () => {
    it('does not call sendMail when DISPATCHER_SHADOW_MODE=true', async () => {
      process.env.DISPATCHER_SHADOW_MODE = 'true';

      _events.push(makeEventDoc('ev1', {
        date: TOMORROW,
        status: 'scheduled',
        title: 'Test Game',
        startTime: '10:00',
        recipients: [makeRecipient()],
        dayBeforeSent: false,
      }));

      await getHandler()();

      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('still stamps idempotency flags in shadow mode', async () => {
      process.env.DISPATCHER_SHADOW_MODE = 'true';

      const evDoc = makeEventDoc('ev1', {
        date: TOMORROW,
        status: 'scheduled',
        title: 'Test Game',
        startTime: '10:00',
        recipients: [makeRecipient()],
        dayBeforeSent: false,
      });
      _events.push(evDoc);

      await getHandler()();

      // dayBeforeSent flag should be stamped even in shadow mode.
      expect(evDoc.ref.update).toHaveBeenCalledWith(expect.objectContaining({ dayBeforeSent: true }));
    });
  });

  describe('day-before reminder', () => {
    it('sends to all recipients when event is tomorrow and dayBeforeSent is false', async () => {
      const r1 = makeRecipient('alice@example.com', 'Alice Smith');
      const r2 = makeRecipient('bob@example.com', 'Bob Jones');

      _events.push(makeEventDoc('ev-tomorrow', {
        date: TOMORROW,
        status: 'scheduled',
        title: 'Lions vs Tigers',
        startTime: '09:00',
        recipients: [r1, r2],
        dayBeforeSent: false,
        // Disable other tomorrow notifications so we only count day-before sends.
        rsvpFollowupSent: true,
        rsvps: [],
      }));

      await getHandler()();

      // sendMail called once per recipient for day-before.
      expect(sendMailMock).toHaveBeenCalledTimes(2);
      const toAddrs = sendMailMock.mock.calls.map(c => (c[0] as { to: string }).to);
      expect(toAddrs.some(t => t.includes('alice@example.com'))).toBe(true);
      expect(toAddrs.some(t => t.includes('bob@example.com'))).toBe(true);
    });

    it('skips when dayBeforeSent is already true (idempotency)', async () => {
      _events.push(makeEventDoc('ev-already-sent', {
        date: TOMORROW,
        status: 'scheduled',
        title: 'Game',
        recipients: [makeRecipient()],
        dayBeforeSent: true, // already sent
        // Disable RSVP follow-up so sendMail stays silent.
        rsvpFollowupSent: true,
        rsvps: [],
      }));

      await getHandler()();

      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('stamps dayBeforeSent=true after sending', async () => {
      const evDoc = makeEventDoc('ev-stamp', {
        date: TOMORROW,
        status: 'scheduled',
        title: 'Game',
        recipients: [makeRecipient()],
        dayBeforeSent: false,
      });
      _events.push(evDoc);

      await getHandler()();

      expect(evDoc.ref.update).toHaveBeenCalledWith(expect.objectContaining({ dayBeforeSent: true }));
    });
  });

  describe('game-day reminder', () => {
    it('sends to all recipients when event is today and gameDaySent is false', async () => {
      _events.push(makeEventDoc('ev-today', {
        date: TODAY,
        status: 'scheduled',
        title: 'Today Game',
        startTime: '14:00',
        recipients: [makeRecipient()],
        gameDaySent: false,
        rsvps: [],
      }));

      await getHandler()();

      expect(sendMailMock).toHaveBeenCalledTimes(1);
    });

    it('skips when gameDaySent is already true', async () => {
      _events.push(makeEventDoc('ev-gameday-done', {
        date: TODAY,
        status: 'scheduled',
        title: 'Game',
        recipients: [makeRecipient()],
        gameDaySent: true,
      }));

      await getHandler()();

      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('stamps gameDaySent=true after sending', async () => {
      const evDoc = makeEventDoc('ev-gd-stamp', {
        date: TODAY,
        status: 'scheduled',
        title: 'Game',
        recipients: [makeRecipient()],
        gameDaySent: false,
        rsvps: [],
      });
      _events.push(evDoc);

      await getHandler()();

      expect(evDoc.ref.update).toHaveBeenCalledWith(expect.objectContaining({ gameDaySent: true }));
    });

    // ── FW-97: yes-count read from subcollection ─────────────────────────────

    it('(FW-97) email body shows correct yes-count from subcollection (3 yes, 2 no)', async () => {
      _events.push(makeEventDoc('ev-gd-yescount', {
        date: TODAY,
        status: 'scheduled',
        title: 'Yes-Count Game',
        recipients: [makeRecipient()],
        gameDaySent: false,
        // Legacy array absent — count must come from subcollection.
      }));

      _rsvpSubcollection.set('ev-gd-yescount', [
        { uid: 'uid-a', response: 'yes' },
        { uid: 'uid-b', response: 'yes' },
        { uid: 'uid-c', response: 'yes' },
        { uid: 'uid-d', response: 'no' },
        { uid: 'uid-e', response: 'no' },
      ]);

      await getHandler()();

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      const call = sendMailMock.mock.calls[0][0] as { text: string; html: string };
      // Both plaintext and HTML body must show "3 attending".
      expect(call.text).toContain('RSVPs: 3 attending');
      expect(call.html).toContain('3 attending');
    });

    it('(FW-97) email body shows 0 attending when no RSVP subcollection docs exist', async () => {
      _events.push(makeEventDoc('ev-gd-zero', {
        date: TODAY,
        status: 'scheduled',
        title: 'Zero RSVPs Game',
        recipients: [makeRecipient()],
        gameDaySent: false,
      }));
      // _rsvpSubcollection not set → mock returns empty snapshot → count = 0

      await getHandler()();

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      const call = sendMailMock.mock.calls[0][0] as { text: string; html: string };
      expect(call.text).toContain('RSVPs: 0 attending');
      expect(call.html).toContain('0 attending');
    });
  });

  describe('snack reminder', () => {
    it('sends when no snackSlot doc exists (treated as unclaimed)', async () => {
      _events.push(makeEventDoc('ev-snack', {
        date: IN_2_DAYS,
        status: 'scheduled',
        title: 'Snack Game',
        recipients: [makeRecipient()],
        snackReminderSent: false,
      }));
      // _snackSlots not set → mock returns exists:false → treated as unclaimed

      await getHandler()();

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      const subject = (sendMailMock.mock.calls[0][0] as { subject: string }).subject;
      expect(subject.toLowerCase()).toContain('snack');
    });

    it('sends when snackSlot exists but claimedBy is empty', async () => {
      _events.push(makeEventDoc('ev-unclaimed', {
        date: IN_2_DAYS,
        status: 'scheduled',
        title: 'Game',
        recipients: [makeRecipient()],
        snackReminderSent: false,
      }));
      _snackSlots.set('ev-unclaimed', { claimedBy: null });

      await getHandler()();

      expect(sendMailMock).toHaveBeenCalledTimes(1);
    });

    it('skips when snackSlot.claimedBy is set (someone already signed up)', async () => {
      _events.push(makeEventDoc('ev-claimed', {
        date: IN_2_DAYS,
        status: 'scheduled',
        title: 'Game',
        recipients: [makeRecipient()],
        snackReminderSent: false,
      }));
      _snackSlots.set('ev-claimed', { claimedBy: 'parent-uid-123' });

      await getHandler()();

      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('skips on snackSlot read failure (fail-closed to avoid false spam)', async () => {
      _events.push(makeEventDoc('ev-read-fail', {
        date: IN_2_DAYS,
        status: 'scheduled',
        title: 'Game',
        recipients: [makeRecipient()],
        snackReminderSent: false,
      }));
      _snackSlots.set('ev-read-fail', 'THROW');

      await getHandler()();

      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('skips when snackReminderSent is already true', async () => {
      _events.push(makeEventDoc('ev-snack-done', {
        date: IN_2_DAYS,
        status: 'scheduled',
        title: 'Game',
        recipients: [makeRecipient()],
        snackReminderSent: true,
      }));

      await getHandler()();

      expect(sendMailMock).not.toHaveBeenCalled();
    });
  });

  describe('RSVP follow-up', () => {
    it('sends only to recipients who have not responded', async () => {
      const responded = makeRecipient('responded@example.com', 'Responded');
      responded.uid = 'uid-responded';
      const unresponded = makeRecipient('unresponded@example.com', 'Unresponded');
      unresponded.uid = 'uid-unresponded';

      _events.push(makeEventDoc('ev-rsvp', {
        date: TOMORROW,
        status: 'scheduled',
        title: 'RSVP Game',
        recipients: [responded, unresponded],
        dayBeforeSent: true, // skip day-before so only rsvp runs
        rsvpFollowupSent: false,
        // FW-90b: RSVPs read from subcollection only (legacy array ignored).
      }));

      // Seed subcollection: only 'responded' has RSVPd.
      _rsvpSubcollection.set('ev-rsvp', [{ uid: 'uid-responded', response: 'yes' }]);

      await getHandler()();

      // Only the unresponded recipient should get the follow-up.
      expect(sendMailMock).toHaveBeenCalledTimes(1);
      const to = (sendMailMock.mock.calls[0][0] as { to: string }).to;
      expect(to).toContain('unresponded@example.com');
    });

    it('stamps rsvpFollowupSent even when everyone has responded', async () => {
      const r = makeRecipient('done@example.com', 'Done');
      r.uid = 'uid-done';

      const evDoc = makeEventDoc('ev-all-responded', {
        date: TOMORROW,
        status: 'scheduled',
        title: 'Game',
        recipients: [r],
        dayBeforeSent: true,
        rsvpFollowupSent: false,
        // FW-90b: RSVPs read from subcollection only (legacy array ignored).
      });
      _events.push(evDoc);

      // Seed subcollection: everyone has RSVPd.
      _rsvpSubcollection.set('ev-all-responded', [{ uid: 'uid-done', response: 'yes' }]);

      await getHandler()();

      expect(sendMailMock).not.toHaveBeenCalled();
      expect(evDoc.ref.update).toHaveBeenCalledWith(
        expect.objectContaining({ rsvpFollowupSent: true }),
      );
    });

    it('skips when rsvpFollowupSent is already true', async () => {
      _events.push(makeEventDoc('ev-followup-done', {
        date: TOMORROW,
        status: 'scheduled',
        title: 'Game',
        recipients: [makeRecipient()],
        dayBeforeSent: true,
        rsvpFollowupSent: true,
      }));

      await getHandler()();

      expect(sendMailMock).not.toHaveBeenCalled();
    });

    // ── FW-90a: subcollection + dual-source deduplication ────────────────────

    it('(FW-90a) subcollection-only RSVP → recipient matched, no follow-up sent', async () => {
      // Recipient RSVPd in-app (submitRsvp writes to subcollection only pre-FW-90a).
      // Legacy array is empty. Dispatcher must read subcollection and suppress follow-up.
      const r = makeRecipient('subcol@example.com', 'Subcol User');
      r.uid = 'uid-subcol';

      _events.push(makeEventDoc('ev-subcol-rsvp', {
        date: TOMORROW,
        status: 'scheduled',
        title: 'Subcol Game',
        recipients: [r],
        dayBeforeSent: true,
        rsvpFollowupSent: false,
        rsvps: [], // legacy array is empty
      }));

      // Subcollection has the RSVP (written by submitRsvp).
      _rsvpSubcollection.set('ev-subcol-rsvp', [{ uid: 'uid-subcol', response: 'yes' }]);

      await getHandler()();

      // No follow-up should be sent — recipient already responded via subcollection.
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('(FW-90b) migrated legacy RSVP (source=email-legacy in subcollection) → matched, no follow-up sent', async () => {
      // After the migration script runs, pre-FW-90 email-link RSVPs appear in the
      // subcollection with source=email-legacy. Dispatcher must match them.
      const r = makeRecipient('legacy@example.com', 'Legacy User');
      r.uid = 'uid-legacy';

      _events.push(makeEventDoc('ev-migrated-rsvp', {
        date: TOMORROW,
        status: 'scheduled',
        title: 'Migrated Game',
        recipients: [r],
        dayBeforeSent: true,
        rsvpFollowupSent: false,
        // rsvps[] array still present in Firestore (not dropped), but dispatcher ignores it.
        rsvps: [{ playerId: 'uid-legacy', response: 'yes' }],
      }));

      // Subcollection has the migrated RSVP (source=email-legacy).
      _rsvpSubcollection.set('ev-migrated-rsvp', [{ uid: 'uid-legacy', response: 'yes', source: 'email-legacy' }]);

      await getHandler()();

      // Matched via subcollection — no follow-up sent.
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('(FW-90a) same person RSVPd via both paths → not double-counted, no follow-up', async () => {
      // Recipient appears in both the legacy array and the subcollection.
      // Should count as responded exactly once — not get a follow-up.
      const r = makeRecipient('both@example.com', 'Both User');
      r.uid = 'uid-both';

      _events.push(makeEventDoc('ev-both-rsvp', {
        date: TOMORROW,
        status: 'scheduled',
        title: 'Both Game',
        recipients: [r],
        dayBeforeSent: true,
        rsvpFollowupSent: false,
        rsvps: [{ playerId: 'uid-both', response: 'yes' }], // legacy array
      }));

      _rsvpSubcollection.set('ev-both-rsvp', [{ uid: 'uid-both', response: 'yes' }]); // subcollection

      await getHandler()();

      // One entry in the unresponded list? No — same person, must be excluded.
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('(FW-90a) email-only recipient (no uid) RSVPs via subcollection → matched on email key', async () => {
      // Recipient has no uid (no Firebase Auth account). They RSVPd via a one-tap
      // email link, which post-FW-90a writes a subcollection doc with email field.
      const emailAddr = 'noauth@example.com';
      const r = { uid: undefined as string | undefined, email: emailAddr, name: 'No Auth', type: 'player' as const };

      _events.push(makeEventDoc('ev-email-only', {
        date: TOMORROW,
        status: 'scheduled',
        title: 'Email-Only Game',
        recipients: [r],
        dayBeforeSent: true,
        rsvpFollowupSent: false,
        rsvps: [], // array empty (pre-FW-90a legacy email writes stored email here; this tests subcollection path)
      }));

      // Subcollection doc written by rsvpEvent handler (post-FW-90a): email field set, no uid.
      _rsvpSubcollection.set('ev-email-only', [{ email: emailAddr, response: 'yes' }]);

      await getHandler()();

      // Email-only recipient RSVPd → matched on email → no follow-up.
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('(FW-90b) subcollection read failure → fail-closed: stamps flag, skips event, no follow-up sent', async () => {
      // FW-90b: dispatcher no longer falls back to the legacy array on read failure.
      // Instead it fails-closed — stamps rsvpFollowupSent:true and skips the event.
      // This avoids spamming users who may have already responded.
      const r = makeRecipient('failclosed@example.com', 'Fail Closed User');
      r.uid = 'uid-failclosed';

      const evDoc = makeEventDoc('ev-subcol-fail', {
        date: TOMORROW,
        status: 'scheduled',
        title: 'Fail-Closed Game',
        recipients: [r],
        dayBeforeSent: true,
        rsvpFollowupSent: false,
      });
      _events.push(evDoc);

      // Subcollection throws — dispatcher must fail-closed.
      _rsvpSubcollection.set('ev-subcol-fail', 'THROW');

      await getHandler()();

      // No follow-up email sent.
      expect(sendMailMock).not.toHaveBeenCalled();
      // Flag stamped so we don't re-attempt on the next run.
      expect(evDoc.ref.update).toHaveBeenCalledWith(
        expect.objectContaining({ rsvpFollowupSent: true }),
      );
    });
  });

  describe('guards and edge cases', () => {
    it('skips events with no recipients array', async () => {
      _events.push(makeEventDoc('ev-no-recipients', {
        date: TOMORROW,
        status: 'scheduled',
        title: 'Orphan Event',
        dayBeforeSent: false,
        // no recipients field
      }));

      await getHandler()();

      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('handles empty events result without error', async () => {
      // No events seeded.
      await expect(getHandler()()).resolves.toBeUndefined();
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('returns early when shouldRunScheduledJobs() is false (emulator)', async () => {
      mockShouldRun.value = false;

      _events.push(makeEventDoc('ev-emulator', {
        date: TOMORROW,
        status: 'scheduled',
        title: 'Game',
        recipients: [makeRecipient()],
        dayBeforeSent: false,
      }));

      await getHandler()();

      expect(sendMailMock).not.toHaveBeenCalled();
    });
  });
});
