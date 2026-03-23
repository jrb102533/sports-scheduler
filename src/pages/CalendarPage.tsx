import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { CalendarGrid, formatMonthYear, dateToISO } from '@/components/calendar/CalendarGrid';
import { EventForm } from '@/components/events/EventForm';
import { EventDetailPanel } from '@/components/events/EventDetailPanel';
import { Button } from '@/components/ui/Button';
import { useEventStore } from '@/store/useEventStore';
import { useTeamStore } from '@/store/useTeamStore';
import type { ScheduledEvent } from '@/types';

export function CalendarPage() {
  const events = useEventStore(s => s.events);
  const teams = useTeamStore(s => s.teams);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [formOpen, setFormOpen] = useState(false);
  const [formDate, setFormDate] = useState<string | undefined>();
  const [selectedEvent, setSelectedEvent] = useState<ScheduledEvent | null>(null);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  function handleDayClick(date: Date) {
    setFormDate(dateToISO(date));
    setFormOpen(true);
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={prevMonth}><ChevronLeft size={16} /></Button>
          <h2 className="text-lg font-semibold text-gray-900 w-44 text-center">{formatMonthYear(new Date(year, month))}</h2>
          <Button variant="secondary" size="sm" onClick={nextMonth}><ChevronRight size={16} /></Button>
          <Button variant="ghost" size="sm" onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}>Today</Button>
        </div>
        <Button onClick={() => { setFormDate(undefined); setFormOpen(true); }}>
          <Plus size={16} /> Add Event
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <CalendarGrid
          year={year}
          month={month}
          events={events}
          teams={teams}
          onDayClick={handleDayClick}
          onEventClick={setSelectedEvent}
        />
      </div>

      <EventForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        initial={formDate ? { date: formDate } : undefined}
      />
      <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  );
}
