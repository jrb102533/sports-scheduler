import { useState } from 'react';
import { Plus, CalendarDays, Trophy, Users, Activity, MessageSquare, Bell, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { RoleGuard } from '@/components/auth/RoleGuard';
import { EventCard } from '@/components/events/EventCard';
import { EventForm } from '@/components/events/EventForm';
import { EventDetailPanel } from '@/components/events/EventDetailPanel';
import { ComposeMessageModal } from '@/components/messaging/ComposeMessageModal';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useEventStore } from '@/store/useEventStore';
import { useTeamStore } from '@/store/useTeamStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useLeagueStore } from '@/store/useLeagueStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useAuthStore, getAccessibleTeamIds, getMemberships, hasRole } from '@/store/useAuthStore';
import { isUpcoming, formatDate, formatTime, todayISO, parseISO } from '@/lib/dateUtils';
import { SPORT_TYPE_LABELS } from '@/constants';
import type { ScheduledEvent } from '@/types';
import { seedDemoData } from '@/lib/demoData';

const LOW_CONFIRMATION_THRESHOLD = 7;
const LOW_RSVP_RESPONSE_RATIO = 0.5;
const SOON_HOURS = 48;

export function Dashboard() {
  const allEvents = useEventStore(s => s.events);
  const allTeams = useTeamStore(s => s.teams);
  const allPlayers = usePlayerStore(s => s.players);
  const leagues = useLeagueStore(s => s.leagues);
  const notifications = useNotificationStore(s => s.notifications);
  const profile = useAuthStore(s => s.profile);
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState<ScheduledEvent | null>(null);
  const [teamsExpanded, setTeamsExpanded] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  const accessibleTeamIds = getAccessibleTeamIds(profile, allTeams);
  const teams = accessibleTeamIds === null ? allTeams : allTeams.filter(t => accessibleTeamIds.includes(t.id));
  const players = accessibleTeamIds === null ? allPlayers : allPlayers.filter(p => accessibleTeamIds.includes(p.teamId));
  const events = accessibleTeamIds === null
    ? allEvents
    : allEvents.filter(e => e.teamIds.some(id => accessibleTeamIds.includes(id)));

  const upcoming = events
    .filter(e => isUpcoming(e) && e.status !== 'cancelled')
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
    .slice(0, 5);

  const recentResults = events
    .filter(e => e.status === 'completed' && e.result)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);

  const recentMessages = notifications.slice(0, 8);

  const leagueManagerMembership = hasRole(profile, 'league_manager')
    ? getMemberships(profile).find(m => m.role === 'league_manager' && m.leagueId)
    : undefined;
  const leagueId = leagueManagerMembership?.leagueId ?? profile?.leagueId;
  const myLeague = leagueId ? leagues.find(l => l.id === leagueId) : null;
  const myLeagueTeams = myLeague ? allTeams.filter(t => t.leagueId === myLeague.id) : [];

  const isEmpty = teams.length === 0 && events.length === 0;
  const [seeding, setSeeding] = useState(false);

  const isManager = profile?.role === 'admin' || profile?.role === 'league_manager' || profile?.role === 'coach';

  type NextAction =
    | { kind: 'unrecorded_result'; event: ScheduledEvent }
    | { kind: 'low_rsvp'; event: ScheduledEvent; nonResponders: number }
    | { kind: 'low_confirmation'; event: ScheduledEvent; confirmed: number }
    | { kind: 'all_clear'; nextEvent: ScheduledEvent | null };

  function computeNextAction(): NextAction {
    const today = todayISO();
    const nowMs = Date.now();

    const unrecorded = events
      .filter(e =>
        e.date < today &&
        e.status !== 'completed' &&
        e.status !== 'cancelled' &&
        (e.type === 'game' || e.type === 'match') &&
        !e.result
      )
      .sort((a, b) => b.date.localeCompare(a.date));

    if (unrecorded.length > 0) {
      return { kind: 'unrecorded_result', event: unrecorded[0] };
    }

    const upcomingEvents = events
      .filter(e => isUpcoming(e) && e.status !== 'cancelled')
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

    for (const e of upcomingEvents) {
      const teamPlayers = allPlayers.filter(p => e.teamIds.includes(p.teamId));
      const rosterSize = teamPlayers.length;
      if (rosterSize > 0) {
        const responded = (e.rsvps ?? []).length;
        if (responded / rosterSize < LOW_RSVP_RESPONSE_RATIO) {
          return { kind: 'low_rsvp', event: e, nonResponders: rosterSize - responded };
        }
      }
    }

    for (const e of upcomingEvents) {
      const eventMs = parseISO(`${e.date}T${e.startTime}`).getTime();
      const hoursUntil = (eventMs - nowMs) / (1000 * 60 * 60);
      if (hoursUntil <= SOON_HOURS) {
        const confirmed = (e.rsvps ?? []).filter(r => r.response === 'yes').length;
        if (confirmed < LOW_CONFIRMATION_THRESHOLD) {
          return { kind: 'low_confirmation', event: e, confirmed };
        }
      }
    }

    return { kind: 'all_clear', nextEvent: upcomingEvents[0] ?? null };
  }

  const nextAction = isManager ? computeNextAction() : null;

  async function handleSeed() {
    setSeeding(true);
    await seedDemoData();
    setSeeding(false);
  }

  function notificationIcon(type: string) {
    switch (type) {
      case 'event_reminder': return <CalendarDays size={14} className="text-blue-500" />;
      case 'result_recorded': return <Trophy size={14} className="text-yellow-500" />;
      case 'roster_change': return <Users size={14} className="text-purple-500" />;
      case 'attendance_missing': return <Activity size={14} className="text-orange-500" />;
      default: return <Bell size={14} className="text-gray-400" />;
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">

      {isEmpty && (
        <RoleGuard roles={['admin']}>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={handleSeed}
              disabled={seeding}
            >
              {seeding ? 'Loading…' : 'Load Demo Data'}
            </Button>
            <Button
              variant="primary"
              onClick={() => navigate('/teams')}
            >
              <Users size={15} /> Create Team
            </Button>
          </div>
        </RoleGuard>
      )}

      {/* Stat cards */}
      <div className={`grid gap-4 ${(profile?.role === 'league_manager' || profile?.role === 'admin') ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
        <Card className="p-4 group cursor-pointer" onClick={() => navigate('/calendar')}>
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-blue-50 text-blue-600 group-hover:bg-blue-100 transition-colors">
              <CalendarDays size={18} />
            </div>
          </div>
          <div className="text-2xl font-bold text-gray-900">{events.length}</div>
          <div className="text-sm text-gray-500 mt-0.5">Total Events</div>
        </Card>

        {/* Expandable Teams card */}
        <Card
          className="p-4 cursor-pointer group"
          onClick={() => setTeamsExpanded(e => !e)}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-purple-50 text-purple-600 group-hover:bg-purple-100 transition-colors">
              <Users size={18} />
            </div>
            {teams.length > 0 && (
              teamsExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />
            )}
          </div>
          <div className="text-2xl font-bold text-gray-900">{teams.length}</div>
          <div className="text-sm text-gray-500 mt-0.5">Teams</div>
        </Card>

        <Card className="p-4 group cursor-pointer" onClick={() => navigate('/teams')}>
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100 transition-colors">
              <Activity size={18} />
            </div>
          </div>
          <div className="text-2xl font-bold text-gray-900">{players.length}</div>
          <div className="text-sm text-gray-500 mt-0.5">Players</div>
        </Card>

        {/* Leagues card — league managers & admins */}
        {(profile?.role === 'league_manager' || profile?.role === 'admin') && (
          <Card className="p-4 group cursor-pointer" onClick={() => navigate('/leagues')}>
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100 transition-colors">
                <Trophy size={18} />
              </div>
            </div>
            <div className="text-2xl font-bold text-gray-900">{leagues.length}</div>
            <div className="text-sm text-gray-500 mt-0.5">Leagues</div>
          </Card>
        )}
      </div>

      {/* Team sub-cards (expanded) */}
      {teamsExpanded && teams.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {teams.map(team => (
            <button
              key={team.id}
              onClick={() => navigate(`/teams/${team.id}`)}
              className="text-left bg-white border border-gray-200 rounded-xl p-3.5 hover:shadow-md hover:border-purple-200 transition-all flex items-center gap-3"
            >
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
                <p className="text-xs text-gray-500">{SPORT_TYPE_LABELS[team.sportType]}</p>
              </div>
              <span className="text-xs text-gray-400 flex-shrink-0">View →</span>
            </button>
          ))}
        </div>
      )}

      {/* League card — league managers only */}
      {myLeague && (
        <button
          onClick={() => navigate(`/leagues/${myLeague.id}`)}
          className="w-full text-left bg-white border border-indigo-200 rounded-xl p-4 hover:shadow-md hover:border-indigo-300 transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
              <Trophy size={20} className="text-indigo-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-indigo-500 font-semibold uppercase tracking-wide mb-0.5">My League</p>
              <p className="font-semibold text-gray-900 truncate">{myLeague.name}</p>
              {myLeague.season && <p className="text-xs text-gray-500">{myLeague.season} · {myLeagueTeams.length} teams</p>}
            </div>
            <span className="text-xs text-indigo-400 flex-shrink-0">View →</span>
          </div>
        </button>
      )}

      {/* Next Up banner */}
      {upcoming.length > 0 && (
        <div
          className="rounded-xl px-5 py-4 flex items-center gap-4 cursor-pointer"
          style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #4f46e5 100%)' }}
          onClick={() => setSelected(upcoming[0])}
        >
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.15)' }}>
            <CalendarDays size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-blue-200 text-xs font-semibold uppercase tracking-wide mb-0.5">Next Up</p>
            <p className="font-semibold text-white truncate">{upcoming[0].title}</p>
            <p className="text-blue-200 text-sm">{formatDate(upcoming[0].date)} at {formatTime(upcoming[0].startTime)}{upcoming[0].location ? ` · ${upcoming[0].location}` : ''}</p>
          </div>
          <span className="text-blue-200 text-xs flex-shrink-0">Tap to view</span>
        </div>
      )}

      {/* Next Action card — coaches / admins / league managers */}
      {nextAction && (() => {
        const isUrgent = nextAction.kind !== 'all_clear';
        const accentClass = isUrgent ? 'border-l-amber-400' : 'border-l-green-400';

        let label = '';
        let actionLabel = '';
        let targetEvent: ScheduledEvent | null = null;

        if (nextAction.kind === 'unrecorded_result') {
          label = `Record the result for "${nextAction.event.title}"`;
          actionLabel = 'Open event';
          targetEvent = nextAction.event;
        } else if (nextAction.kind === 'low_rsvp') {
          label = `${nextAction.nonResponders} player${nextAction.nonResponders !== 1 ? 's' : ''} haven't responded to "${nextAction.event.title}" — send a nudge`;
          actionLabel = 'Open event';
          targetEvent = nextAction.event;
        } else if (nextAction.kind === 'low_confirmation') {
          label = `"${nextAction.event.title}" is soon — only ${nextAction.confirmed} confirmed`;
          actionLabel = 'Open event';
          targetEvent = nextAction.event;
        } else {
          label = nextAction.nextEvent
            ? `You're all caught up! Next: ${nextAction.nextEvent.title} on ${formatDate(nextAction.nextEvent.date)}`
            : "You're all caught up! No upcoming events scheduled.";
        }

        return (
          <Card className={`border-l-4 ${accentClass} px-4 py-3 flex items-center gap-3`}>
            <div className="flex-shrink-0">
              {isUrgent
                ? <AlertTriangle size={18} className="text-amber-500" />
                : <CheckCircle2 size={18} className="text-green-500" />
              }
            </div>
            <p className="flex-1 text-sm text-gray-800 min-w-0">{label}</p>
            {targetEvent && (
              <Button variant="secondary" size="sm" className="flex-shrink-0" onClick={() => setSelected(targetEvent)}>
                {actionLabel}
              </Button>
            )}
          </Card>
        );
      })()}

      {/* Main grid: Upcoming Events + Messages */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2"><CalendarDays size={16} className="text-blue-500" /> Upcoming Events</h2>
            <RoleGuard roles={['admin', 'league_manager', 'coach']}>
              <Button variant="ghost" size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Add</Button>
            </RoleGuard>
          </div>
          {upcoming.length === 0 ? (
            <Card className="p-6 text-center text-sm text-gray-400">No upcoming events</Card>
          ) : (
            <div className="space-y-2">
              {upcoming.map(e => <EventCard key={e.id} event={e} teams={teams} onClick={() => setSelected(e)} />)}
            </div>
          )}
        </div>

        {/* Messages */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2"><MessageSquare size={16} className="text-green-500" /> Messages</h2>
            <RoleGuard roles={['admin', 'league_manager', 'coach']}>
              <Button variant="ghost" size="sm" onClick={() => setComposeOpen(true)}><Plus size={14} /> New</Button>
            </RoleGuard>
          </div>
          <Card className="overflow-hidden">
            {recentMessages.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">No messages yet</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {recentMessages.map(n => (
                  <div key={n.id} className={`flex items-start gap-3 px-4 py-3 ${!n.isRead ? 'bg-blue-50/50' : ''}`}>
                    <div className="mt-0.5 flex-shrink-0">{notificationIcon(n.type)}</div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${!n.isRead ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>{n.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.message}</p>
                      <p className="text-xs text-gray-400 mt-1">{formatDate(n.createdAt.slice(0, 10))}</p>
                    </div>
                    {!n.isRead && <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {recentResults.length > 0 && (
        <div>
          <h2 className="font-semibold text-gray-900 mb-3">Recent Results</h2>
          <div className="space-y-2">
            {recentResults.map(e => <EventCard key={e.id} event={e} teams={teams} onClick={() => setSelected(e)} />)}
          </div>
        </div>
      )}

      <EventForm open={formOpen} onClose={() => setFormOpen(false)} />
      <EventDetailPanel event={selected} onClose={() => setSelected(null)} />
      <ComposeMessageModal open={composeOpen} onClose={() => setComposeOpen(false)} />
    </div>
  );
}
