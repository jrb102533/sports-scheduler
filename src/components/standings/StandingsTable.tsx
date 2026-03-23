import { clsx } from 'clsx';
import { useTeamStore } from '@/store/useTeamStore';
import { useEventStore } from '@/store/useEventStore';
import { computeStandings } from '@/lib/standingsUtils';

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return (
    <span className="w-6 h-6 rounded-full bg-amber-400 text-white text-xs font-bold flex items-center justify-center">1</span>
  );
  if (rank === 2) return (
    <span className="w-6 h-6 rounded-full bg-gray-300 text-gray-700 text-xs font-bold flex items-center justify-center">2</span>
  );
  if (rank === 3) return (
    <span className="w-6 h-6 rounded-full bg-orange-300 text-white text-xs font-bold flex items-center justify-center">3</span>
  );
  return <span className="text-gray-400 text-xs w-6 text-center">{rank}</span>;
}

export function StandingsTable({ teamIds }: { teamIds?: string[] } = {}) {
  const allTeams = useTeamStore(s => s.teams);
  const events = useEventStore(s => s.events);
  const teams = teamIds ? allTeams.filter(t => teamIds.includes(t.id)) : allTeams;
  const rows = computeStandings(events, teams);

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500 py-8 text-center">No teams yet. Add teams to see standings.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50/60">
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase w-10"></th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Team</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">GP</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">W</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">L</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">T</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">PF</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">PA</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Diff</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-800 uppercase">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.teamId}
              className={clsx(
                'border-b border-gray-100 hover:bg-gray-50 transition-colors',
                i === 0 && 'bg-amber-50/40'
              )}
            >
              <td className="px-4 py-3">
                <div className="flex items-center justify-center">
                  <RankBadge rank={i + 1} />
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: row.teamColor }} />
                  <span className={clsx('font-medium text-gray-900', i === 0 && 'font-semibold')}>{row.teamName}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-center text-gray-600">{row.gamesPlayed}</td>
              <td className="px-4 py-3 text-center text-green-600 font-medium">{row.wins}</td>
              <td className="px-4 py-3 text-center text-red-500 font-medium">{row.losses}</td>
              <td className="px-4 py-3 text-center text-gray-500">{row.ties}</td>
              <td className="px-4 py-3 text-center text-gray-600">{row.pointsFor}</td>
              <td className="px-4 py-3 text-center text-gray-600">{row.pointsAgainst}</td>
              <td className="px-4 py-3 text-center text-gray-600">{row.pointsDiff > 0 ? `+${row.pointsDiff}` : row.pointsDiff}</td>
              <td className="px-4 py-3 text-center font-bold text-gray-900">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
