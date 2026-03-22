import { useEventStore } from '@/store/useEventStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { formatDate } from '@/lib/dateUtils';
import { Badge } from '@/components/ui/Badge';
import { clsx } from 'clsx';
import type { AttendanceStatus } from '@/types';

const statusStyle: Record<AttendanceStatus, string> = {
  present: 'bg-green-100 text-green-700',
  absent: 'bg-red-100 text-red-700',
  excused: 'bg-yellow-100 text-yellow-700',
};

interface PlayerAttendanceHistoryProps {
  teamId: string;
}

export function PlayerAttendanceHistory({ teamId }: PlayerAttendanceHistoryProps) {
  const events = useEventStore(s => s.events);
  const players = usePlayerStore(s => s.players);

  const teamPlayers = players.filter(p => p.teamId === teamId);
  const teamEvents = events
    .filter(e => e.teamIds.includes(teamId) && e.attendance && e.attendance.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (teamPlayers.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">No players on this team.</p>;
  }

  if (teamEvents.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">No attendance recorded yet. Mark attendance in the event detail panel.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Player</th>
            {teamEvents.slice(0, 8).map(e => (
              <th key={e.id} className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">
                {formatDate(e.date)}
              </th>
            ))}
            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">%</th>
          </tr>
        </thead>
        <tbody>
          {teamPlayers.map(player => {
            const recentEvents = teamEvents.slice(0, 8);
            const attended = recentEvents.filter(e =>
              e.attendance?.find(a => a.playerId === player.id)?.status === 'present'
            ).length;
            const total = recentEvents.filter(e => e.attendance?.find(a => a.playerId === player.id)).length;
            const pct = total > 0 ? Math.round((attended / total) * 100) : null;

            return (
              <tr key={player.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">
                  {player.firstName} {player.lastName}
                </td>
                {recentEvents.map(e => {
                  const record = e.attendance?.find(a => a.playerId === player.id);
                  return (
                    <td key={e.id} className="px-2 py-2.5 text-center">
                      {record ? (
                        <Badge className={clsx('text-xs', statusStyle[record.status])}>
                          {record.status === 'present' ? '✓' : record.status === 'absent' ? '✗' : 'E'}
                        </Badge>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-2.5 text-center text-xs font-semibold text-gray-700">
                  {pct !== null ? `${pct}%` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
