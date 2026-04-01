import { Bell, Menu } from 'lucide-react';
import { useNotificationStore } from '@/store/useNotificationStore';

interface TopBarProps {
  greeting: string;
  pageTitle: string;
  onMenuClick: () => void;
}

export function TopBar({ greeting, pageTitle, onMenuClick }: TopBarProps) {
  const { notifications, setPanelOpen } = useNotificationStore();
  const unread = notifications.filter(n => !n.isRead).length;

  return (
    <header className="border-b border-gray-200 bg-white flex items-center justify-between px-4 sm:px-6 flex-shrink-0 h-14">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors flex-shrink-0"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        {(greeting || pageTitle) && (
          <div className="min-w-0">
            {greeting && <p className="text-base sm:text-lg font-semibold text-gray-900 truncate leading-tight">{greeting}</p>}
            {pageTitle && (
              <p className={`truncate leading-tight ${greeting ? 'text-xs text-gray-400' : 'text-base sm:text-lg font-semibold text-gray-900'}`}>{pageTitle}</p>
            )}
          </div>
        )}
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
