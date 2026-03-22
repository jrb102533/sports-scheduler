import { useEffect } from 'react';
import { useEventStore } from '@/store/useEventStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { getItem, setItem } from '@/lib/localStorage';
import { STORAGE_KEYS } from '@/constants';
import { parseISO, isAfter, isBefore, addDays } from 'date-fns';

export function useNotificationTrigger() {
  const events = useEventStore(s => s.events);
  const addNotification = useNotificationStore(s => s.addNotification);

  useEffect(() => {
    const notified = getItem<string[]>(STORAGE_KEYS.NOTIFIED_EVENTS) ?? [];
    const now = new Date();
    const cutoff = addDays(now, 1);

    const upcomingEvents = events.filter(e => {
      if (e.status === 'cancelled' || notified.includes(e.id)) return false;
      const eventDate = parseISO(e.date);
      return isAfter(eventDate, now) && isBefore(eventDate, cutoff);
    });

    if (upcomingEvents.length === 0) return;

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

    setItem(STORAGE_KEYS.NOTIFIED_EVENTS, [...notified, ...upcomingEvents.map(e => e.id)]);
  }, [events, addNotification]);
}
