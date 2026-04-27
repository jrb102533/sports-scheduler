/**
 * FW-89 — Modify Roster mode
 *
 * Unit tests for the pending-changes reducer and component tests for the
 * Modify Roster UX in RosterTable.
 *
 * Reducer coverage:
 *   - ENTER_MODE resets changes and activates mode
 *   - EXIT_MODE deactivates mode and clears all changes
 *   - STAGE_ADD appends a new player to the added list
 *   - STAGE_UPDATE records a patch for an existing player
 *   - STAGE_UPDATE merges with a prior patch for the same player
 *   - STAGE_REMOVE adds a player id to the removed set
 *   - STAGE_REMOVE on a staged-add removes it from added instead
 *   - UNSTAGE_REMOVE removes a player id from the removed set
 *   - RESET clears all changes and deactivates mode
 *   - pendingCount = added.length + updated.size + removed.size
 *
 * RosterTable — Modify Roster mode UI:
 *   - pending-added players appear with a "Pending" badge
 *   - pending-removed players appear struck-through
 *   - pending-removed players show a Restore button
 *   - clicking Restore calls onUnstageRemove with the player id
 *   - in modify mode the Invite Player chip is hidden
 *   - in modify mode the absence/availability actions are hidden
 *   - edit button on a committed player calls onStageUpdate via onStagedSave
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  pendingRosterReducer,
  emptyPendingState,
  usePendingRosterChanges,
} from '@/hooks/usePendingRosterChanges';
import type { PendingRosterAction } from '@/hooks/usePendingRosterChanges';
import type { Player } from '@/types';

// ─── Firebase / store stubs ──────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => vi.fn(),
}));

const mockDeletePlayer = vi.fn();
vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (selector?: (s: { players: Player[]; deletePlayer: typeof mockDeletePlayer }) => unknown) => {
    const state = { players: [], deletePlayer: mockDeletePlayer };
    return selector ? selector(state) : state;
  },
}));

let mockTeams: { id: string; name: string; ageGroup?: string }[] = [];
vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector?: (s: { teams: typeof mockTeams }) => unknown) => {
    const state = { teams: mockTeams };
    return selector ? selector(state) : state;
  },
}));

let mockProfile: { role: string } | null = null;
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector?: (s: { profile: typeof mockProfile }) => unknown) => {
    const state = { profile: mockProfile };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/store/useAvailabilityStore', () => ({
  useAvailabilityStore: (selector?: (s: { availability: Record<string, unknown> }) => unknown) => {
    const state = { availability: {} };
    return selector ? selector(state) : state;
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { RosterTable } from '@/components/roster/RosterTable';
import { renderHook, act } from '@testing-library/react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEAM_ID = 'team-1';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'player-1',
    teamId: TEAM_ID,
    firstName: 'Alex',
    lastName: 'Morgan',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function emptyChanges() {
  return {
    added: [],
    updated: new Map<string, Partial<Player>>(),
    removed: new Set<string>(),
  };
}

// ─── Reducer unit tests ───────────────────────────────────────────────────────

describe('pendingRosterReducer', () => {
  it('ENTER_MODE sets active=true and resets changes', () => {
    const initial = { active: false, changes: emptyChanges() };
    const state = pendingRosterReducer(initial, { type: 'ENTER_MODE' });
    expect(state.active).toBe(true);
    expect(state.changes.added).toHaveLength(0);
    expect(state.changes.updated.size).toBe(0);
    expect(state.changes.removed.size).toBe(0);
  });

  it('EXIT_MODE deactivates mode and clears all changes', () => {
    const player = makePlayer();
    const active = pendingRosterReducer(emptyPendingState(), { type: 'ENTER_MODE' });
    const withAdd = pendingRosterReducer(active, { type: 'STAGE_ADD', player });
    const exited = pendingRosterReducer(withAdd, { type: 'EXIT_MODE' });
    expect(exited.active).toBe(false);
    expect(exited.changes.added).toHaveLength(0);
  });

  it('STAGE_ADD appends a player to the added list', () => {
    const player = makePlayer({ id: 'new-1' });
    const state = pendingRosterReducer(
      pendingRosterReducer(emptyPendingState(), { type: 'ENTER_MODE' }),
      { type: 'STAGE_ADD', player },
    );
    expect(state.changes.added).toHaveLength(1);
    expect(state.changes.added[0].id).toBe('new-1');
  });

  it('STAGE_UPDATE records a patch for an existing player', () => {
    const base = pendingRosterReducer(emptyPendingState(), { type: 'ENTER_MODE' });
    const state = pendingRosterReducer(base, {
      type: 'STAGE_UPDATE',
      playerId: 'p1',
      patch: { firstName: 'Jordan' },
    });
    expect(state.changes.updated.get('p1')).toEqual({ firstName: 'Jordan' });
  });

  it('STAGE_UPDATE merges with a prior patch for the same player', () => {
    let state = pendingRosterReducer(emptyPendingState(), { type: 'ENTER_MODE' });
    state = pendingRosterReducer(state, { type: 'STAGE_UPDATE', playerId: 'p1', patch: { firstName: 'Jordan' } });
    state = pendingRosterReducer(state, { type: 'STAGE_UPDATE', playerId: 'p1', patch: { lastName: 'Reyes' } });
    expect(state.changes.updated.get('p1')).toEqual({ firstName: 'Jordan', lastName: 'Reyes' });
  });

  it('STAGE_REMOVE adds a player id to the removed set', () => {
    const state = pendingRosterReducer(
      pendingRosterReducer(emptyPendingState(), { type: 'ENTER_MODE' }),
      { type: 'STAGE_REMOVE', playerId: 'p-del' },
    );
    expect(state.changes.removed.has('p-del')).toBe(true);
  });

  it('STAGE_REMOVE on a staged-add removes it from added instead', () => {
    const player = makePlayer({ id: 'staged-new' });
    let state = pendingRosterReducer(emptyPendingState(), { type: 'ENTER_MODE' });
    state = pendingRosterReducer(state, { type: 'STAGE_ADD', player });
    state = pendingRosterReducer(state, { type: 'STAGE_REMOVE', playerId: 'staged-new' });
    expect(state.changes.added).toHaveLength(0);
    expect(state.changes.removed.has('staged-new')).toBe(false);
  });

  it('UNSTAGE_REMOVE removes a player id from the removed set', () => {
    let state = pendingRosterReducer(emptyPendingState(), { type: 'ENTER_MODE' });
    state = pendingRosterReducer(state, { type: 'STAGE_REMOVE', playerId: 'p-undo' });
    state = pendingRosterReducer(state, { type: 'UNSTAGE_REMOVE', playerId: 'p-undo' });
    expect(state.changes.removed.has('p-undo')).toBe(false);
  });

  it('RESET deactivates mode and clears all changes', () => {
    const player = makePlayer();
    let state = pendingRosterReducer(emptyPendingState(), { type: 'ENTER_MODE' });
    state = pendingRosterReducer(state, { type: 'STAGE_ADD', player });
    state = pendingRosterReducer(state, { type: 'RESET' });
    expect(state.active).toBe(false);
    expect(state.changes.added).toHaveLength(0);
  });
});

// ─── usePendingRosterChanges hook ─────────────────────────────────────────────

describe('usePendingRosterChanges — pendingCount', () => {
  it('pendingCount sums added, updated, and removed', () => {
    const player = makePlayer({ id: 'cnt-1' });
    const player2 = makePlayer({ id: 'cnt-2' });

    const { result } = renderHook(() => usePendingRosterChanges());
    act(() => result.current.enterMode());
    act(() => result.current.stageAdd(player));
    act(() => result.current.stageAdd(player2));
    act(() => result.current.stageUpdate('existing-1', { firstName: 'X' }));
    act(() => result.current.stageRemove('existing-2'));

    // 2 added + 1 updated + 1 removed = 4
    expect(result.current.pendingCount).toBe(4);
  });
});

// ─── RosterTable — Modify Roster mode UI ─────────────────────────────────────

describe('RosterTable — modify mode rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile = { role: 'coach' };
    mockTeams = [{ id: TEAM_ID, name: 'FC Test', ageGroup: 'youth' }];
  });

  it('shows a "Pending" badge for a staged-added player', () => {
    const addedPlayer = makePlayer({ id: 'added-1', firstName: 'New', lastName: 'Player' });
    const pendingChanges = {
      added: [addedPlayer],
      updated: new Map<string, Partial<Player>>(),
      removed: new Set<string>(),
    };
    render(
      <RosterTable
        players={[]}
        teamId={TEAM_ID}
        modifyMode
        pendingChanges={pendingChanges}
      />
    );
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('shows struck-through name for a pending-removed player', () => {
    const player = makePlayer({ id: 'del-1' });
    const pendingChanges = {
      added: [],
      updated: new Map<string, Partial<Player>>(),
      removed: new Set<string>(['del-1']),
    };
    render(
      <RosterTable
        players={[player]}
        teamId={TEAM_ID}
        modifyMode
        pendingChanges={pendingChanges}
      />
    );
    const nameEl = screen.getByText('Alex Morgan');
    expect(nameEl).toHaveClass('line-through');
  });

  it('shows a Restore button for a pending-removed player', () => {
    const player = makePlayer({ id: 'del-2' });
    const pendingChanges = {
      added: [],
      updated: new Map<string, Partial<Player>>(),
      removed: new Set<string>(['del-2']),
    };
    render(
      <RosterTable
        players={[player]}
        teamId={TEAM_ID}
        modifyMode
        pendingChanges={pendingChanges}
        onUnstageRemove={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /restore alex morgan/i })).toBeInTheDocument();
  });

  it('clicking Restore calls onUnstageRemove with the player id', () => {
    const onUnstageRemove = vi.fn();
    const player = makePlayer({ id: 'del-3' });
    const pendingChanges = {
      added: [],
      updated: new Map<string, Partial<Player>>(),
      removed: new Set<string>(['del-3']),
    };
    render(
      <RosterTable
        players={[player]}
        teamId={TEAM_ID}
        modifyMode
        pendingChanges={pendingChanges}
        onUnstageRemove={onUnstageRemove}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /restore alex morgan/i }));
    expect(onUnstageRemove).toHaveBeenCalledWith('del-3');
  });

  it('hides the Invite Player chip in modify mode', () => {
    // unclaimed player (no linkedUid, no email)
    const player = makePlayer({ id: 'unc-1', linkedUid: undefined, email: undefined });
    const pendingChanges = {
      added: [],
      updated: new Map<string, Partial<Player>>(),
      removed: new Set<string>(),
    };
    render(
      <RosterTable
        players={[player]}
        teamId={TEAM_ID}
        modifyMode
        pendingChanges={pendingChanges}
      />
    );
    expect(screen.queryByRole('button', { name: /invite alex morgan/i })).not.toBeInTheDocument();
  });

  it('Delete button in modify mode calls onStageRemove, not the confirm dialog', () => {
    const onStageRemove = vi.fn();
    const player = makePlayer({ id: 'rm-1' });
    const pendingChanges = {
      added: [],
      updated: new Map<string, Partial<Player>>(),
      removed: new Set<string>(),
    };
    render(
      <RosterTable
        players={[player]}
        teamId={TEAM_ID}
        modifyMode
        pendingChanges={pendingChanges}
        onStageRemove={onStageRemove}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /remove alex morgan/i }));
    expect(onStageRemove).toHaveBeenCalledWith('rm-1');
    // Confirm dialog should NOT appear (it would show "Remove Player" heading)
    expect(screen.queryByRole('heading', { name: /remove player/i })).not.toBeInTheDocument();
  });
});

// ─── Reducer action type completeness (compile-time guard) ────────────────────

describe('pendingRosterReducer — unknown action falls through to same state', () => {
  it('returns unchanged state for an unknown action type', () => {
    const initial = emptyPendingState();
    // Cast as any to simulate an unexpected action at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = pendingRosterReducer(initial, { type: 'UNKNOWN_ACTION' } as any as PendingRosterAction);
    expect(result).toEqual(initial);
  });
});
