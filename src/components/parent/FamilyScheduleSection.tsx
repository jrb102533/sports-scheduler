import { MapPin, Users } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { useFamilySchedule } from '@/hooks/useFamilySchedule';
import { formatDate, formatTime } from '@/lib/dateUtils';

/**
 * Unified family schedule view shown only to parents with 2+ children on
 * different teams. Derives data from the existing global stores — no extra
 * Firestore reads.
 */
export function FamilyScheduleSection() {
  const { events, isLoading, isActive } = useFamilySchedule();

  if (!isActive) return null;

  return (
    <section aria-labelledby="family-schedule-heading">
      <h2
        id="family-schedule-heading"
        className="font-semibold text-gray-900 flex items-center gap-2 mb-3"
      >
        <Users size={16} className="text-purple-500" />
        Family Schedule
      </h2>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-sm text-gray-400">No upcoming games across your children's teams.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {events.map(event => {
            const opponent = event.opponentName ?? null;

            return (
              <Card key={event.id} className="p-4">
                <div className="flex items-start gap-3">
                  {/* Date block — coloured by team */}
                  <div
                    className="flex-shrink-0 w-12 rounded-lg flex flex-col items-center justify-center py-1.5 text-white"
                    style={{ backgroundColor: event.teamColor }}
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide leading-none">
                      {new Date(event.date + 'T12:00:00').toLocaleDateString(undefined, {
                        month: 'short',
                      })}
                    </span>
                    <span className="text-xl font-bold leading-tight">
                      {new Date(event.date + 'T12:00:00').getDate()}
                    </span>
                  </div>

                  {/* Event details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-gray-900 text-sm truncate">
                        {event.title}
                      </p>
                      {/* Child / team label badge */}
                      <span
                        className="flex-shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full text-white"
                        style={{ backgroundColor: event.teamColor }}
                        aria-label={`Child: ${event.childLabel}`}
                      >
                        {event.childLabel}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {formatDate(event.date)} at {formatTime(event.startTime)}
                    </p>
                    {opponent && (
                      <p className="text-xs text-gray-600 mt-0.5">vs. {opponent}</p>
                    )}
                    {event.location && (
                      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                        <MapPin size={10} />
                        {event.location}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Separator so the section feels distinct from the per-team Upcoming Games below */}
      <div className="mt-4 border-t border-gray-100" aria-hidden="true" />
    </section>
  );
}

