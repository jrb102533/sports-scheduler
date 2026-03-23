import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useNotificationStore } from '@/store/useNotificationStore';
import { formatDate } from '@/lib/dateUtils';

export function NotificationsPage() {
  const { notifications, markRead, markAllRead, clearAll } = useNotificationStore();
  const unread = notifications.filter(n => !n.isRead).length;

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {unread > 0 && <Badge className="bg-red-100 text-red-700">{unread} unread</Badge>}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={markAllRead} disabled={unread === 0}>Mark all read</Button>
          <Button variant="ghost" size="sm" onClick={clearAll} disabled={notifications.length === 0}>Clear all</Button>
        </div>
      </div>

      {notifications.length === 0 ? (
        <EmptyState icon={<Bell size={40} />} title="No notifications" description="You'll see event reminders and updates here." />
      ) : (
        <div className="space-y-2">
          {notifications.map(n => (
            <div key={n.id}
              className={`bg-white rounded-xl border border-gray-200 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${!n.isRead ? 'border-l-4 border-l-blue-500' : ''}`}
              onClick={() => markRead(n.id)}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-900">{n.title}</p>
                {!n.isRead && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />}
              </div>
              <p className="text-sm text-gray-500 mt-0.5">{n.message}</p>
              <p className="text-xs text-gray-400 mt-1">{formatDate(n.createdAt.split('T')[0])}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
