import { useState } from 'react';
import { Plus, CalendarDays, Trophy, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EventCard } from '@/components/events/EventCard';
import { EventForm } from '@/components/events/EventForm';
import { EventDetailPanel } from '@/components/events/EventDetailPanel';
import { StandingsTable } from '@/components/standings/StandingsTable';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useEventStore } from '@/store/useEventStore';
import { useTeamStore } from '@/store/useTeamStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { isUpcoming } from '@/lib/dateUtils';
import type { ScheduledEvent } from '@/types';
import { seedDemoData } from '@/lib/demoData';

export function Dashboard() {
  const events = useEventStore(s => s.events);
  const teams = useTeamStore(s => s.teams);
  const players = usePlayerStore(s => s.players);
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState<ScheduledEvent | null>(null);

  const upcoming = events
    .filter(e => isUpcoming(e) && e.status !== 'cancelled')
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
    .slice(0, 5);

  const recentResults = events
    .filter(e => e.status === 'completed' && e.result)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);

  const isEmpty = teams.length === 0 && events.length === 0;

  return (
    <div className="p-6 space-y-6">
      {isEmpty && (
        <Card className="p-6 text-center bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
          <Trophy size={32} className="text-blue-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-gray-900 mb-1">Welcome to Sports Scheduler</h2>
          <p className="text-sm text-gray-600 mb-4">Get started by loading demo data or creating your first team.</p>
          <div className="flex justify-center gap-3">
            <Button variant="secondary" onClick={() => seedDemoData()}>Load Demo Data</Button>
            <Button onClick={() => navigate('/teams')}><Users size={15} /> Create Team</Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4 text-center cursor-pointer" onClick={() => navigate('/events')}>
          <div className="text-2xl font-bold text-blue-600">{events.length}</div>
          <div className="text-sm text-gray-500 mt-0.5">Total Events</div>
        </Card>
        <Card className="p-4 text-center cursor-pointer" onClick={() => navigate('/teams')}>
          <div className="text-2xl font-bold text-purple-600">{teams.length}</div>
          <div className="text-sm text-gray-500 mt-0.5">Teams</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{players.length}</div>
          <div className="text-sm text-gray-500 mt-0.5">Players</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2"><CalendarDays size={16} className="text-blue-500" /> Upcoming Events</h2>
            <Button variant="ghost" size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Add</Button>
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
            <Button variant="ghost" size="sm" onClick={() => navigate('/standings')}>View All</Button>
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
