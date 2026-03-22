import { format, parseISO, isSameDay, isAfter, isBefore, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns';
import type { ScheduledEvent } from '@/types';

export { isSameDay, isAfter, isBefore, startOfWeek, endOfWeek, eachDayOfInterval, parseISO };

export function formatDate(dateStr: string): string {
  return format(parseISO(dateStr), 'MMM d, yyyy');
}

export function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(h, m);
  return format(date, 'h:mm a');
}

export function formatDateShort(dateStr: string): string {
  return format(parseISO(dateStr), 'MMM d');
}

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function isUpcoming(event: ScheduledEvent): boolean {
  const eventDate = parseISO(event.date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return isAfter(eventDate, today) || isSameDay(eventDate, today);
}

export function groupEventsByDate(events: ScheduledEvent[]): Record<string, ScheduledEvent[]> {
  const groups: Record<string, ScheduledEvent[]> = {};
  for (const event of events) {
    if (!groups[event.date]) groups[event.date] = [];
    groups[event.date].push(event);
  }
  return groups;
}

export function getDaysInMonth(year: number, month: number): Date[] {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const days: Date[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export function formatMonthYear(date: Date): string {
  return format(date, 'MMMM yyyy');
}

export function formatDayOfMonth(date: Date): string {
  return format(date, 'd');
}

export function dateToISO(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}
