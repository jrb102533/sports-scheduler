import { useReducer, useCallback } from 'react';
import type { Player } from '@/types';
import type { PendingRosterChanges } from '@/store/usePlayerStore';

export type { PendingRosterChanges };

// ─── State ────────────────────────────────────────────────────────────────────

export interface PendingRosterState {
  active: boolean;
  changes: PendingRosterChanges;
}

function emptyChanges(): PendingRosterChanges {
  return {
    added: [],
    updated: new Map<string, Partial<Player>>(),
    removed: new Set<string>(),
  };
}

export function emptyPendingState(): PendingRosterState {
  return { active: false, changes: emptyChanges() };
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export type PendingRosterAction =
  | { type: 'ENTER_MODE' }
  | { type: 'EXIT_MODE' }
  | { type: 'STAGE_ADD'; player: Player }
  | { type: 'STAGE_UPDATE'; playerId: string; patch: Partial<Player> }
  | { type: 'STAGE_REMOVE'; playerId: string }
  | { type: 'UNSTAGE_REMOVE'; playerId: string }
  | { type: 'UNSTAGE_ADD'; playerId: string }
  | { type: 'RESET' };

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function pendingRosterReducer(
  state: PendingRosterState,
  action: PendingRosterAction,
): PendingRosterState {
  switch (action.type) {
    case 'ENTER_MODE':
      return { active: true, changes: emptyChanges() };

    case 'EXIT_MODE':
    case 'RESET':
      return emptyPendingState();

    case 'STAGE_ADD': {
      const added = [...state.changes.added, action.player];
      return { ...state, changes: { ...state.changes, added } };
    }

    case 'STAGE_UPDATE': {
      const updated = new Map(state.changes.updated);
      const existing = updated.get(action.playerId) ?? {};
      updated.set(action.playerId, { ...existing, ...action.patch });
      return { ...state, changes: { ...state.changes, updated } };
    }

    case 'STAGE_REMOVE': {
      // If the player was staged as added, just unstage the add instead.
      const isAdded = state.changes.added.some(p => p.id === action.playerId);
      if (isAdded) {
        const added = state.changes.added.filter(p => p.id !== action.playerId);
        const updated = new Map(state.changes.updated);
        updated.delete(action.playerId);
        return { ...state, changes: { ...state.changes, added, updated } };
      }
      const removed = new Set(state.changes.removed);
      removed.add(action.playerId);
      return { ...state, changes: { ...state.changes, removed } };
    }

    case 'UNSTAGE_REMOVE': {
      const removed = new Set(state.changes.removed);
      removed.delete(action.playerId);
      return { ...state, changes: { ...state.changes, removed } };
    }

    case 'UNSTAGE_ADD': {
      const added = state.changes.added.filter(p => p.id !== action.playerId);
      return { ...state, changes: { ...state.changes, added } };
    }

    default:
      return state;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface PendingRosterAPI {
  state: PendingRosterState;
  enterMode: () => void;
  exitMode: () => void;
  stageAdd: (player: Player) => void;
  stageUpdate: (playerId: string, patch: Partial<Player>) => void;
  stageRemove: (playerId: string) => void;
  unstageRemove: (playerId: string) => void;
  pendingCount: number;
}

export function usePendingRosterChanges(): PendingRosterAPI {
  const [state, dispatch] = useReducer(pendingRosterReducer, emptyPendingState());

  const enterMode = useCallback(() => dispatch({ type: 'ENTER_MODE' }), []);
  const exitMode = useCallback(() => dispatch({ type: 'EXIT_MODE' }), []);
  const stageAdd = useCallback((player: Player) => dispatch({ type: 'STAGE_ADD', player }), []);
  const stageUpdate = useCallback((playerId: string, patch: Partial<Player>) =>
    dispatch({ type: 'STAGE_UPDATE', playerId, patch }), []);
  const stageRemove = useCallback((playerId: string) => dispatch({ type: 'STAGE_REMOVE', playerId }), []);
  const unstageRemove = useCallback((playerId: string) => dispatch({ type: 'UNSTAGE_REMOVE', playerId }), []);

  const pendingCount =
    state.changes.added.length +
    state.changes.updated.size +
    state.changes.removed.size;

  return { state, enterMode, exitMode, stageAdd, stageUpdate, stageRemove, unstageRemove, pendingCount };
}
