import { CalendarDays, MapPin, Users } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { RsvpButton } from '@/components/events/RsvpButton';
import { useEventStore } from '@/store/useEventStore';
import { useTeamStore } from '@/store/useTeamStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useAuthStore, getMemberships } from '@/store/useAuthStore';
import { isUpcoming, formatDate, formatTime, todayISO } from '@/lib/dateUtils';
import { SPORT_TYPE_LABELS } from '@/constants';
import type { Player, Team } from '@/types';

function resolveParentTeams(
  profile: ReturnType<typeof useAuthStore.getState>['profile'],
  allTeams: Team[],
  allPlayers: Player[]
): Team[] {
  if (!profile) return [];

  const teamIds = new Set<string>();

  // 1. Collect teamIds from all memberships
  const memberships = getMemberships(profile);
  for (const m of memberships) {
    if (m.teamId) teamIds.add(m.teamId);

    // 2. If membership has playerId but no teamId (e.g. parent invited before
    //    teamId was reliably stored), resolve via the player record.
    if (m.playerId && !m.teamId) {
      const player = allPlayers.find(p => p.id === m.playerId);
      if (player?.teamId) teamIds.add(player.teamId);
    }
  }

  // 3. Legacy: top-level teamId / playerId scalar fields
  if (profile.teamId) teamIds.add(profile.teamId);
  if (profile.playerId && teamIds.size === 0) {
    const player = allPlayers.find(p => p.id === profile.playerId);
    if (player?.teamId) teamIds.add(player.teamId);
  }

  return allTeams.filter(t => teamIds.has(t.id));
}

export function ParentHomePage() {
  const profile = useAuthStore(s => s.profile);
  const currentUserUid = useAuthStore(s => s.user?.uid ?? '');
  const currentUserName = useAuthStore(s => s.profile?.displayName ?? '');
  const allTeams = useTeamStore(s => s.teams);
  const teamsLoading = useTeamStore(s => s.loading);
  const allEvents = useEventStore(s => s.events);
  const eventsLoading = useEventStore(s => s.loading);
  const allPlayers = usePlayerStore(s => s.players);

  const myTeams = resolveParentTeams(profile, allTeams, allPlayers);
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
            <p className="text-sm text-gray-400">Your coach hasn't added any games yet — check back soon</p>
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

                    {/* RSVP */}
                    <div className="flex-shrink-0">
                      <RsvpButton
                        eventId={event.id}
                        currentUserUid={currentUserUid}
                        currentUserName={currentUserName}
                      />
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
