/**
 * onRsvpWritten — unit tests for FW-98
 *
 * Tests cover:
 *   - New RSVP added → rsvpCounts increments correctly
 *   - RSVP changed (yes → no) → old bucket decrements, new increments
 *   - RSVP deleted → bucket decrements
 *   - Multiple RSVPs of mixed responses → correct totals
 *   - Non-existent event → guard bails out, no update issued
 *
 * Strategy: same mocking pattern as onPlayerWritten.test.ts — lightweight
 * mocks of firebase-functions/v2/* and firebase-admin.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Firebase Functions / Admin mocks ─────────────────────────────────────────

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((h: unknown) => h),
  onRequest: vi.fn((h: unknown) => h),
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
  onDocumentWritten: vi.fn((
    _pattern: unknown,
    handler: (e: unknown) => Promise<unknown>,
  ) => handler),
}));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: vi.fn() }));
vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn(() => ({ value: vi.fn(() => '') })),
}));
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn().mockImplementation(() => ({})) }));
vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) })),
}));

// ─── Firestore mock infrastructure ────────────────────────────────────────────

interface DocData { [key: string]: unknown }

// RSVP docs keyed by rsvpId, scoped to a single event.
const _rsvps = new Map<string, DocData>();

// Event docs keyed by eventId.
const _events = new Map<string, DocData>();

// Spy on event doc updates.
const mockEventUpdate = vi.fn().mockResolvedValue(undefined);

function makeEventRef(eventId: string) {
  return {
    path: `events/${eventId}`,
    async get() {
      const data = _events.get(eventId);
      return {
        exists: data !== undefined,
        data: () => data,
      };
    },
    update: mockEventUpdate,
  };
}

const mockFirestore = {
  doc(path: string) {
    // Only events/{eventId} is requested in onRsvpWritten.
    const parts = path.split('/');
    if (parts[0] === 'events' && parts.length === 2) {
      return makeEventRef(parts[1]!);
    }
    throw new Error(`Unexpected doc path in test: ${path}`);
  },
  collection(path: string) {
    // events/{eventId}/rsvps — the trigger re-reads the full subcollection.
    const parts = path.split('/');
    if (parts[0] === 'events' && parts[2] === 'rsvps') {
      return {
        async get() {
          const docs = [..._rsvps.entries()].map(([id, data]) => ({
            id,
            data: () => data,
          }));
          return { docs, size: docs.length, empty: docs.length === 0 };
        },
      };
    }
    throw new Error(`Unexpected collection path in test: ${path}`);
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

vi.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => ({ __id: true }) },
}));

// Import after mocks are in place.
import { onRsvpWritten } from './index';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeRsvpWrittenEvent(eventId: string, rsvpId: string) {
  return {
    params: { eventId, rsvpId },
    data: {}, // onRsvpWritten doesn't use before/after data — it re-reads the subcollection
  };
}

type RsvpCounts = { yes: number; no: number; maybe: number };

function capturedCounts(): RsvpCounts {
  expect(mockEventUpdate).toHaveBeenCalled();
  const lastCall = mockEventUpdate.mock.calls[mockEventUpdate.mock.calls.length - 1]!;
  return (lastCall[0] as { rsvpCounts: RsvpCounts }).rsvpCounts;
}

beforeEach(() => {
  _rsvps.clear();
  _events.clear();
  mockEventUpdate.mockClear();
});

// ─── onRsvpWritten tests ──────────────────────────────────────────────────────

describe('onRsvpWritten', () => {
  it('writes correct counts when a single "yes" RSVP is added', async () => {
    const trigger = onRsvpWritten as unknown as (e: unknown) => Promise<void>;

    _events.set('ev-1', { title: 'Practice', status: 'scheduled' });
    _rsvps.set('uid-a', { response: 'yes', name: 'Alice' });

    await trigger(makeRsvpWrittenEvent('ev-1', 'uid-a'));

    const counts = capturedCounts();
    expect(counts).toEqual({ yes: 1, no: 0, maybe: 0 });
  });

  it('writes correct counts when a RSVP changes from yes to no', async () => {
    const trigger = onRsvpWritten as unknown as (e: unknown) => Promise<void>;

    _events.set('ev-2', { title: 'Game', status: 'scheduled' });
    // The trigger re-reads the subcollection, which now reflects the updated value.
    _rsvps.set('uid-b', { response: 'no', name: 'Bob' });

    await trigger(makeRsvpWrittenEvent('ev-2', 'uid-b'));

    const counts = capturedCounts();
    // After the change: 0 yes, 1 no — the trigger sees the post-write state.
    expect(counts).toEqual({ yes: 0, no: 1, maybe: 0 });
  });

  it('writes correct counts when an RSVP is deleted', async () => {
    const trigger = onRsvpWritten as unknown as (e: unknown) => Promise<void>;

    _events.set('ev-3', { title: 'Tournament', status: 'scheduled' });
    // _rsvps is empty — the deleted doc is no longer in the subcollection.

    await trigger(makeRsvpWrittenEvent('ev-3', 'uid-c'));

    const counts = capturedCounts();
    expect(counts).toEqual({ yes: 0, no: 0, maybe: 0 });
  });

  it('correctly tallies mixed responses from multiple RSVPs', async () => {
    const trigger = onRsvpWritten as unknown as (e: unknown) => Promise<void>;

    _events.set('ev-4', { title: 'Practice', status: 'scheduled' });
    _rsvps.set('uid-1', { response: 'yes', name: 'Alice' });
    _rsvps.set('uid-2', { response: 'yes', name: 'Bob' });
    _rsvps.set('uid-3', { response: 'no', name: 'Carol' });
    _rsvps.set('uid-4', { response: 'maybe', name: 'Dave' });
    _rsvps.set('uid-5', { response: 'yes', name: 'Eve' });

    await trigger(makeRsvpWrittenEvent('ev-4', 'uid-5'));

    const counts = capturedCounts();
    expect(counts).toEqual({ yes: 3, no: 1, maybe: 1 });
  });

  it('skips RSVP docs with unrecognised response values', async () => {
    const trigger = onRsvpWritten as unknown as (e: unknown) => Promise<void>;

    _events.set('ev-5', { title: 'Game', status: 'scheduled' });
    _rsvps.set('uid-valid', { response: 'yes', name: 'Alice' });
    // Malformed doc — should be ignored in the tally.
    _rsvps.set('uid-bad', { response: 'definitely', name: 'Bob' });

    await trigger(makeRsvpWrittenEvent('ev-5', 'uid-valid'));

    const counts = capturedCounts();
    expect(counts).toEqual({ yes: 1, no: 0, maybe: 0 });
  });

  it('bails out without writing when the event doc does not exist', async () => {
    const trigger = onRsvpWritten as unknown as (e: unknown) => Promise<void>;

    // _events is empty — event does not exist.
    _rsvps.set('uid-x', { response: 'yes', name: 'Ghost' });

    await trigger(makeRsvpWrittenEvent('ev-nonexistent', 'uid-x'));

    expect(mockEventUpdate).not.toHaveBeenCalled();
  });
});
