import { Cookie } from 'lucide-react';
import type { ScheduledEvent, Team } from '@/types';

interface EventChipProps {
  event: ScheduledEvent;
  teams: Team[];
  onClick?: () => void;
}

export function EventChip({ event, teams, onClick }: EventChipProps) {
  const team = teams.find(t => t.id === event.homeTeamId || t.id === event.teamIds[0]);
  const color = team?.color ?? '#3b82f6';

  return (
    <div
      onClick={e => { e.stopPropagation(); onClick?.(); }}
      className="text-xs px-1.5 py-0.5 rounded font-medium truncate cursor-pointer hover:opacity-80 text-white flex items-center gap-1"
      style={{ backgroundColor: color }}
      title={event.title}
    >
      <span className="truncate">{event.startTime.slice(0, 5)} {event.title}</span>
      {event.snackVolunteer && <Cookie size={10} className="flex-shrink-0 opacity-90" />}
    </div>
  );
}
