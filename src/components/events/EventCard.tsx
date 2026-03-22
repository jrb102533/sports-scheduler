import { MapPin, Clock } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EventStatusBadge } from './EventStatusBadge';
import { formatDate, formatTime } from '@/lib/dateUtils';
import { EVENT_TYPE_LABELS, EVENT_TYPE_COLORS } from '@/constants';
import type { ScheduledEvent, Team } from '@/types';

interface EventCardProps {
  event: ScheduledEvent;
  teams: Team[];
  onClick?: () => void;
}

export function EventCard({ event, teams, onClick }: EventCardProps) {
  const homeTeam = teams.find(t => t.id === event.homeTeamId);
  const awayTeam = teams.find(t => t.id === event.awayTeamId);
  const accentColor = EVENT_TYPE_COLORS[event.type] ?? '#6b7280';

  return (
    <Card className="overflow-hidden" onClick={onClick}>
      <div className="flex">
        {/* Left type accent bar */}
        <div className="w-1 flex-shrink-0" style={{ backgroundColor: accentColor }} />
        <div className="flex-1 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: accentColor }}
                >
                  {EVENT_TYPE_LABELS[event.type]}
                </span>
                <EventStatusBadge status={event.status} />
              </div>
              <h3 className="font-semibold text-gray-900 truncate">{event.title}</h3>

              {(homeTeam || awayTeam) && (
                <div className="flex items-center gap-1.5 mt-1">
                  {homeTeam && (
                    <span className="flex items-center gap-1 text-sm text-gray-700">
                      <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: homeTeam.color }} />
                      {homeTeam.name}
                    </span>
                  )}
                  {homeTeam && awayTeam && <span className="text-xs text-gray-400">vs</span>}
                  {awayTeam && (
                    <span className="flex items-center gap-1 text-sm text-gray-700">
                      <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: awayTeam.color }} />
                      {awayTeam.name}
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  {formatDate(event.date)} · {formatTime(event.startTime)}
                </span>
                {event.location && (
                  <span className="flex items-center gap-1">
                    <MapPin size={12} />
                    {event.location}
                  </span>
                )}
              </div>

              {event.result && (
                <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-sm font-bold text-gray-800">
                  {event.result.homeScore} – {event.result.awayScore}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
