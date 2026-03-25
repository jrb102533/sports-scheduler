import { useState } from 'react';
import { Edit, Trash2, Phone, Bandage, CalendarX } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PlayerForm } from './PlayerForm';
import { MarkAbsenceModal } from './MarkAbsenceModal';
import { PlayerAvailabilityModal } from './PlayerAvailabilityModal';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useAvailabilityStore } from '@/store/useAvailabilityStore';
import { PLAYER_STATUS_LABELS } from '@/constants';
import type { Player } from '@/types';

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  injured: 'bg-red-100 text-red-700',
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
}

export function RosterTable({ players, teamId }: RosterTableProps) {
  const { deletePlayer } = usePlayerStore();
  const team = useTeamStore(s => s.teams.find(t => t.id === teamId));
  const isAdultTeam = team?.ageGroup === 'adult';
  const profile = useAuthStore(s => s.profile);
  const availability = useAvailabilityStore(s => s.availability);
  const isCoachOrAdmin =
    profile?.role === 'admin' ||
    profile?.role === 'league_manager' ||
    profile?.role === 'coach';
  const [editPlayer, setEditPlayer] = useState<Player | null>(null);
  const [deletePlayer_, setDeletePlayer] = useState<Player | null>(null);
  const [absencePlayer, setAbsencePlayer] = useState<Player | null>(null);
  const [availabilityPlayer, setAvailabilityPlayer] = useState<Player | null>(null);

  if (players.length === 0) {
    return <p className="text-sm text-gray-500 py-6 text-center">No players yet. Add your first player above.</p>;
  }

  return (
    <>
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
            {players.sort((a, b) => (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999)).map(player => (
              <tr key={player.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-3 text-gray-500 text-sm">{player.jerseyNumber ?? '\u2014'}</td>
                <td className="px-3 py-3 text-sm">
                  <span className="font-medium text-gray-900">{player.firstName} {player.lastName}</span>
                  {player.absence && (
                    <Badge className={`ml-2 ${absenceBadgeClass[player.absence.type]}`}>
                      {absenceLabel[player.absence.type]}
                      {player.absence.returnDate && (
                        <span className="font-normal"> &middot; returns {formatReturnDate(player.absence.returnDate)}</span>
                      )}
                    </Badge>
                  )}
                </td>
                <td className="hidden sm:table-cell px-3 py-3 text-gray-600 text-sm">{player.position ?? '\u2014'}</td>
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
                      <span className="text-gray-300 text-xs">\u2014</span>
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
                    <span className="text-gray-300 text-xs">\u2014</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditPlayer(player)}><Edit size={13} /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeletePlayer(player)}><Trash2 size={13} className="text-red-500" /></Button>
                    {isCoachOrAdmin && (
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
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editPlayer && <PlayerForm open teamId={teamId} onClose={() => setEditPlayer(null)} editPlayer={editPlayer} />}
      <ConfirmDialog
        open={!!deletePlayer_}
        onClose={() => setDeletePlayer(null)}
        onConfirm={() => deletePlayer_ && deletePlayer(deletePlayer_.id)}
        title="Remove Player"
        message={`Remove ${deletePlayer_?.firstName} ${deletePlayer_?.lastName} from the roster?`}
        confirmLabel="Remove"
      />
      {absencePlayer && (
        <MarkAbsenceModal
          open={!!absencePlayer}
          onClose={() => setAbsencePlayer(null)}
          player={absencePlayer}
          teamId={teamId}
        />
      )}
      {availabilityPlayer && (
        <PlayerAvailabilityModal
          open={!!availabilityPlayer}
          onClose={() => setAvailabilityPlayer(null)}
          player={availabilityPlayer}
          teamId={teamId}
        />
      )}
    </>
  );
}
