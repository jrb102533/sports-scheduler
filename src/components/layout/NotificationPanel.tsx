import { X, Bell } from 'lucide-react';
import { useNotificationStore } from '@/store/useNotificationStore';
import { Button } from '@/components/ui/Button';
import { formatDate } from '@/lib/dateUtils';

export function NotificationPanel() {
  const notifications = useNotificationStore(s => s.notifications);
  const panelOpen = useNotificationStore(s => s.panelOpen);
  const setPanelOpen = useNotificationStore(s => s.setPanelOpen);
  const markRead = useNotificationStore(s => s.markRead);
  const markAllRead = useNotificationStore(s => s.markAllRead);
  const clearAll = useNotificationStore(s => s.clearAll);

  if (!panelOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={() => setPanelOpen(false)} />
      <div className="relative w-full sm:w-80 bg-white h-full shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Notifications</h2>
          <button onClick={() => setPanelOpen(false)} className="p-1 rounded hover:bg-gray-100 text-gray-500">
            <X size={16} />
          </button>
        </div>
        <div className="flex gap-2 px-4 py-2 border-b border-gray-100">
          <Button variant="ghost" size="sm" onClick={markAllRead}>Mark all read</Button>
          <Button variant="ghost" size="sm" onClick={clearAll}>Clear all</Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <Bell size={32} className="mb-2" />
              <p className="text-sm">No notifications</p>
            </div>
          ) : notifications.map(n => (
            <div
              key={n.id}
              className={`px-4 py-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${!n.isRead ? 'bg-blue-50' : ''}`}
              onClick={() => markRead(n.id)}
            >
              <p className="text-sm font-medium text-gray-900">{n.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{n.message}</p>
              <p className="text-xs text-gray-400 mt-1">{formatDate(n.createdAt.split('T')[0])}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
