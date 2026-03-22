import { useEffect } from 'react';
import { useEventStore } from '@/store/useEventStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { getItem, setItem } from '@/lib/localStorage';
import { STORAGE_KEYS } from '@/constants';
import { parseISO, isBefore, subHours } from 'date-fns';
import { useAuthStore } from '@/store/useAuthStore';

export function useAttendanceNotification() {
  const events = useEventStore(s => s.events);
  const addNotification = useNotificationStore(s => s.addNotification);
  const uid = useAuthStore(s => s.user?.uid);

  useEffect(() => {
    if (!uid) return;
    const key = `${STORAGE_KEYS.ATTENDANCE_NOTIFIED}_${uid}`;
    const notified = getItem<string[]>(key) ?? [];
    const cutoff = subHours(new Date(), 1);

    const missing = events.filter(e => {
      if (e.status === 'cancelled' || e.attendanceRecorded || notified.includes(e.id)) return false;
      return isBefore(parseISO(e.date), cutoff);
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

    setItem(key, [...notified, ...missing.map(e => e.id)]);
  }, [events, addNotification, uid]);
}
