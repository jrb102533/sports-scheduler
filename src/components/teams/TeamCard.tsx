import { Users, Crown } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { SportIcon } from '@/components/ui/SportIcon';
import { SPORT_TYPE_LABELS } from '@/constants';
import type { Team } from '@/types';

interface TeamCardProps {
  team: Team;
  playerCount: number;
  onClick?: () => void;
}

export function TeamCard({ team, playerCount, onClick }: TeamCardProps) {
  return (
    <Card className="overflow-hidden" onClick={onClick}>
      {/* Color strip */}
      <div className="h-1.5" style={{ backgroundColor: team.color }} />
      <div className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: team.color + '22', color: team.color }}
          >
            <SportIcon sport={team.sportType} size={22} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{team.name}</h3>
            <p className="text-xs text-gray-500">{SPORT_TYPE_LABELS[team.sportType]}</p>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Users size={12} className="text-gray-400" />
            {playerCount} {playerCount === 1 ? 'player' : 'players'}
          </span>
          <span className="flex items-center gap-1">
            <Crown size={10} className="text-amber-400" />
            {team.ownerName}
          </span>
        </div>

        {team.coachName && (
          <p className="text-xs text-gray-400 mt-1.5 pl-0.5">Coach: {team.coachName}</p>
        )}
      </div>
    </Card>
  );
}
