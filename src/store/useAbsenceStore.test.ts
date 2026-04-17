/**
 * useAbsenceStore — unit tests
 *
 * Behaviors under test:
 *   - fetchAbsences fetches from the correct Firestore path and stores by teamId
 *   - fetchAbsences sets loading: true during fetch, false after
 *   - addAbsence writes to Firestore and immediately updates store state
 *   - updateAbsence patches the document
 *   - resolveAbsence sets resolvedAt
 *   - getActiveAbsences filters by !resolvedAt AND endDate >= today
 *   - getActiveAbsenceForPlayer finds the correct absence for a specific player
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Absence } from '@/types';

// ── Firestore mock ────────────────────────────────────────────────────────────

const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockDoc = vi.fn(() => ({}));
const mockCollection = vi.fn(() => ({}));
const mockQuery = vi.fn(q => q);
const mockOrderBy = vi.fn(() => ({}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

// ── Import store after mocks ──────────────────────────────────────────────────

import { useAbsenceStore } from './useAbsenceStore';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeAbsence(id: string, overrides: Partial<Absence> = {}): Absence {
  return {
    id,
    teamId: 'team-1',
    playerId: `player-${id}`,
    type: 'vacation',
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2099-12-31',
    description: 'Away',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Absence;
}

function makeGetDocsResult(absences: Absence[]) {
  return { docs: absences.map(a => ({ id: a.id, data: () => a })) };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
  mockUpdateDoc.mockResolvedValue(undefined);
  mockGetDocs.mockResolvedValue(makeGetDocsResult([]));
  useAbsenceStore.setState({ absencesByTeam: {}, loading: false });
});

// ── fetchAbsences() ───────────────────────────────────────────────────────────

describe('useAbsenceStore — fetchAbsences', () => {
  it('stores fetched absences under the correct teamId key', async () => {
    const absences = [makeAbsence('a1'), makeAbsence('a2')];
    mockGetDocs.mockResolvedValue(makeGetDocsResult(absences));

    await useAbsenceStore.getState().fetchAbsences('team-1');
    expect(useAbsenceStore.getState().absencesByTeam['team-1']).toHaveLength(2);
  });

  it('sets loading: false after fetch completes', async () => {
    await useAbsenceStore.getState().fetchAbsences('team-1');
    expect(useAbsenceStore.getState().loading).toBe(false);
  });

  it('sets loading: false even if getDocs throws', async () => {
    mockGetDocs.mockRejectedValue(new Error('Firestore error'));
    try {
      await useAbsenceStore.getState().fetchAbsences('team-1');
    } catch {
      // expected
    }
    expect(useAbsenceStore.getState().loading).toBe(false);
  });

  it('does not clobber absences for other teams', async () => {
    useAbsenceStore.setState({
      absencesByTeam: { 'team-2': [makeAbsence('existing')] },
    });
    mockGetDocs.mockResolvedValue(makeGetDocsResult([makeAbsence('a1')]));

    await useAbsenceStore.getState().fetchAbsences('team-1');
    expect(useAbsenceStore.getState().absencesByTeam['team-2']).toHaveLength(1);
    expect(useAbsenceStore.getState().absencesByTeam['team-1']).toHaveLength(1);
  });
});

// ── addAbsence() ──────────────────────────────────────────────────────────────

describe('useAbsenceStore — addAbsence', () => {
  it('writes to Firestore', async () => {
    await useAbsenceStore.getState().addAbsence(makeAbsence('a1'));
    expect(mockSetDoc).toHaveBeenCalledOnce();
  });

  it('immediately adds the absence to the store', async () => {
    const absence = makeAbsence('a1', { teamId: 'team-1' });
    await useAbsenceStore.getState().addAbsence(absence);
    const stored = useAbsenceStore.getState().absencesByTeam['team-1'];
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('a1');
  });

  it('prepends to existing absences (newest first)', async () => {
    useAbsenceStore.setState({
      absencesByTeam: { 'team-1': [makeAbsence('old')] },
    });
    await useAbsenceStore.getState().addAbsence(makeAbsence('new', { teamId: 'team-1' }));
    const stored = useAbsenceStore.getState().absencesByTeam['team-1'];
    expect(stored[0].id).toBe('new'); // newest first
    expect(stored[1].id).toBe('old');
  });
});

// ── resolveAbsence() ──────────────────────────────────────────────────────────

describe('useAbsenceStore — resolveAbsence', () => {
  it('calls updateDoc with a resolvedAt timestamp', async () => {
    await useAbsenceStore.getState().resolveAbsence('team-1', 'absence-1');
    const patch = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(typeof patch.resolvedAt).toBe('string');
    expect(patch.resolvedAt).not.toBeNull();
  });
});

// ── getActiveAbsences() ───────────────────────────────────────────────────────

describe('useAbsenceStore — getActiveAbsences', () => {
  it('returns absences where endDate >= today and not resolvedAt', () => {
    const today = new Date().toISOString().slice(0, 10);
    const future = '2099-12-31';
    const past = '2020-01-01';
    useAbsenceStore.setState({
      absencesByTeam: {
        'team-1': [
          makeAbsence('active', { endDate: future }),
          makeAbsence('expired', { endDate: past }),
          makeAbsence('resolved', { endDate: future, resolvedAt: today }),
        ],
      },
    });

    const active = useAbsenceStore.getState().getActiveAbsences('team-1');
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('active');
  });

  it('returns [] when there are no absences for the team', () => {
    expect(useAbsenceStore.getState().getActiveAbsences('unknown-team')).toEqual([]);
  });

  it('returns [] when all absences are resolved', () => {
    useAbsenceStore.setState({
      absencesByTeam: {
        'team-1': [makeAbsence('a', { resolvedAt: '2026-01-01' })],
      },
    });
    expect(useAbsenceStore.getState().getActiveAbsences('team-1')).toEqual([]);
  });
});

// ── getActiveAbsenceForPlayer() ───────────────────────────────────────────────

describe('useAbsenceStore — getActiveAbsenceForPlayer', () => {
  it('returns the active absence for a specific player', () => {
    useAbsenceStore.setState({
      absencesByTeam: {
        'team-1': [
          makeAbsence('a1', { playerId: 'player-A', endDate: '2099-12-31' }),
          makeAbsence('a2', { playerId: 'player-B', endDate: '2099-12-31' }),
        ],
      },
    });
    const result = useAbsenceStore.getState().getActiveAbsenceForPlayer('team-1', 'player-A');
    expect(result?.id).toBe('a1');
  });

  it('returns undefined when the player has no active absence', () => {
    useAbsenceStore.setState({
      absencesByTeam: {
        'team-1': [makeAbsence('a1', { playerId: 'player-A', resolvedAt: '2026-01-01' })],
      },
    });
    expect(useAbsenceStore.getState().getActiveAbsenceForPlayer('team-1', 'player-A')).toBeUndefined();
  });

  it('returns undefined when team has no absences', () => {
    expect(useAbsenceStore.getState().getActiveAbsenceForPlayer('unknown', 'player-A')).toBeUndefined();
  });
});
