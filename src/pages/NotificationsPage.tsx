import { Bell, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useEventStore } from '@/store/useEventStore';
import { formatDate } from '@/lib/dateUtils';

export function NotificationsPage() {
  const { notifications, markRead, markAllRead, clearAll } = useNotificationStore();
  const allEvents = useEventStore(s => s.events);
  const navigate = useNavigate();
  const unread = notifications.filter(n => !n.isRead).length;

  function handleNotificationClick(id: string, relatedEventId?: string, relatedTeamId?: string) {
    void markRead(id);
    if (relatedEventId) {
      // Find which team this event belongs to so we can navigate to the team schedule
      const event = allEvents.find(e => e.id === relatedEventId);
      if (event) {
        const teamId = event.teamIds[0];
        if (teamId) {
          navigate(`/teams/${teamId}`, { state: { openEventId: relatedEventId } });
          return;
        }
      }
      // Fallback: if event found via relatedTeamId
      if (relatedTeamId) {
        navigate(`/teams/${relatedTeamId}`, { state: { openEventId: relatedEventId } });
        return;
      }
    } else if (relatedTeamId) {
      navigate(`/teams/${relatedTeamId}`);
    }
  }

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
          {notifications.map(n => {
            const isClickable = !!(n.relatedEventId || n.relatedTeamId);
            return (
              <div
                key={n.id}
                role={isClickable ? 'button' : undefined}
                tabIndex={isClickable ? 0 : undefined}
                className={`bg-white rounded-xl border border-gray-200 px-4 py-3 transition-colors ${!n.isRead ? 'border-l-4 border-l-blue-500' : ''} ${isClickable ? 'cursor-pointer hover:bg-gray-50 active:bg-gray-100' : ''}`}
                onClick={() => handleNotificationClick(n.id, n.relatedEventId, n.relatedTeamId)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleNotificationClick(n.id, n.relatedEventId, n.relatedTeamId); }}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">{n.title}</p>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {!n.isRead && <span className="w-2 h-2 rounded-full bg-blue-500" />}
                    {isClickable && <ChevronRight size={14} className="text-gray-400" />}
                  </div>
                </div>
                <p className="text-sm text-gray-500 mt-0.5">{n.message}</p>
                <p className="text-xs text-gray-400 mt-1">{formatDate(n.createdAt.split('T')[0])}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
