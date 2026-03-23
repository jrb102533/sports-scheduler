import { useState } from 'react';
import { Plus, CalendarDays, Trophy, Users, Activity } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { RoleGuard } from '@/components/auth/RoleGuard';
import { EventCard } from '@/components/events/EventCard';
import { EventForm } from '@/components/events/EventForm';
import { EventDetailPanel } from '@/components/events/EventDetailPanel';
import { StandingsTable } from '@/components/standings/StandingsTable';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useEventStore } from '@/store/useEventStore';
import { useTeamStore } from '@/store/useTeamStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useAuthStore, getAccessibleTeamIds } from '@/store/useAuthStore';
import { isUpcoming, formatDate, formatTime } from '@/lib/dateUtils';
import type { ScheduledEvent } from '@/types';
import { seedDemoData } from '@/lib/demoData';

export function Dashboard() {
  const allEvents = useEventStore(s => s.events);
  const allTeams = useTeamStore(s => s.teams);
  const allPlayers = usePlayerStore(s => s.players);
  const profile = useAuthStore(s => s.profile);
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState<ScheduledEvent | null>(null);

  const accessibleTeamIds = getAccessibleTeamIds(profile, allTeams);
  // null = admin sees all; otherwise filter to accessible teams
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

  const isEmpty = teams.length === 0 && events.length === 0;
  const [seeding, setSeeding] = useState(false);

  async function handleSeed() {
    setSeeding(true);
    await seedDemoData();
    setSeeding(false);
  }

  return (
    <div className="p-6 space-y-6">
      {isEmpty && (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #14532d 0%, #134e4a 100%)' }}>
          <div className="px-8 py-8 flex items-center gap-6">
            <div className="flex-shrink-0 w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.12)' }}>
              <Trophy size={32} className="text-amber-300" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-white mb-1">Welcome to First Whistle</h2>
              <p className="text-blue-200 text-sm">Get started by loading demo data or creating your first team.</p>
            </div>
            <RoleGuard roles={['admin']}>
              <div className="flex gap-3 flex-shrink-0">
                <button
                  onClick={handleSeed}
                  disabled={seeding}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white border border-white/20 hover:bg-white/10 transition-colors disabled:opacity-50"
                >
                  {seeding ? 'Loading…' : 'Load Demo Data'}
                </button>
                <button
                  onClick={() => navigate('/teams')}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 hover:bg-blue-400 text-white transition-colors flex items-center gap-2"
                >
                  <Users size={15} /> Create Team
                </button>
              </div>
            </RoleGuard>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4 group">
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-blue-50 text-blue-600 group-hover:bg-blue-100 transition-colors">
              <CalendarDays size={18} />
            </div>
          </div>
          <div className="text-2xl font-bold text-gray-900">{events.length}</div>
          <div className="text-sm text-gray-500 mt-0.5">Total Events</div>
        </Card>
        <Card
          className="p-4 cursor-pointer group"
          onClick={() => navigate('/teams')}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-purple-50 text-purple-600 group-hover:bg-purple-100 transition-colors">
              <Users size={18} />
            </div>
          </div>
          <div className="text-2xl font-bold text-gray-900">{teams.length}</div>
          <div className="text-sm text-gray-500 mt-0.5">Teams</div>
        </Card>
        <Card className="p-4 group">
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100 transition-colors">
              <Activity size={18} />
            </div>
          </div>
          <div className="text-2xl font-bold text-gray-900">{players.length}</div>
          <div className="text-sm text-gray-500 mt-0.5">Players</div>
        </Card>
      </div>

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

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2"><Trophy size={16} className="text-yellow-500" /> Standings</h2>
          </div>
          <Card className="overflow-hidden">
            <StandingsTable />
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
    </div>
  );
}
