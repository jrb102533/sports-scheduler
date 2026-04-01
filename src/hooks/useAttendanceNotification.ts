import { useEffect } from 'react';
import { useEventStore } from '@/store/useEventStore';
import { doc, writeBatch } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { getItem, setItem } from '@/lib/localStorage';
import { STORAGE_KEYS } from '@/constants';
import { parseISO, isBefore, subHours } from 'date-fns';
import { useAuthStore } from '@/store/useAuthStore';
import type { AppNotification } from '@/types';

export function useAttendanceNotification() {
  const events = useEventStore(s => s.events);
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

    // Mark as notified FIRST to prevent re-entry if the effect re-runs
    setItem(key, [...notified, ...missing.map(e => e.id)]);

    // Batch-write all notifications so onSnapshot fires only once
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) return;
    const batch = writeBatch(db);
    for (const event of missing) {
      const n: AppNotification = {
        id: crypto.randomUUID(),
        type: 'attendance_missing',
        title: 'Attendance Not Recorded',
        message: `Don't forget to mark attendance for "${event.title}" on ${event.date}.`,
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
