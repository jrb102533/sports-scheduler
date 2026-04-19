/**
 * EventForm — venue field wiring (bug #81)
 *
 * Verifies that venueId, venueLat, and venueLng are correctly included in (or
 * excluded from) the Firestore write payload depending on whether a venue is
 * selected and whether that venue has pre-geocoded coordinates.
 *
 * Strategy:
 *   Part A — pure logic tests that mirror the optionals-building logic in
 *             EventForm.doSave, matching the pattern in EventForm.homeAway.test.tsx.
 *   Part B — component render tests that confirm the venue <Select> is present
 *             when venues exist, and that the correct payload reaches addEvent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScheduledEvent, Team } from '@/types';
import type { Venue } from '@/types/venue';

// ─────────────────────────────────────────────────────────────────────────────
// Part A — pure logic: mirrors EventForm.doSave optionals-building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors the venue-fields section of EventForm.doSave's optionals object.
 * This is the exact pattern from lines 256-268 of EventForm.tsx.
 */
function buildVenueOptionals(
  venueId: string,
  savedVenues: Venue[],
  fieldId: string,
): Partial<ScheduledEvent> {
  const selectedVenue = venueId ? savedVenues.find(v => v.id === venueId) : undefined;
  const selectedField =
    fieldId && selectedVenue ? selectedVenue.fields.find(f => f.id === fieldId) : undefined;

  return {
    ...(venueId ? { venueId } : {}),
    ...(selectedVenue?.lat != null && selectedVenue?.lng != null
      ? { venueLat: selectedVenue.lat, venueLng: selectedVenue.lng }
      : {}),
    ...(selectedField ? { fieldId: selectedField.id, fieldName: selectedField.name } : {}),
  };
}

const VENUE_WITH_COORDS: Venue = {
  id: 'venue-park',
  ownerUid: 'uid-1',
  name: 'City Park',
  address: '1 Park Ave',
  lat: 37.7749,
  lng: -122.4194,
  isOutdoor: true,
  fields: [
    { id: 'field-1', name: 'Field 1' },
    { id: 'field-2', name: 'Field 2' },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const VENUE_WITHOUT_COORDS: Venue = {
  id: 'venue-gym',
  ownerUid: 'uid-1',
  name: 'Downtown Gym',
  address: '99 Main St',
  isOutdoor: false,
  fields: [{ id: 'field-a', name: 'Court A' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('EventForm venue optionals logic (bug #81)', () => {
  // ── No venue selected ─────────────────────────────────────────────────────

  it('no venue selected: venueId, venueLat, venueLng are all absent', () => {
    const result = buildVenueOptionals('', [VENUE_WITH_COORDS], '');
    expect(result.venueId).toBeUndefined();
    expect(result.venueLat).toBeUndefined();
    expect(result.venueLng).toBeUndefined();
  });

  // ── Venue with pre-geocoded coordinates ───────────────────────────────────

  it('venue with lat/lng: venueId, venueLat, venueLng are all present', () => {
    const result = buildVenueOptionals('venue-park', [VENUE_WITH_COORDS], '');
    expect(result.venueId).toBe('venue-park');
    expect(result.venueLat).toBe(37.7749);
    expect(result.venueLng).toBe(-122.4194);
  });

  it('venue with lat/lng: checkWeatherAlerts fast-path — both lat and lng are numbers', () => {
    const result = buildVenueOptionals('venue-park', [VENUE_WITH_COORDS], '');
    expect(typeof result.venueLat).toBe('number');
    expect(typeof result.venueLng).toBe('number');
  });

  // ── Venue without pre-geocoded coordinates ────────────────────────────────

  it('venue without lat/lng: venueId is present, venueLat/venueLng are absent', () => {
    const result = buildVenueOptionals('venue-gym', [VENUE_WITHOUT_COORDS], '');
    expect(result.venueId).toBe('venue-gym');
    expect(result.venueLat).toBeUndefined();
    expect(result.venueLng).toBeUndefined();
  });

  // ── Field selection ───────────────────────────────────────────────────────

  it('venue + field selected: fieldId and fieldName are included', () => {
    const result = buildVenueOptionals('venue-park', [VENUE_WITH_COORDS], 'field-2');
    expect(result.fieldId).toBe('field-2');
    expect(result.fieldName).toBe('Field 2');
  });

  it('venue selected without field: fieldId and fieldName are absent', () => {
    const result = buildVenueOptionals('venue-park', [VENUE_WITH_COORDS], '');
    expect(result.fieldId).toBeUndefined();
    expect(result.fieldName).toBeUndefined();
  });

  // ── Venue not found in saved list (stale venueId) ────────────────────────

  it('venueId set but venue not found in savedVenues: venueId present, coords absent', () => {
    // Handles the case where a venue was deleted after it was stamped on an event
    const result = buildVenueOptionals('venue-deleted', [VENUE_WITH_COORDS], '');
    expect(result.venueId).toBe('venue-deleted');
    expect(result.venueLat).toBeUndefined();
    expect(result.venueLng).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part B — component tests: venue Select renders and wires through to addEvent
// ─────────────────────────────────────────────────────────────────────────────

// ── Firebase mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  doc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  query: vi.fn(),
  orderBy: vi.fn(),
  where: vi.fn(),
  getDoc: vi.fn(),
}));

// ── Store mocks ───────────────────────────────────────────────────────────────

const mockAddEvent = vi.fn().mockResolvedValue(undefined);
const mockUpdateEvent = vi.fn().mockResolvedValue(undefined);
const mockBulkAddEvents = vi.fn().mockResolvedValue(undefined);

vi.mock('@/store/useEventStore', () => ({
  useEventStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      addEvent: mockAddEvent,
      updateEvent: mockUpdateEvent,
      bulkAddEvents: mockBulkAddEvents,
      events: [],
    };
    return selector ? selector(state) : state;
  },
}));

const TEAM_A: Team = {
  id: 'team-a',
  name: 'City Hawks',
  sportType: 'soccer',
  color: '#ef4444',
  createdBy: 'uid-1',
  coachId: 'uid-1',
  attendanceWarningsEnabled: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
} as Team;

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector: (s: { teams: Team[] }) => unknown) =>
    selector({ teams: [TEAM_A] }),
}));

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (
    selector: (s: {
      profile: { uid: string; role: string; displayName: string; email: string };
      user: { uid: string };
    }) => unknown,
  ) =>
    selector({
      profile: { uid: 'uid-1', role: 'coach', displayName: 'Jane Coach', email: 'jane@example.com' },
      user: { uid: 'uid-1' },
    }),
}));

vi.mock('@/store/useOpponentStore', () => ({
  useOpponentStore: (
    selector?: (s: { opponents: never[]; addOpponent: () => Promise<void> }) => unknown,
  ) => {
    const state = { opponents: [] as never[], addOpponent: vi.fn().mockResolvedValue(undefined) };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (selector: (s: { players: never[] }) => unknown) =>
    selector({ players: [] }),
}));

vi.mock('@/store/useAvailabilityStore', () => ({
  useAvailabilityStore: (selector: (s: { isPlayerAvailable: () => boolean }) => unknown) =>
    selector({ isPlayerAvailable: () => true }),
}));

// Venue store mock — returns the geocoded venue; used by Part B tests.
// Each test that needs a different set of venues should override this via
// vi.mocked() or by restructuring; here a single geocoded venue is sufficient.
const SAVED_VENUES: Venue[] = [VENUE_WITH_COORDS];

vi.mock('@/store/useVenueStore', () => {
  const subscribe = vi.fn(() => () => {});
  const useVenueStore = (
    sel?: (s: { venues: Venue[]; subscribe: typeof subscribe }) => unknown,
  ) => {
    const state = { venues: SAVED_VENUES, subscribe };
    return sel ? sel(state) : state;
  };
  useVenueStore.getState = () => ({ venues: SAVED_VENUES, subscribe });
  return { useVenueStore };
});

// ── Import after mocks ────────────────────────────────────────────────────────

import { EventForm } from '@/components/events/EventForm';

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Component tests
// ─────────────────────────────────────────────────────────────────────────────

describe('EventForm — venue Select renders when venues exist (bug #81)', () => {
  it('renders the Venue dropdown when savedVenues is non-empty', () => {
    render(<EventForm open onClose={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: /venue/i })).toBeInTheDocument();
  });

  it('lists the saved venue as an option', () => {
    render(<EventForm open onClose={vi.fn()} />);
    expect(screen.getByText('City Park')).toBeInTheDocument();
  });
});

describe('EventForm — submit with venue selected writes venueId/venueLat/venueLng (bug #81)', () => {
  it('addEvent payload includes venueId, venueLat, venueLng when venue is selected', async () => {
    const user = userEvent.setup();
    render(<EventForm open onClose={vi.fn()} />);

    // Select the geocoded venue
    const venueSelect = screen.getByRole('combobox', { name: /venue/i });
    await user.selectOptions(venueSelect, 'venue-park');

    await user.click(screen.getByRole('button', { name: /create event/i }));

    await waitFor(() => {
      expect(mockAddEvent).toHaveBeenCalledOnce();
    });

    const [payload] = mockAddEvent.mock.calls[0] as [ScheduledEvent];
    expect(payload.venueId).toBe('venue-park');
    expect(payload.venueLat).toBe(37.7749);
    expect(payload.venueLng).toBe(-122.4194);
  });

  it('addEvent payload has venueLat and venueLng as numbers (checkWeatherAlerts fast-path)', async () => {
    const user = userEvent.setup();
    render(<EventForm open onClose={vi.fn()} />);

    const venueSelect = screen.getByRole('combobox', { name: /venue/i });
    await user.selectOptions(venueSelect, 'venue-park');

    await user.click(screen.getByRole('button', { name: /create event/i }));

    await waitFor(() => {
      expect(mockAddEvent).toHaveBeenCalledOnce();
    });

    const [payload] = mockAddEvent.mock.calls[0] as [ScheduledEvent];
    expect(typeof payload.venueLat).toBe('number');
    expect(typeof payload.venueLng).toBe('number');
  });
});

describe('EventForm — submit without venue selected omits venue fields (bug #81)', () => {
  it('addEvent payload has no venueId, venueLat, or venueLng when no venue is selected', async () => {
    const user = userEvent.setup();
    render(<EventForm open onClose={vi.fn()} />);

    // Do NOT select a venue — leave the picker at its empty placeholder
    await user.click(screen.getByRole('button', { name: /create event/i }));

    await waitFor(() => {
      expect(mockAddEvent).toHaveBeenCalledOnce();
    });

    const [payload] = mockAddEvent.mock.calls[0] as [ScheduledEvent];
    expect(payload.venueId).toBeUndefined();
    expect(payload.venueLat).toBeUndefined();
    expect(payload.venueLng).toBeUndefined();
  });
});
