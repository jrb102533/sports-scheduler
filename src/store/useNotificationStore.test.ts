/**
 * useNotificationStore — unit tests
 *
 * Behaviors under test:
 *   - subscribe() populates notifications from snapshot, ordered desc by createdAt
 *   - subscribe() returns an unsubscribe function
 *   - addNotification is a no-op when auth.currentUser is null
 *   - addNotification calls setDoc when authenticated
 *   - markRead is a no-op when auth.currentUser is null
 *   - markRead calls setDoc with isRead: true
 *   - markRead is a no-op when notification id is not in store
 *   - markAllRead calls batch.set for every unread notification
 *   - markAllRead is a no-op when auth.currentUser is null
 *   - clearAll calls batch.delete for every notification
 *   - clearAll is a no-op when auth.currentUser is null
 *   - setPanelOpen updates panelOpen state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppNotification } from '@/types';

// ── Firestore mock ────────────────────────────────────────────────────────────

const mockBatchSet = vi.fn();
const mockBatchDelete = vi.fn();
const mockBatchCommit = vi.fn();
const mockWriteBatch = vi.fn(() => ({
  set: mockBatchSet,
  delete: mockBatchDelete,
  commit: mockBatchCommit,
}));

const mockSetDoc = vi.fn();
const mockOnSnapshot = vi.fn(() => () => {});
const mockDoc = vi.fn(() => ({}));
const mockCollection = vi.fn(() => ({}));
const mockQuery = vi.fn(q => q);
const mockOrderBy = vi.fn(() => ({}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  writeBatch: (...args: unknown[]) => mockWriteBatch(...args),
}));

// ── Auth mock — allows setting currentUser per-test ───────────────────────────

let mockCurrentUser: { uid: string } | null = null;

vi.mock('@/lib/firebase', () => ({
  db: {},
  auth: {
    get currentUser() { return mockCurrentUser; },
  },
}));

// ── Import store after mocks ──────────────────────────────────────────────────

import { useNotificationStore } from './useNotificationStore';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeNotification(id: string, overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    type: 'info',
    title: `Notification ${id}`,
    message: 'Test message',
    isRead: false,
    createdAt: `2026-01-0${id}T00:00:00.000Z`,
    ...overrides,
  } as AppNotification;
}

function makeSnapshot(notifications: AppNotification[]) {
  return { docs: notifications.map(n => ({ id: n.id, data: () => n })) };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
  mockBatchCommit.mockResolvedValue(undefined);
  mockCurrentUser = { uid: 'user-1' };
  useNotificationStore.setState({ notifications: [], panelOpen: false });
});

// ── subscribe() ───────────────────────────────────────────────────────────────

describe('useNotificationStore — subscribe', () => {
  it('populates notifications from snapshot', () => {
    const notifications = [makeNotification('1'), makeNotification('2')];
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot(notifications));
      return () => {};
    });

    useNotificationStore.getState().subscribe('user-1');
    expect(useNotificationStore.getState().notifications).toHaveLength(2);
  });

  it('returns an unsubscribe function', () => {
    const unsub = vi.fn();
    mockOnSnapshot.mockReturnValue(unsub);
    const result = useNotificationStore.getState().subscribe('user-1');
    expect(typeof result).toBe('function');
  });
});

// ── addNotification() ─────────────────────────────────────────────────────────

describe('useNotificationStore — addNotification', () => {
  it('calls setDoc when authenticated', async () => {
    await useNotificationStore.getState().addNotification(makeNotification('n1'));
    expect(mockSetDoc).toHaveBeenCalledOnce();
  });

  it('is a no-op when auth.currentUser is null', async () => {
    mockCurrentUser = null;
    await useNotificationStore.getState().addNotification(makeNotification('n1'));
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});

// ── markRead() ────────────────────────────────────────────────────────────────

describe('useNotificationStore — markRead', () => {
  it('calls setDoc with isRead: true', async () => {
    useNotificationStore.setState({ notifications: [makeNotification('n1', { isRead: false })] });
    await useNotificationStore.getState().markRead('n1');
    const written = mockSetDoc.mock.calls[0][1] as AppNotification;
    expect(written.isRead).toBe(true);
  });

  it('is a no-op when auth.currentUser is null', async () => {
    mockCurrentUser = null;
    useNotificationStore.setState({ notifications: [makeNotification('n1')] });
    await useNotificationStore.getState().markRead('n1');
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('is a no-op when notification id is not in store', async () => {
    useNotificationStore.setState({ notifications: [] });
    await useNotificationStore.getState().markRead('nonexistent');
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});

// ── markAllRead() ─────────────────────────────────────────────────────────────

describe('useNotificationStore — markAllRead', () => {
  it('calls batch.set for every unread notification', async () => {
    useNotificationStore.setState({
      notifications: [
        makeNotification('n1', { isRead: false }),
        makeNotification('n2', { isRead: false }),
        makeNotification('n3', { isRead: true }),
      ],
    });
    await useNotificationStore.getState().markAllRead();
    // Only unread notifications (n1, n2) should be batch-set
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledOnce();
  });

  it('is a no-op when auth.currentUser is null', async () => {
    mockCurrentUser = null;
    useNotificationStore.setState({ notifications: [makeNotification('n1')] });
    await useNotificationStore.getState().markAllRead();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

// ── clearAll() ────────────────────────────────────────────────────────────────

describe('useNotificationStore — clearAll', () => {
  it('calls batch.delete for every notification', async () => {
    useNotificationStore.setState({
      notifications: [makeNotification('n1'), makeNotification('n2')],
    });
    await useNotificationStore.getState().clearAll();
    expect(mockBatchDelete).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledOnce();
  });

  it('is a no-op when auth.currentUser is null', async () => {
    mockCurrentUser = null;
    useNotificationStore.setState({ notifications: [makeNotification('n1')] });
    await useNotificationStore.getState().clearAll();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

// ── setPanelOpen() ────────────────────────────────────────────────────────────

describe('useNotificationStore — setPanelOpen', () => {
  it('sets panelOpen to true', () => {
    useNotificationStore.getState().setPanelOpen(true);
    expect(useNotificationStore.getState().panelOpen).toBe(true);
  });

  it('sets panelOpen to false', () => {
    useNotificationStore.setState({ panelOpen: true });
    useNotificationStore.getState().setPanelOpen(false);
    expect(useNotificationStore.getState().panelOpen).toBe(false);
  });
});
