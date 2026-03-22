import { useEffect } from 'react';
import { useEventStore } from '@/store/useEventStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { getItem, setItem } from '@/lib/localStorage';
import { STORAGE_KEYS } from '@/constants';
import { parseISO, isBefore, subHours } from 'date-fns';

export function useAttendanceNotification() {
  const events = useEventStore(s => s.events);
  const addNotification = useNotificationStore(s => s.addNotification);

  useEffect(() => {
    const notified = getItem<string[]>(STORAGE_KEYS.ATTENDANCE_NOTIFIED) ?? [];
    // Events that ended >1 hour ago with no attendance recorded
    const cutoff = subHours(new Date(), 1);

    const missing = events.filter(e => {
      if (e.status === 'cancelled' || e.attendanceRecorded || notified.includes(e.id)) return false;
      const eventDate = parseISO(e.date);
      return isBefore(eventDate, cutoff);
    });

    if (missing.length === 0) return;

    for (const event of missing) {
      addNotification({
        id: crypto.randomUUID(),
        type: 'attendance_missing',
        title: 'Attendance Not Recorded',
        message: `Don't forget to mark attendance for "${event.title}" on ${event.date}.`,
        relatedEventId: event.id,
        isRead: false,
        createdAt: new Date().toISOString(),
      });
    }

    setItem(STORAGE_KEYS.ATTENDANCE_NOTIFIED, [...notified, ...missing.map(e => e.id)]);
  }, [events, addNotification]);
}
