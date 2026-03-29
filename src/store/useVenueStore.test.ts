import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Venue } from '@/types/venue';

// ── Mock firebase/firestore ───────────────────────────────────────────────────

const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
const mockCollection = vi.fn();
const mockOrderBy = vi.fn();
const mockQuery = vi.fn();
const mockOnSnapshot = vi.fn(() => () => {});

vi.mock('firebase/firestore', () => ({
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
}));

// ── Mock @/lib/firebase ───────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {} }));

// ── Mock useAuthStore ─────────────────────────────────────────────────────────

const mockGetState = vi.fn(() => ({ user: { uid: 'user-123' } }));

vi.mock('./useAuthStore', () => ({
  useAuthStore: { getState: () => mockGetState() },
}));

// ── Import store after mocks are registered ───────────────────────────────────

import { useVenueStore } from './useVenueStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: 'venue-1',
    ownerUid: 'user-123',
    name: 'Test Ground',
    address: '1 Stadium Road, London',
    isOutdoor: true,
    fields: [],
    defaultAvailabilityWindows: [],
    defaultBlackoutDates: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useVenueStore — initial state', () => {
  it('has an empty venues array', () => {
    expect(useVenueStore.getState().venues).toEqual([]);
  });

  it('has a boolean loading flag', () => {
    expect(typeof useVenueStore.getState().loading).toBe('boolean');
  });
});

describe('useVenueStore — addVenue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({ user: { uid: 'user-123' } });
  });

  it('calls setDoc with the correct Firestore path and venue data', async () => {
    const venue = makeVenue();
    await useVenueStore.getState().addVenue(venue);

    expect(mockDoc).toHaveBeenCalledWith(
      expect.anything(), // db
      'users',
      'user-123',
      'venues',
      'venue-1',
    );
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/user-123/venues/venue-1' }),
      venue,
    );
  });

  it('throws when the user is not authenticated', async () => {
    mockGetState.mockReturnValue({ user: null });
    await expect(useVenueStore.getState().addVenue(makeVenue())).rejects.toThrow(
      'Not authenticated',
    );
  });
});

describe('useVenueStore — updateVenue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({ user: { uid: 'user-123' } });
  });

  it('calls setDoc with merged venue data at the correct path', async () => {
    const venue = makeVenue({ name: 'Updated Ground' });
    await useVenueStore.getState().updateVenue(venue);

    expect(mockDoc).toHaveBeenCalledWith(
      expect.anything(),
      'users',
      'user-123',
      'venues',
      'venue-1',
    );
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/user-123/venues/venue-1' }),
      venue,
    );
  });

  it('throws when the user is not authenticated', async () => {
    mockGetState.mockReturnValue({ user: null });
    await expect(useVenueStore.getState().updateVenue(makeVenue())).rejects.toThrow(
      'Not authenticated',
    );
  });
});

describe('useVenueStore — softDeleteVenue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({ user: { uid: 'user-123' } });
  });

  it('calls updateDoc (not setDoc) so the document is not hard-deleted', async () => {
    await useVenueStore.getState().softDeleteVenue('venue-1');
    expect(mockSetDoc).not.toHaveBeenCalled();
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
  });

  it('sets deletedAt on the venue document', async () => {
    await useVenueStore.getState().softDeleteVenue('venue-1');

    const [, fields] = mockUpdateDoc.mock.calls[0];
    expect(fields).toHaveProperty('deletedAt');
    expect(typeof fields.deletedAt).toBe('string');
  });

  it('also sets updatedAt when soft-deleting', async () => {
    await useVenueStore.getState().softDeleteVenue('venue-1');

    const [, fields] = mockUpdateDoc.mock.calls[0];
    expect(fields).toHaveProperty('updatedAt');
  });

  it('calls updateDoc with the correct Firestore path', async () => {
    await useVenueStore.getState().softDeleteVenue('venue-1');

    expect(mockDoc).toHaveBeenCalledWith(
      expect.anything(),
      'users',
      'user-123',
      'venues',
      'venue-1',
    );
  });

  it('throws when the user is not authenticated', async () => {
    mockGetState.mockReturnValue({ user: null });
    await expect(useVenueStore.getState().softDeleteVenue('venue-1')).rejects.toThrow(
      'Not authenticated',
    );
  });
});
