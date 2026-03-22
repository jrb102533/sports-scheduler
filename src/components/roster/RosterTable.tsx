import { useState } from 'react';
import { Edit, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PlayerForm } from './PlayerForm';
import { usePlayerStore } from '@/store/usePlayerStore';
import { PLAYER_STATUS_LABELS } from '@/constants';
import type { Player } from '@/types';

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  injured: 'bg-red-100 text-red-700',
  inactive: 'bg-gray-100 text-gray-600',
};

interface RosterTableProps {
  players: Player[];
  teamId: string;
}

export function RosterTable({ players, teamId }: RosterTableProps) {
  const { deletePlayer } = usePlayerStore();
  const [editPlayer, setEditPlayer] = useState<Player | null>(null);
  const [deletePlayer_, setDeletePlayer] = useState<Player | null>(null);

  if (players.length === 0) {
    return <p className="text-sm text-gray-500 py-6 text-center">No players yet. Add your first player above.</p>;
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">#</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Position</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {players.sort((a, b) => (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999)).map(player => (
              <tr key={player.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-500">{player.jerseyNumber ?? '—'}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{player.firstName} {player.lastName}</td>
                <td className="px-4 py-3 text-gray-600">{player.position ?? '—'}</td>
                <td className="px-4 py-3">
                  <Badge className={statusColors[player.status]}>{PLAYER_STATUS_LABELS[player.status]}</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditPlayer(player)}><Edit size={13} /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeletePlayer(player)}><Trash2 size={13} className="text-red-500" /></Button>
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
        onConfirm={() => deletePlayer_  && deletePlayer(deletePlayer_.id)}
        title="Remove Player"
        message={`Remove ${deletePlayer_?.firstName} ${deletePlayer_?.lastName} from the roster?`}
        confirmLabel="Remove"
      />
    </>
  );
}
