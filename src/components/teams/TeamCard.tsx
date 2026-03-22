import { Users, Crown } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { SPORT_TYPE_LABELS } from '@/constants';
import type { Team } from '@/types';

interface TeamCardProps {
  team: Team;
  playerCount: number;
  onClick?: () => void;
}

export function TeamCard({ team, playerCount, onClick }: TeamCardProps) {
  return (
    <Card className="p-5" onClick={onClick}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
          style={{ backgroundColor: team.color }}>
          {team.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{team.name}</h3>
          <p className="text-xs text-gray-500">{SPORT_TYPE_LABELS[team.sportType]}</p>
        </div>
      </div>
      <div className="flex items-center gap-1 text-sm text-gray-600">
        <Users size={14} className="text-gray-400" />
        {playerCount} {playerCount === 1 ? 'player' : 'players'}
      </div>
      <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
        <Crown size={10} className="text-amber-400" /> {team.ownerName}
      </p>
      {team.coachName && (
        <p className="text-xs text-gray-500 mt-1">Coach: {team.coachName}</p>
      )}
    </Card>
  );
}
