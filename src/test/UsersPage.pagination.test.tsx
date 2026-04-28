/**
 * UsersPage — cursor-based pagination
 *
 * Covers the getDocs(orderBy + limit) initial load and the
 * startAfter "Load more" flow introduced in fix/firestore-read-optimizations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { UserProfile } from '../../types';

// ─── Mutable spy refs ─────────────────────────────────────────────────────────

const mockGetDocs = vi.fn();
const mockQuery = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockStartAfter = vi.fn();

// ─── Firebase mocks ───────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({
  db: {},
  functions: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, col: string) => ({ __col: col })),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  doc: vi.fn((_db: unknown, _col: string, id: string) => ({ id })),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  writeBatch: vi.fn(() => ({
    update: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
  })),
  arrayUnion: vi.fn((v: unknown) => v),
  arrayRemove: vi.fn((v: unknown) => v),
  query: (...args: unknown[]) => mockQuery(...args),
  where: vi.fn(),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  limit: (...args: unknown[]) => mockLimit(...args),
  startAfter: (...args: unknown[]) => mockStartAfter(...args),
  deleteField: vi.fn(() => ({ __type: 'deleteField' })),
  deleteDoc: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: { success: true } })),
}));

// ─── Store mocks ──────────────────────────────────────────────────────────────

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector: (s: { teams: never[] }) => unknown) =>
    selector({ teams: [] }),
}));

vi.mock('@/store/useLeagueStore', () => ({
  useLeagueStore: (selector: (s: { leagues: never[] }) => unknown) =>
    selector({ leagues: [] }),
}));

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: { user: { uid: string } | null }) => unknown) =>
    selector({ user: { uid: 'admin-uid' } }),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { UsersPage, _resetUsersCache } from '../pages/UsersPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 100;

function makeProfile(uid: string, displayName: string): UserProfile {
  return {
    uid,
    email: `${uid}@example.com`,
    displayName,
    role: 'coach',
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

/** Build a fake snapshot with N docs, each carrying a fake cursor token. */
function makeSnap(profiles: UserProfile[]) {
  return {
    docs: profiles.map((u, i) => ({
      data: () => u,
      __cursor: `cursor-${i}`,
    })),
  };
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  _resetUsersCache();
  mockQuery.mockReturnValue({ __query: true });
  mockOrderBy.mockReturnValue('__orderBy');
  mockLimit.mockReturnValue('__limit');
  mockStartAfter.mockReturnValue('__startAfter');
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UsersPage — initial load uses orderBy + limit(100)', () => {

  it('calls orderBy("displayName") on mount', async () => {
    mockGetDocs.mockResolvedValueOnce(makeSnap([makeProfile('u1', 'Alice')]));
    render(<UsersPage />);
    await screen.findByText('Alice');

    expect(mockOrderBy).toHaveBeenCalledWith('displayName');
  });

  it('calls limit(100) on mount', async () => {
    mockGetDocs.mockResolvedValueOnce(makeSnap([makeProfile('u1', 'Alice')]));
    render(<UsersPage />);
    await screen.findByText('Alice');

    expect(mockLimit).toHaveBeenCalledWith(PAGE_SIZE);
  });

  it('does NOT call startAfter on the initial load', async () => {
    mockGetDocs.mockResolvedValueOnce(makeSnap([makeProfile('u1', 'Alice')]));
    render(<UsersPage />);
    await screen.findByText('Alice');

    expect(mockStartAfter).not.toHaveBeenCalled();
  });

  it('renders all users returned by the first page', async () => {
    const users = [makeProfile('u1', 'Alice'), makeProfile('u2', 'Bob')];
    mockGetDocs.mockResolvedValueOnce(makeSnap(users));
    render(<UsersPage />);

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

});

describe('UsersPage — "Load more" button visibility', () => {

  it('hides "Load more" when the first page has fewer than 100 docs', async () => {
    // 2 docs < 100 → hasMore = false
    mockGetDocs.mockResolvedValueOnce(makeSnap([
      makeProfile('u1', 'Alice'),
      makeProfile('u2', 'Bob'),
    ]));
    render(<UsersPage />);
    await screen.findByText('Alice');

    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('shows "Load more" when the first page returns exactly 100 docs', async () => {
    const users = Array.from({ length: PAGE_SIZE }, (_, i) =>
      makeProfile(`u${i}`, `User ${i}`)
    );
    mockGetDocs.mockResolvedValueOnce(makeSnap(users));
    render(<UsersPage />);
    await screen.findByText('User 0');

    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
  });

  it('hides "Load more" when a search filter is active', async () => {
    const users = Array.from({ length: PAGE_SIZE }, (_, i) =>
      makeProfile(`u${i}`, `User ${i}`)
    );
    mockGetDocs.mockResolvedValueOnce(makeSnap(users));
    render(<UsersPage />);
    await screen.findByText('User 0');

    // Activate the search filter
    const searchInput = screen.getByPlaceholderText(/search by name or email/i);
    fireEvent.change(searchInput, { target: { value: 'User 0' } });

    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('hides "Load more" when a role filter is active', async () => {
    const users = Array.from({ length: PAGE_SIZE }, (_, i) =>
      makeProfile(`u${i}`, `User ${i}`)
    );
    mockGetDocs.mockResolvedValueOnce(makeSnap(users));
    render(<UsersPage />);
    await screen.findByText('User 0');

    // Click the "Coach" role filter pill
    fireEvent.click(screen.getByRole('button', { name: /^Coach$/i }));

    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('hides "Load more" after the last page returns fewer than 100 docs', async () => {
    // Page 1: full page
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) =>
      makeProfile(`u${i}`, `User ${i}`)
    );
    const page1Snap = makeSnap(page1);
    // Page 2: partial — signals end of collection
    const page2 = [makeProfile('u100', 'User 100')];

    mockGetDocs
      .mockResolvedValueOnce(page1Snap)
      .mockResolvedValueOnce(makeSnap(page2));

    render(<UsersPage />);
    await screen.findByText('User 0');

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    await screen.findByText('User 100');
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

});

describe('UsersPage — "Load more" fetches next page with startAfter', () => {

  it('calls startAfter with the last doc of the previous page', async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) =>
      makeProfile(`u${i}`, `User ${i}`)
    );
    const page1Snap = makeSnap(page1);
    const lastDoc = page1Snap.docs[PAGE_SIZE - 1];

    mockGetDocs
      .mockResolvedValueOnce(page1Snap)
      .mockResolvedValueOnce(makeSnap([makeProfile('u100', 'User 100')]));

    render(<UsersPage />);
    await screen.findByText('User 0');

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => expect(mockStartAfter).toHaveBeenCalledWith(lastDoc));
  });

  it('calls orderBy and limit again on the "Load more" query', async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) =>
      makeProfile(`u${i}`, `User ${i}`)
    );
    mockGetDocs
      .mockResolvedValueOnce(makeSnap(page1))
      .mockResolvedValueOnce(makeSnap([makeProfile('u100', 'User 100')]));

    render(<UsersPage />);
    await screen.findByText('User 0');

    // Reset call counts so we can check the second invocation cleanly
    mockOrderBy.mockClear();
    mockLimit.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => {
      expect(mockOrderBy).toHaveBeenCalledWith('displayName');
      expect(mockLimit).toHaveBeenCalledWith(PAGE_SIZE);
    });
  });

  it('appends new users to the existing list', async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) =>
      makeProfile(`u${i}`, `Page1 User ${i}`)
    );
    const page2 = [makeProfile('extra', 'Page2 User')];

    mockGetDocs
      .mockResolvedValueOnce(makeSnap(page1))
      .mockResolvedValueOnce(makeSnap(page2));

    render(<UsersPage />);
    await screen.findByText('Page1 User 0');

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    await screen.findByText('Page2 User');
    // Original page-1 users are still present
    expect(screen.getByText('Page1 User 0')).toBeInTheDocument();
  });

  it('shows "Loading…" text on the button while fetching the next page', async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) =>
      makeProfile(`u${i}`, `User ${i}`)
    );
    mockGetDocs
      .mockResolvedValueOnce(makeSnap(page1))
      // Stall the second request so we can assert the loading state
      .mockReturnValueOnce(new Promise(() => {}));

    render(<UsersPage />);
    await screen.findByText('User 0');

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
  });

});
