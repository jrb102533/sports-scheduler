import { useState, useCallback } from 'react';
import { Edit, Trash2, Phone, ShieldAlert, Bandage, CalendarX, Mail, Undo2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PlayerForm } from './PlayerForm';
import { PlayerStatusBadge } from './PlayerStatusBadge';
import { PlayerStatusModal } from './PlayerStatusModal';
import { MarkAbsenceModal } from './MarkAbsenceModal';
import { PlayerAvailabilityModal } from './PlayerAvailabilityModal';
import { InvitePlayerSheet } from './InvitePlayerSheet';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useAvailabilityStore } from '@/store/useAvailabilityStore';
import { PLAYER_STATUS_LABELS } from '@/constants';
import type { Player } from '@/types';
import type { PendingRosterChanges } from '@/hooks/usePendingRosterChanges';

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  injured: 'bg-red-100 text-red-700',
  suspended: 'bg-orange-100 text-orange-700',
  inactive: 'bg-gray-100 text-gray-600',
};

const absenceBadgeClass: Record<string, string> = {
  injured: 'bg-red-100 text-red-700',
  suspended: 'bg-amber-100 text-amber-700',
  other: 'bg-gray-100 text-gray-600',
};

const absenceLabel: Record<string, string> = {
  injured: 'Injured',
  suspended: 'Suspended',
  other: 'Unavailable',
};

function formatReturnDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/** Returns true if the player has any unavailability window within the next 30 days. */
function hasUpcomingUnavailability(playerId: string, availability: ReturnType<typeof useAvailabilityStore.getState>['availability']): boolean {
  const doc = availability[playerId];
  if (!doc || doc.windows.length === 0) return false;
  const today = new Date();
  const in30 = new Date(today);
  in30.setDate(today.getDate() + 30);
  const todayStr = today.toISOString().slice(0, 10);
  const in30Str = in30.toISOString().slice(0, 10);
  return doc.windows.some(w => w.endDate >= todayStr && w.startDate <= in30Str);
}

interface RosterTableProps {
  players: Player[];
  teamId: string;
  teamName?: string;
  /** When provided the table operates in Modify Roster mode. */
  modifyMode?: boolean;
  pendingChanges?: PendingRosterChanges;
  onStageAdd?: (player: Player) => void;
  onStageUpdate?: (playerId: string, patch: Partial<Player>) => void;
  onStageRemove?: (playerId: string) => void;
  onUnstageRemove?: (playerId: string) => void;
}

/**
 * Returns true when a player has no linked account AND no email address on
 * file that could be used to invite them (player email or either parent email).
 */
function isUnclaimed(player: Player): boolean {
  if (player.linkedUid || player.parentUid) return false;
  const hasEmail =
    (player.email ?? '').trim() !== '' ||
    (player.parentContact?.parentEmail ?? '').trim() !== '' ||
    (player.parentContact2?.parentEmail ?? '').trim() !== '';
  return !hasEmail;
}

export function RosterTable({
  players,
  teamId,
  teamName,
  modifyMode = false,
  pendingChanges,
  onStageAdd,
  onStageUpdate,
  onStageRemove,
  onUnstageRemove,
}: RosterTableProps) {
  const { deletePlayer } = usePlayerStore();
  const team = useTeamStore(s => s.teams.find(t => t.id === teamId));
  const profile = useAuthStore(s => s.profile);
  const availability = useAvailabilityStore(s => s.availability);
  const isAdultTeam = team?.ageGroup === 'adult';
  const isCoachOrAdmin =
    profile?.role === 'admin' ||
    profile?.role === 'league_manager' ||
    profile?.role === 'coach';
  const [editPlayer, setEditPlayer] = useState<Player | null>(null);
  const [deletePlayer_, setDeletePlayer] = useState<Player | null>(null);
  const [statusPlayer, setStatusPlayer] = useState<Player | null>(null);
  const [absencePlayer, setAbsencePlayer] = useState<Player | null>(null);
  const [availabilityPlayer, setAvailabilityPlayer] = useState<Player | null>(null);

  // Invite sheet
  const [invitePlayer, setInvitePlayer] = useState<Player | null>(null);

  // Filter to unclaimed only
  const [filterUnclaimed, setFilterUnclaimed] = useState(false);

  // Per-player "invite sent" done state — auto-clears after 2 s
  const [inviteSentIds, setInviteSentIds] = useState<Set<string>>(new Set());
  const handleInviteSuccess = useCallback((playerId: string) => {
    setInviteSentIds(prev => new Set(prev).add(playerId));
    setTimeout(() => {
      setInviteSentIds(prev => {
        const next = new Set(prev);
        next.delete(playerId);
        return next;
      });
    }, 2000);
  }, []);

  const resolvedTeamName = teamName ?? team?.name ?? '';
  const unclaimedPlayers = players.filter(isUnclaimed);

  // In modify mode, merge committed players with pending-added players for display.
  const pendingAdded = pendingChanges?.added ?? [];
  const pendingRemoved = pendingChanges?.removed ?? new Set<string>();
  const pendingUpdated = pendingChanges?.updated ?? new Map<string, Partial<Player>>();

  // Displayed rows: committed players (with optional pending-update overlay) + pending-added
  const committedRows: Array<Player & { _pendingRemove?: boolean; _pendingUpdate?: boolean }> =
    players.map(p => {
      const patch = pendingUpdated.get(p.id);
      return {
        ...p,
        ...(patch ?? {}),
        _pendingRemove: pendingRemoved.has(p.id),
        _pendingUpdate: patch !== undefined && !pendingRemoved.has(p.id),
      };
    });

  const addedRows: Array<Player & { _pendingAdd: true }> =
    pendingAdded.map(p => ({ ...p, _pendingAdd: true as const }));

  type DisplayRow =
    | (Player & { _pendingRemove?: boolean; _pendingUpdate?: boolean; _pendingAdd?: undefined })
    | (Player & { _pendingAdd: true; _pendingRemove?: undefined; _pendingUpdate?: undefined });

  const allRows: DisplayRow[] = modifyMode
    ? [...committedRows, ...addedRows]
    : players;

  const displayedRows = filterUnclaimed
    ? allRows.filter(p => isUnclaimed(p))
    : allRows;

  function handleEditOrStage(player: Player) {
    if (modifyMode && onStageUpdate) {
      setEditPlayer(player);
    } else {
      setEditPlayer(player);
    }
  }

  function handleDeleteOrStage(player: Player) {
    if (modifyMode && onStageRemove) {
      if ((player as DisplayRow & { _pendingAdd?: boolean })._pendingAdd) {
        // Removing a staged-add — just unstage it
        // We achieve this via stageRemove which handles the _pendingAdd case in the reducer
        onStageRemove(player.id);
      } else {
        onStageRemove(player.id);
      }
    } else {
      setDeletePlayer(player);
    }
  }

  function handleUnstageRemove(playerId: string) {
    onUnstageRemove?.(playerId);
  }

  if (players.length === 0 && pendingAdded.length === 0) {
    return <p className="text-sm text-gray-500 py-6 text-center">No players yet. Add your first player above.</p>;
  }

  return (
    <>
      {/* Roster summary line */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">
        <span className="text-sm text-gray-500">
          Roster &middot; {players.length} {players.length === 1 ? 'player' : 'players'}
          {modifyMode && pendingAdded.length > 0 && (
            <span className="text-blue-600 ml-1">(+{pendingAdded.length} pending)</span>
          )}
        </span>
        {unclaimedPlayers.length > 0 && (
          <button
            onClick={() => setFilterUnclaimed(f => !f)}
            className="text-sm font-medium text-orange-600 hover:text-orange-700 focus:outline-none focus:underline"
            aria-pressed={filterUnclaimed}
          >
            {filterUnclaimed
              ? 'Show all players'
              : `${unclaimedPlayers.length} not yet invited →`}
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">#</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
              <th className="hidden sm:table-cell px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Position</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
              {!isAdultTeam && (
                <th className="hidden md:table-cell px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Parent</th>
              )}
              <th className="hidden md:table-cell px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Emergency</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(displayedRows as DisplayRow[])
              .sort((a, b) => (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999))
              .map(player => {
                const isPendingAdd = (player as { _pendingAdd?: boolean })._pendingAdd === true;
                const isPendingRemove = (player as { _pendingRemove?: boolean })._pendingRemove === true;
                const isPendingUpdate = (player as { _pendingUpdate?: boolean })._pendingUpdate === true;

                return (
                  <tr
                    key={player.id}
                    className={[
                      'border-b border-gray-100',
                      isPendingRemove
                        ? 'bg-red-50/60 opacity-60'
                        : isPendingAdd
                          ? 'bg-blue-50/50 border-l-2 border-l-blue-400'
                          : isPendingUpdate
                            ? 'bg-yellow-50/40'
                            : 'hover:bg-gray-50',
                    ].join(' ')}
                  >
                    <td className="px-3 py-3 text-gray-500 text-sm">{player.jerseyNumber ?? '—'}</td>
                    <td className="px-3 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={[
                          'font-medium',
                          isPendingRemove ? 'line-through text-gray-400' : 'text-gray-900',
                        ].join(' ')}>
                          {player.firstName} {player.lastName}
                        </span>
                        {/* Pending state badges */}
                        {isPendingAdd && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 border border-blue-200">
                            <Plus size={10} aria-hidden="true" />
                            Pending
                          </span>
                        )}
                        {isPendingUpdate && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 border border-yellow-200">
                            Edited
                          </span>
                        )}
                        <PlayerStatusBadge player={player} showReturnDate />
                        {player.absence && !isPendingRemove && (
                          <Badge className={`${absenceBadgeClass[player.absence.type]}`}>
                            {absenceLabel[player.absence.type]}
                            {player.absence.returnDate && (
                              <span className="font-normal"> &middot; returns {formatReturnDate(player.absence.returnDate)}</span>
                            )}
                          </Badge>
                        )}
                        {/* Unclaimed chip — only visible to coaches/admins, not in modify mode */}
                        {!modifyMode && isCoachOrAdmin && inviteSentIds.has(player.id) && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 border border-green-200 text-green-700">
                            Invite Sent &#10003;
                          </span>
                        )}
                        {!modifyMode && isCoachOrAdmin && !inviteSentIds.has(player.id) && isUnclaimed(player) && (
                          <button
                            onClick={() => setInvitePlayer(player)}
                            aria-label={`Invite ${player.firstName} ${player.lastName}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-50 border border-orange-200 text-orange-700 hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-orange-300 min-h-[28px]"
                          >
                            <Mail size={12} aria-hidden="true" />
                            Invite Player
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="hidden sm:table-cell px-3 py-3 text-gray-600 text-sm">{player.position ?? '—'}</td>
                    <td className="px-3 py-3">
                      <Badge className={statusColors[player.status]}>{PLAYER_STATUS_LABELS[player.status]}</Badge>
                    </td>
                    {!isAdultTeam && (
                      <td className="hidden md:table-cell px-3 py-3 text-gray-600">
                        {player.parentContact?.parentName ? (
                          <div>
                            <div className="text-xs text-gray-700">{player.parentContact.parentName}</div>
                            {player.parentContact.parentPhone && (
                              <a href={`sms:${player.parentContact.parentPhone}`} className="text-xs text-blue-500 hover:underline flex items-center gap-0.5">
                                <Phone size={10} /> {player.parentContact.parentPhone}
                              </a>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                    )}
                    <td className="hidden md:table-cell px-3 py-3 text-gray-600">
                      {player.emergencyContact?.name ? (
                        <div>
                          <div className="text-xs text-gray-700">{player.emergencyContact.name}</div>
                          {player.emergencyContact.phone && (
                            <a href={`tel:${player.emergencyContact.phone}`} className="text-xs text-blue-500 hover:underline flex items-center gap-0.5">
                              <Phone size={10} /> {player.emergencyContact.phone}
                            </a>
                          )}
                          {player.emergencyContact.relationship && (
                            <div className="text-xs text-gray-400">{player.emergencyContact.relationship}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {/* In modify-remove state, show a Restore button instead of the normal actions */}
                        {isPendingRemove ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Restore ${player.firstName} ${player.lastName}`}
                            title="Restore — undo pending removal"
                            onClick={() => handleUnstageRemove(player.id)}
                          >
                            <Undo2 size={13} className="text-blue-500" />
                          </Button>
                        ) : (
                          <>
                            {!modifyMode && isCoachOrAdmin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setStatusPlayer(player)}
                                title="Update injury / suspension status"
                              >
                                <ShieldAlert size={13} className={player.status === 'injured' ? 'text-red-500' : player.status === 'suspended' ? 'text-orange-500' : 'text-gray-400'} />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Edit ${player.firstName} ${player.lastName}`}
                              onClick={() => handleEditOrStage(player)}
                            >
                              <Edit size={13} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Remove ${player.firstName} ${player.lastName}`}
                              onClick={() => handleDeleteOrStage(player)}
                            >
                              <Trash2 size={13} className="text-red-500" />
                            </Button>
                            {!modifyMode && isCoachOrAdmin && (
                              <span className="relative inline-flex">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  aria-label="Mark absence"
                                  onClick={() => setAbsencePlayer(player)}
                                >
                                  <Bandage size={13} className={player.absence ? 'text-red-500' : 'text-gray-500'} />
                                </Button>
                                {player.absence && (
                                  <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-red-400 ring-1 ring-white" />
                                )}
                              </span>
                            )}
                            {!modifyMode && (
                              <span className="relative inline-flex">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  aria-label="Manage unavailability"
                                  onClick={() => setAvailabilityPlayer(player)}
                                >
                                  <CalendarX size={13} className="text-gray-500" />
                                </Button>
                                {hasUpcomingUnavailability(player.id, availability) && (
                                  <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-white" />
                                )}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* PlayerForm — in modify mode, saves go to stageUpdate; in view mode, saves go directly to Firestore */}
      {editPlayer && (
        <PlayerForm
          key={editPlayer.id}
          open
          teamId={teamId}
          onClose={() => setEditPlayer(null)}
          editPlayer={editPlayer}
          {...(modifyMode && onStageUpdate
            ? {
                onStagedSave: (patch: Partial<Player>) => {
                  onStageUpdate(editPlayer.id, patch);
                  setEditPlayer(null);
                },
              }
            : {})}
        />
      )}
      {!modifyMode && statusPlayer && (
        <PlayerStatusModal
          open
          onClose={() => setStatusPlayer(null)}
          player={statusPlayer}
        />
      )}
      {!modifyMode && (
        <ConfirmDialog
          open={!!deletePlayer_}
          onClose={() => setDeletePlayer(null)}
          onConfirm={() => deletePlayer_ && deletePlayer(deletePlayer_.id)}
          title="Remove Player"
          message={`Remove ${deletePlayer_?.firstName} ${deletePlayer_?.lastName} from the roster?`}
          confirmLabel="Remove"
        />
      )}
      {!modifyMode && absencePlayer && (
        <MarkAbsenceModal
          open={!!absencePlayer}
          onClose={() => setAbsencePlayer(null)}
          player={absencePlayer}
          teamId={teamId}
        />
      )}
      {!modifyMode && availabilityPlayer && (
        <PlayerAvailabilityModal
          open={!!availabilityPlayer}
          onClose={() => setAvailabilityPlayer(null)}
          player={availabilityPlayer}
          teamId={teamId}
        />
      )}
      {!modifyMode && invitePlayer && (
        <InvitePlayerSheet
          open={!!invitePlayer}
          player={invitePlayer}
          teamName={resolvedTeamName}
          onClose={() => setInvitePlayer(null)}
          onSuccess={handleInviteSuccess}
        />
      )}
    </>
  );
}
