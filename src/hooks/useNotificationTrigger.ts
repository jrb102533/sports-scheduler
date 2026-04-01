import { useEffect } from 'react';
import { useEventStore } from '@/store/useEventStore';
import { doc, writeBatch } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { getItem, setItem } from '@/lib/localStorage';
import { STORAGE_KEYS } from '@/constants';
import { parseISO, isAfter, isBefore, addDays } from 'date-fns';
import { useAuthStore } from '@/store/useAuthStore';
import type { AppNotification } from '@/types';

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

    // Mark as notified FIRST to prevent re-entry if the effect re-runs
    setItem(key, [...notified, ...upcomingEvents.map(e => e.id)]);

    // Batch-write all notifications so onSnapshot fires only once
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) return;
    const batch = writeBatch(db);
    for (const event of upcomingEvents) {
      const n: AppNotification = {
        id: crypto.randomUUID(),
        type: 'event_reminder',
        title: 'Upcoming Event',
        message: `${event.title} is scheduled for tomorrow at ${event.startTime}${event.location ? ` at ${event.location}` : ''}.`,
        relatedEventId: event.id,
        isRead: false,
        createdAt: new Date().toISOString(),
      };
      batch.set(doc(db, 'users', currentUid, 'notifications', n.id), n);
    }
    batch.commit().catch(() => {
      // Best-effort; if the batch fails the localStorage marker still prevents retries
    });
  }, [events, uid]);
}
