import { useMemo } from 'react';
import { useAuthStore, getMemberships } from '@/store/useAuthStore';
import { useEventStore } from '@/store/useEventStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useTeamStore } from '@/store/useTeamStore';
import { todayISO } from '@/lib/dateUtils';
import type { ScheduledEvent } from '@/types';

export interface FamilyEvent extends ScheduledEvent {
  /** Child's display name, or team name as fallback. */
  childLabel: string;
  /** Team colour for display. */
  teamColor: string;
}

export interface UseFamilyScheduleResult {
  events: FamilyEvent[];
  isLoading: boolean;
  /** True when the user has 2+ parent memberships and the feature is active. */
  isActive: boolean;
}

/**
 * Derives a unified, chronologically-sorted list of upcoming events across
 * ALL teams where the current user has a parent membership.
 *
 * No additional Firestore listeners are opened — this hook projects from the
 * already-subscribed global event/player/team stores that MainLayout initialises
 * on mount. Single-team parents get isActive=false and an empty events array.
 */
export function useFamilySchedule(): UseFamilyScheduleResult {
  const profile = useAuthStore(s => s.profile);
  const allEvents = useEventStore(s => s.events);
  const eventsLoading = useEventStore(s => s.loading);
  const allPlayers = usePlayerStore(s => s.players);
  const playersLoading = usePlayerStore(s => s.loading);
  const allTeams = useTeamStore(s => s.teams);
  const teamsLoading = useTeamStore(s => s.loading);

  const isLoading = eventsLoading || playersLoading || teamsLoading;

  const parentMemberships = useMemo(() => {
    const memberships = getMemberships(profile);
    return memberships.filter(m => m.role === 'parent' && m.teamId);
  }, [profile]);

  const isActive = parentMemberships.length >= 2;

  const events = useMemo<FamilyEvent[]>(() => {
    if (!isActive) return [];

    const today = todayISO();

    // Build a lookup: teamId -> { childLabel, teamColor }
    const teamMeta: Record<string, { childLabel: string; teamColor: string }> = {};
    for (const m of parentMemberships) {
      if (!m.teamId) continue;
      const team = allTeams.find(t => t.id === m.teamId);
      const teamColor = team?.color ?? '#1B3A6B';

      let childLabel = team?.name ?? m.teamId;
      if (m.playerId) {
        const player = allPlayers.find(p => p.id === m.playerId);
        if (player) {
          childLabel = `${player.firstName} ${player.lastName}`.trim();
        }
      }

      teamMeta[m.teamId] = { childLabel, teamColor };
    }

    const parentTeamIds = new Set(Object.keys(teamMeta));

    return allEvents
      .filter(
        e =>
          e.status !== 'cancelled' &&
          e.date >= today &&
          e.teamIds.some(id => parentTeamIds.has(id)),
      )
      .map(e => {
        // Find the first teamId from the event that belongs to this parent.
        const matchedTeamId = e.teamIds.find(id => parentTeamIds.has(id)) ?? '';
        const meta = teamMeta[matchedTeamId] ?? { childLabel: matchedTeamId, teamColor: '#1B3A6B' };
        return {
          ...e,
          childLabel: meta.childLabel,
          teamColor: meta.teamColor,
        };
      })
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.startTime.localeCompare(b.startTime),
      );
  }, [isActive, parentMemberships, allEvents, allPlayers, allTeams]);

  return { events, isLoading, isActive };
}
