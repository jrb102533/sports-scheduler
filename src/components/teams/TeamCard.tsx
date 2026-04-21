import { Users, Crown } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SportIcon } from '@/components/ui/SportIcon';
import { SPORT_TYPE_LABELS, AGE_GROUP_LABELS } from '@/constants';
import type { Team } from '@/types';

interface TeamCardProps {
  team: Team;
  playerCount: number;
  pendingRequestCount?: number;
  onClick?: () => void;
}

export function TeamCard({ team, playerCount, pendingRequestCount, onClick }: TeamCardProps) {
  return (
    <Card className="overflow-hidden" onClick={onClick}>
      {/* Color strip */}
      <div className="h-1.5" style={{ backgroundColor: team.color }} />
      <div className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="relative flex-shrink-0">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center overflow-hidden"
              style={team.logoUrl ? {} : { backgroundColor: team.color + '22', color: team.color }}
            >
              {team.logoUrl
                ? <img src={team.logoUrl} alt={team.name} className="w-full h-full object-contain" />
                : <SportIcon sport={team.sportType} size={22} />
              }
            </div>
            {pendingRequestCount != null && pendingRequestCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none">
                {pendingRequestCount > 9 ? '9+' : pendingRequestCount}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{team.name}</h3>
            <p className="text-xs text-gray-500">{SPORT_TYPE_LABELS[team.sportType]}</p>
            {team.ageGroup && (
              <div className="mt-1">
                <Badge variant="default" className="text-[10px] px-1.5 py-0 font-medium text-gray-500 bg-gray-100">
                  {AGE_GROUP_LABELS[team.ageGroup]}
                </Badge>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Users size={12} className="text-gray-400" />
            {playerCount} {playerCount === 1 ? 'player' : 'players'}
          </span>
          <span className="flex items-center gap-1 text-sm">
            <Crown size={10} className="text-amber-400" />
            {team.ownerName}
          </span>
        </div>

        {team.coachName && (
          <p className="text-sm text-gray-400 mt-1.5 pl-0.5">Coach: {team.coachName}</p>
        )}
      </div>
    </Card>
  );
}
