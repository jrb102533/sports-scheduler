import { useEffect } from 'react';
import { useEventStore } from '@/store/useEventStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { getItem, setItem } from '@/lib/localStorage';
import { STORAGE_KEYS } from '@/constants';
import { parseISO, isAfter, isBefore, addDays } from 'date-fns';
import { useAuthStore } from '@/store/useAuthStore';

export function useNotificationTrigger() {
  const events = useEventStore(s => s.events);
  const uid = useAuthStore(s => s.user?.uid);

  useEffect(() => {
    if (!uid) return;
    const key = `${STORAGE_KEYS.NOTIFIED_EVENTS}_${uid}`;
    const notified = getItem<string[]>(key) ?? [];
    const now = new Date();
    const cutoff = addDays(now, 1);

    const upcomingEvents = events.filter(e => {
      if (e.status === 'cancelled' || notified.includes(e.id)) return false;
      const eventDate = parseISO(e.date);
      return isAfter(eventDate, now) && isBefore(eventDate, cutoff);
    });

    if (upcomingEvents.length === 0) return;

    const { addNotification } = useNotificationStore.getState();
    for (const event of upcomingEvents) {
      addNotification({
        id: crypto.randomUUID(),
        type: 'event_reminder',
        title: 'Upcoming Event',
        message: `${event.title} is scheduled for tomorrow at ${event.startTime}${event.location ? ` at ${event.location}` : ''}.`,
        relatedEventId: event.id,
        isRead: false,
        createdAt: new Date().toISOString(),
      });
    }

    setItem(key, [...notified, ...upcomingEvents.map(e => e.id)]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, uid]);
}
