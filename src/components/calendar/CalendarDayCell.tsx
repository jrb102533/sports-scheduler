import { clsx } from 'clsx';
import { EventChip } from './EventChip';
import { isSameDay } from '@/lib/dateUtils';
import type { ScheduledEvent, Team } from '@/types';

interface CalendarDayCellProps {
  date: Date;
  events: ScheduledEvent[];
  teams: Team[];
  isCurrentMonth: boolean;
  onDayClick: (date: Date) => void;
  onEventClick: (event: ScheduledEvent) => void;
}

export function CalendarDayCell({ date, events, teams, isCurrentMonth, onDayClick, onEventClick }: CalendarDayCellProps) {
  const isToday = isSameDay(date, new Date());
  const dayEvents = events.filter(e => e.date === `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
  const visible = dayEvents.slice(0, 3);
  const overflow = dayEvents.length - visible.length;

  return (
    <div
      onClick={() => onDayClick(date)}
      className={clsx(
        'min-h-24 p-1.5 border-b border-r border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors',
        !isCurrentMonth && 'bg-gray-50/60'
      )}
    >
      <div className={clsx(
        'text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1',
        isToday ? 'bg-blue-600 text-white' : isCurrentMonth ? 'text-gray-700' : 'text-gray-400'
      )}>
        {date.getDate()}
      </div>
      <div className="space-y-0.5">
        {visible.map(e => <EventChip key={e.id} event={e} teams={teams} onClick={() => onEventClick(e)} />)}
        {overflow > 0 && <div className="text-xs text-gray-500 pl-1">+{overflow} more</div>}
      </div>
    </div>
  );
}
