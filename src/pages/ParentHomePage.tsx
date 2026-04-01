import { CalendarDays, MapPin, Users } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { useEventStore } from '@/store/useEventStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useAuthStore, getMemberships } from '@/store/useAuthStore';
import { isUpcoming, formatDate, formatTime, todayISO } from '@/lib/dateUtils';
import { SPORT_TYPE_LABELS } from '@/constants';
import type { Team } from '@/types';

function resolveParentTeams(
  profile: ReturnType<typeof useAuthStore.getState>['profile'],
  allTeams: Team[]
): Team[] {
  if (!profile) return [];

  const teamIds = new Set<string>();

  // 1. Collect teamIds from all memberships
  const memberships = getMemberships(profile);
  for (const m of memberships) {
    if (m.teamId) teamIds.add(m.teamId);
  }

  // 2. Legacy: top-level teamId field
  if (profile.teamId) teamIds.add(profile.teamId);

  if (teamIds.size > 0) {
    return allTeams.filter(t => teamIds.has(t.id));
  }

  // 3. Fall back: teams where this user is the coach or creator
  return allTeams.filter(
    t => t.coachId === profile.uid || t.createdBy === profile.uid
  );
}

export function ParentHomePage() {
  const profile = useAuthStore(s => s.profile);
  const allTeams = useTeamStore(s => s.teams);
  const teamsLoading = useTeamStore(s => s.loading);
  const allEvents = useEventStore(s => s.events);
  const eventsLoading = useEventStore(s => s.loading);

  const myTeams = resolveParentTeams(profile, allTeams);
  const myTeamIds = new Set(myTeams.map(t => t.id));

  const today = todayISO();
  const upcomingEvents = allEvents
    .filter(
      e =>
        e.status !== 'cancelled' &&
        e.date >= today &&
        isUpcoming(e) &&
        e.teamIds.some(id => myTeamIds.has(id))
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  const isLoading = teamsLoading || eventsLoading;

  // Use the first matched team as the primary team for the header
  const primaryTeam = myTeams[0] ?? null;

  return (
    <div className="p-4 sm:p-6 space-y-6">

      {/* Team header */}
      {isLoading ? (
        <div className="h-20 bg-gray-100 rounded-xl animate-pulse" />
      ) : primaryTeam ? (
        <div
          className="rounded-xl px-5 py-4 flex items-center gap-4"
          style={{
            background: `linear-gradient(135deg, ${primaryTeam.color} 0%, ${primaryTeam.color}cc 100%)`,
          }}
        >
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0 overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.2)' }}
          >
            {primaryTeam.logoUrl ? (
              <img
                src={primaryTeam.logoUrl}
                alt={primaryTeam.name}
                className="w-full h-full object-contain"
              />
            ) : (
              primaryTeam.name.charAt(0).toUpperCase()
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-lg leading-tight truncate">
              {primaryTeam.name}
            </p>
            <p className="text-white/80 text-sm mt-0.5 flex items-center gap-1.5">
              <Users size={12} />
              {SPORT_TYPE_LABELS[primaryTeam.sportType]}
              {primaryTeam.ageGroup ? ` · ${primaryTeam.ageGroup}` : ''}
            </p>
          </div>
        </div>
      ) : (
        <Card className="p-5 text-center">
          <p className="text-sm text-gray-500">No team linked to your account yet.</p>
          <p className="text-xs text-gray-400 mt-1">
            Ask your coach or league admin to send you an invite.
          </p>
        </Card>
      )}

      {/* Upcoming games section */}
      <div>
        <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
          <CalendarDays size={16} className="text-blue-500" />
          Upcoming Games
        </h2>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : upcomingEvents.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-gray-400">No games scheduled yet</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {upcomingEvents.map(event => {
              const eventTeam = allTeams.find(t => event.teamIds.includes(t.id));
              const opponent = event.opponentName ?? null;

              return (
                <Card key={event.id} className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Date block */}
                    <div
                      className="flex-shrink-0 w-12 rounded-lg flex flex-col items-center justify-center py-1.5 text-white"
                      style={{ backgroundColor: eventTeam?.color ?? '#1B3A6B' }}
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-wide leading-none">
                        {new Date(event.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short' })}
                      </span>
                      <span className="text-xl font-bold leading-tight">
                        {new Date(event.date + 'T12:00:00').getDate()}
                      </span>
                    </div>

                    {/* Event details */}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm truncate">{event.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {formatDate(event.date)} at {formatTime(event.startTime)}
                      </p>
                      {opponent && (
                        <p className="text-xs text-gray-600 mt-0.5">
                          vs. {opponent}
                        </p>
                      )}
                      {event.location && (
                        <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                          <MapPin size={10} />
                          {event.location}
                        </p>
                      )}
                    </div>

                    {/* Placeholder badges for upcoming features */}
                    <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed select-none">
                        RSVP coming soon
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed select-none">
                        Snack slot
                      </span>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
