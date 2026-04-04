import { CalendarDays, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { EventCard } from '@/components/events/EventCard';
import { EventDetailPanel } from '@/components/events/EventDetailPanel';
import { useEventStore } from '@/store/useEventStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useAuthStore, getMemberships, hasRole } from '@/store/useAuthStore';
import { isUpcoming, todayISO } from '@/lib/dateUtils';
import { SPORT_TYPE_LABELS } from '@/constants';
import type { RoleMembership, Team } from '@/types';
import type { ScheduledEvent } from '@/types';
import { useState } from 'react';

const ROLE_LABELS: Record<string, string> = {
  coach: 'Coach',
  parent: 'Parent',
  player: 'Player',
  admin: 'Admin',
  league_manager: 'League Manager',
};

const ROLE_BADGE_CLASSES: Record<string, string> = {
  coach: 'bg-blue-100 text-blue-700',
  parent: 'bg-orange-100 text-orange-700',
  player: 'bg-green-100 text-green-700',
  admin: 'bg-purple-100 text-purple-700',
  league_manager: 'bg-indigo-100 text-indigo-700',
};

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function resolveTeamsForMembership(membership: RoleMembership, allTeams: Team[], uid: string): Team[] {
  if (membership.role === 'admin') return allTeams;
  if (membership.role === 'league_manager') {
    return allTeams.filter(t =>
      (membership.leagueId && t.leagueIds?.includes(membership.leagueId)) ||
      t.createdBy === uid
    );
  }
  if (membership.role === 'coach') {
    return allTeams.filter(t =>
      (membership.teamId && t.id === membership.teamId) ||
      t.coachId === uid ||
      t.createdBy === uid
    );
  }
  if (membership.teamId) {
    return allTeams.filter(t => t.id === membership.teamId);
  }
  return [];
}

interface TeamCardProps {
  team: Team;
  membership: RoleMembership;
  upcomingCount: number;
  onClick: () => void;
}

function TeamCard({ team, membership, upcomingCount, onClick }: TeamCardProps) {
  const roleLabel = ROLE_LABELS[membership.role] ?? membership.role;
  const roleBadgeClass = ROLE_BADGE_CLASSES[membership.role] ?? 'bg-gray-100 text-gray-600';

  return (
    <button
      onClick={onClick}
      className="text-left bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md hover:border-gray-300 transition-all w-full"
    >
      {/* Team color accent strip */}
      <div className="h-1.5 w-full" style={{ backgroundColor: team.color }} />
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-base flex-shrink-0 overflow-hidden"
            style={team.logoUrl ? { backgroundColor: '#f3f4f6' } : { backgroundColor: team.color }}
          >
            {team.logoUrl
              ? <img src={team.logoUrl} alt={team.name} className="w-full h-full object-contain" />
              : team.name.charAt(0).toUpperCase()
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 text-sm truncate">{team.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">{SPORT_TYPE_LABELS[team.sportType]}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${roleBadgeClass}`}>
                {roleLabel}
              </span>
              {upcomingCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                  <CalendarDays size={10} />
                  {upcomingCount} upcoming
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

export function HomePage() {
  const profile = useAuthStore(s => s.profile);
  const allTeams = useTeamStore(s => s.teams);
  const teamsLoading = useTeamStore(s => s.loading);
  const allEvents = useEventStore(s => s.events);
  const eventsLoading = useEventStore(s => s.loading);
  const navigate = useNavigate();
  const [selected, setSelected] = useState<ScheduledEvent | null>(null);

  const firstName = profile?.displayName?.split(' ')[0] ?? '';
  const greeting = `${timeGreeting()}${firstName ? `, ${firstName}` : ''}`;

  const memberships = getMemberships(profile);
  const uid = profile?.uid ?? '';

  // Deduplicate teams across memberships
  const myTeamIds = new Set<string>();
  const membershipByTeam = new Map<string, RoleMembership>();

  for (const m of memberships) {
    const teams = resolveTeamsForMembership(m, allTeams, uid);
    for (const t of teams) {
      if (!myTeamIds.has(t.id)) {
        myTeamIds.add(t.id);
        membershipByTeam.set(t.id, m);
      }
    }
  }

  const myTeams = allTeams.filter(t => myTeamIds.has(t.id));

  const today = todayISO();
  const upcomingAll = allEvents
    .filter(e =>
      e.status !== 'cancelled' &&
      e.date >= today &&
      isUpcoming(e) &&
      e.teamIds.some(id => myTeamIds.has(id))
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
    .slice(0, 7);

  function upcomingCountForTeam(teamId: string): number {
    return allEvents.filter(e =>
      e.status !== 'cancelled' &&
      e.date >= today &&
      isUpcoming(e) &&
      e.teamIds.includes(teamId)
    ).length;
  }

  function handleTeamClick(team: Team) {
    const membership = membershipByTeam.get(team.id);
    if (!membership) return;
    const isCoachOrAbove = membership.role === 'coach' || membership.role === 'admin' || membership.role === 'league_manager';
    if (isCoachOrAbove) {
      navigate('/teams');
    } else {
      navigate('/parent');
    }
  }

  const isLoading = teamsLoading || eventsLoading;

  // Empty state: determine user's primary role for messaging
  const isCoachOrAbove = hasRole(profile, 'coach', 'admin', 'league_manager');

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">{greeting}</h1>
        <p className="text-sm text-gray-500 mt-0.5">Here's what's happening across your teams</p>
      </div>

      {/* My Teams section */}
      <section aria-labelledby="my-teams-heading">
        <div className="flex items-center gap-2 mb-3">
          <Users size={16} className="text-purple-500" />
          <h2 id="my-teams-heading" className="font-semibold text-gray-900">My Teams</h2>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2].map(i => (
              <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : myTeams.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-gray-500 font-medium">
              {isCoachOrAbove ? 'You have no teams yet.' : 'You are not linked to a team yet.'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {isCoachOrAbove
                ? 'Create your first team to get started.'
                : 'Ask your coach to send you an invite.'}
            </p>
            {isCoachOrAbove && (
              <button
                onClick={() => navigate('/teams')}
                className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                <Users size={14} />
                Create your first team
              </button>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {myTeams.map(team => (
              <TeamCard
                key={team.id}
                team={team}
                membership={membershipByTeam.get(team.id)!}
                upcomingCount={upcomingCountForTeam(team.id)}
                onClick={() => handleTeamClick(team)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Upcoming Events section */}
      <section aria-labelledby="upcoming-events-heading">
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays size={16} className="text-blue-500" />
          <h2 id="upcoming-events-heading" className="font-semibold text-gray-900">Upcoming Events</h2>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : upcomingAll.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-gray-400">
              {myTeams.length === 0
                ? 'No events yet — join a team to see your schedule here.'
                : 'No upcoming events scheduled.'}
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {upcomingAll.map(e => (
              <EventCard
                key={e.id}
                event={e}
                teams={myTeams}
                onClick={() => setSelected(e)}
              />
            ))}
          </div>
        )}
      </section>

      <EventDetailPanel event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
