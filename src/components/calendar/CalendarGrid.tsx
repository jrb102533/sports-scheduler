import { getDaysInMonth, formatMonthYear, dateToISO } from '@/lib/dateUtils';
import { CalendarDayCell } from './CalendarDayCell';
import type { ScheduledEvent, Team } from '@/types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface CalendarGridProps {
  year: number;
  month: number;
  events: ScheduledEvent[];
  teams: Team[];
  onDayClick: (date: Date) => void;
  onEventClick: (event: ScheduledEvent) => void;
}

export function CalendarGrid({ year, month, events, teams, onDayClick, onEventClick }: CalendarGridProps) {
  const days = getDaysInMonth(year, month);
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  // Pad the front with days from previous month
  const prevMonthDays: Date[] = [];
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    prevMonthDays.push(d);
  }

  // Pad the end with days from next month
  const totalCells = prevMonthDays.length + days.length;
  const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  const nextMonthDays: Date[] = [];
  for (let i = 1; i <= remainingCells; i++) {
    nextMonthDays.push(new Date(year, month + 1, i));
  }

  const allDays = [...prevMonthDays, ...days, ...nextMonthDays];

  return (
    <div>
      <div className="grid grid-cols-7 border-t border-l border-gray-200">
        {WEEKDAYS.map(day => (
          <div key={day} className="px-2 py-2 text-xs font-semibold text-gray-500 border-b border-r border-gray-200 text-center">
            {day}
          </div>
        ))}
        {allDays.map((date, i) => (
          <CalendarDayCell
            key={i}
            date={date}
            events={events}
            teams={teams}
            isCurrentMonth={date.getMonth() === month}
            onDayClick={onDayClick}
            onEventClick={onEventClick}
          />
        ))}
      </div>
    </div>
  );
}

export { formatMonthYear, dateToISO };
