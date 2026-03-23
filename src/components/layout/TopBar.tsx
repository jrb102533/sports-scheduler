import { Bell, Menu } from 'lucide-react';
import { useNotificationStore } from '@/store/useNotificationStore';

interface TopBarProps {
  title: string;
  onMenuClick: () => void;
}

export function TopBar({ title, onMenuClick }: TopBarProps) {
  const { notifications, setPanelOpen } = useNotificationStore();
  const unread = notifications.filter(n => !n.isRead).length;

  return (
    <header className="h-14 border-b border-gray-200 bg-white flex items-center justify-between px-4 sm:px-6 flex-shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors flex-shrink-0"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <h1 className="text-base sm:text-lg font-semibold text-gray-900 truncate">{title}</h1>
      </div>
      <button
        onClick={() => setPanelOpen(true)}
        className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors flex-shrink-0"
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute top-1 right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    </header>
  );
}
