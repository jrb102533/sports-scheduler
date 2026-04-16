/**
 * useEventStore — subscribe() draft-event filtering
 *
 * Regression test for the games-visibility bug where parent/player users
 * see zero events because Firestore security rules deny read access to
 * draft events. When the client query does not exclude drafts, the entire
 * onSnapshot fails for those roles.
 *
 * What we're verifying:
 *   - excludeDrafts: true  → query includes where('status', '!=', 'draft')
 *   - excludeDrafts: false → query uses orderBy('date'), no status filter
 *   - default (no opts)    → same as excludeDrafts: false
 *   - store.loading becomes false after snapshot fires
 *   - store.events is populated from snapshot docs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firestore mock ─────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: { _tag: 'mock-db' }, auth: {}, app: {}, functions: {} }));

const capturedQueries: unknown[][] = [];

const mockWhere = vi.fn((...args: unknown[]) => ({ _type: 'where', args }));
const mockOrderBy = vi.fn((...args: unknown[]) => ({ _type: 'orderBy', args }));
const mockCollection = vi.fn(() => ({ _type: 'collection' }));
const mockQuery = vi.fn((...args: unknown[]) => {
  capturedQueries.push(args);
  return { _type: 'query', args };
});

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  onSnapshot: vi.fn((_q, success) => {
    success({ docs: [] });
    return vi.fn(); // unsub
  }),
  doc: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function hasWhereStatusNotDraft() {
  return mockWhere.mock.calls.some(
    call => call[0] === 'status' && call[1] === '!=' && call[2] === 'draft',
  );
}

function hasOrderByDate() {
  return mockOrderBy.mock.calls.some(call => call[0] === 'date');
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useEventStore.subscribe() — draft-event filtering (regression: games-visibility)', () => {
  let useEventStore: typeof import('@/store/useEventStore').useEventStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedQueries.length = 0;
    vi.resetModules();
    ({ useEventStore } = await import('@/store/useEventStore'));
  });

  // ── excludeDrafts: true (parent/player path) ──────────────────────────────

  it('excludeDrafts: true → query includes where("status", "!=", "draft")', () => {
    const unsub = useEventStore.getState().subscribe({ excludeDrafts: true });

    expect(hasWhereStatusNotDraft()).toBe(true);

    unsub();
  });

  it('excludeDrafts: true → query does NOT include orderBy("date")', () => {
    const unsub = useEventStore.getState().subscribe({ excludeDrafts: true });

    // The != operator creates an implicit orderBy('status'); no explicit orderBy('date')
    expect(hasOrderByDate()).toBe(false);

    unsub();
  });

  // ── excludeDrafts: false (admin/coach/LM path) ────────────────────────────

  it('excludeDrafts: false → query uses orderBy("date"), no status filter', () => {
    const unsub = useEventStore.getState().subscribe({ excludeDrafts: false });

    expect(hasOrderByDate()).toBe(true);
    expect(hasWhereStatusNotDraft()).toBe(false);

    unsub();
  });

  // ── default (no opts) ─────────────────────────────────────────────────────

  it('no opts → same as excludeDrafts: false (unfiltered with orderBy date)', () => {
    const unsub = useEventStore.getState().subscribe();

    expect(hasOrderByDate()).toBe(true);
    expect(hasWhereStatusNotDraft()).toBe(false);

    unsub();
  });

  // ── Store state ────────────────────────────────────────────────────────────

  it('store.loading becomes false after snapshot fires', () => {
    const unsub = useEventStore.getState().subscribe({ excludeDrafts: true });

    expect(useEventStore.getState().loading).toBe(false);

    unsub();
  });

  it('store.events is populated from snapshot docs', async () => {
    // Re-mock onSnapshot to return some docs
    const { onSnapshot: mockOnSnapshot } = await import('firebase/firestore');
    (mockOnSnapshot as ReturnType<typeof vi.fn>).mockImplementationOnce((_q: unknown, success: (snap: { docs: unknown[] }) => void) => {
      success({
        docs: [
          { id: 'evt-1', data: () => ({ title: 'Game 1', status: 'scheduled', date: '2026-05-01', teamIds: ['t1'] }) },
          { id: 'evt-2', data: () => ({ title: 'Game 2', status: 'scheduled', date: '2026-05-02', teamIds: ['t1'] }) },
        ],
      });
      return vi.fn();
    });

    vi.resetModules();
    ({ useEventStore } = await import('@/store/useEventStore'));
    const unsub = useEventStore.getState().subscribe({ excludeDrafts: true });

    const events = useEventStore.getState().events;
    expect(events).toHaveLength(2);
    expect(events[0].title).toBe('Game 1');
    expect(events[1].title).toBe('Game 2');

    unsub();
  });
});
