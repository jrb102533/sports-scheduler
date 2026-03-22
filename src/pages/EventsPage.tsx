import { useState } from 'react';
import { Plus, Search, Upload } from 'lucide-react';
import { EventCard } from '@/components/events/EventCard';
import { EventForm } from '@/components/events/EventForm';
import { EventDetailPanel } from '@/components/events/EventDetailPanel';
import { ImportEventsModal } from '@/components/events/ImportEventsModal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { RoleGuard } from '@/components/auth/RoleGuard';
import { useEventStore } from '@/store/useEventStore';
import { useTeamStore } from '@/store/useTeamStore';
import { CalendarDays } from 'lucide-react';
import type { ScheduledEvent } from '@/types';
import { EVENT_TYPE_LABELS, EVENT_STATUS_LABELS } from '@/constants';

const typeOptions = [{ value: '', label: 'All Types' }, ...Object.entries(EVENT_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))];
const statusOptions = [{ value: '', label: 'All Statuses' }, ...Object.entries(EVENT_STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))];

export function EventsPage() {
  const events = useEventStore(s => s.events);
  const teams = useTeamStore(s => s.teams);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<ScheduledEvent | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');

  const teamOptions = [{ value: '', label: 'All Teams' }, ...teams.map(t => ({ value: t.id, label: t.name }))];

  const filtered = events
    .filter(e => {
      const q = search.toLowerCase();
      return (
        (!q || e.title.toLowerCase().includes(q) || e.location?.toLowerCase().includes(q)) &&
        (!typeFilter || e.type === typeFilter) &&
        (!statusFilter || e.status === statusFilter) &&
        (!teamFilter || e.teamIds.includes(teamFilter))
      );
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2 flex-1 flex-wrap">
          <div className="relative flex-1 min-w-40">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search events..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {teams.length > 0 && (
            <Select options={teamOptions} value={teamFilter} onChange={e => setTeamFilter(e.target.value)} className="w-36" />
          )}
          <Select options={typeOptions} value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="w-36" />
          <Select options={statusOptions} value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-36" />
        </div>
        <RoleGuard roles={['admin', 'coach']}>
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload size={16} /> Import
          </Button>
          <Button onClick={() => setFormOpen(true)}>
            <Plus size={16} /> New Event
          </Button>
        </RoleGuard>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<CalendarDays size={40} />}
          title={events.length === 0 ? 'No events yet' : 'No events match your filters'}
          description={events.length === 0 ? 'Create your first event to get started.' : 'Try adjusting your search or filters.'}
          action={events.length === 0 ? <Button onClick={() => setFormOpen(true)}><Plus size={16} /> Create Event</Button> : undefined}
        />
      ) : (
        <div className="grid gap-3">
          {filtered.map(event => (
            <EventCard key={event.id} event={event} teams={teams} onClick={() => setSelected(event)} />
          ))}
        </div>
      )}

      <EventForm open={formOpen} onClose={() => setFormOpen(false)} />
      <ImportEventsModal open={importOpen} onClose={() => setImportOpen(false)} />
      <EventDetailPanel event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
