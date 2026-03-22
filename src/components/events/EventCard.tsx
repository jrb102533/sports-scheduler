import { MapPin, Clock } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EventStatusBadge } from './EventStatusBadge';
import { formatDate, formatTime } from '@/lib/dateUtils';
import { EVENT_TYPE_LABELS } from '@/constants';
import type { ScheduledEvent, Team } from '@/types';

interface EventCardProps {
  event: ScheduledEvent;
  teams: Team[];
  onClick?: () => void;
}

export function EventCard({ event, teams, onClick }: EventCardProps) {
  const homeTeam = teams.find(t => t.id === event.homeTeamId);
  const awayTeam = teams.find(t => t.id === event.awayTeamId);

  return (
    <Card className="p-4" onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-gray-500 font-medium">{EVENT_TYPE_LABELS[event.type]}</span>
            <EventStatusBadge status={event.status} />
          </div>
          <h3 className="font-semibold text-gray-900 truncate">{event.title}</h3>
          {(homeTeam || awayTeam) && (
            <p className="text-sm text-gray-600 mt-0.5">
              {homeTeam?.name} {homeTeam && awayTeam ? 'vs' : ''} {awayTeam?.name}
            </p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {formatDate(event.date)} {formatTime(event.startTime)}
            </span>
            {event.location && (
              <span className="flex items-center gap-1">
                <MapPin size={12} />
                {event.location}
              </span>
            )}
          </div>
          {event.result && (
            <div className="mt-2 text-sm font-semibold text-gray-800">
              Score: {event.result.homeScore} – {event.result.awayScore}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
