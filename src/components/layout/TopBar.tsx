import { Bell, Menu, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useAuthStore } from '@/store/useAuthStore';

interface TopBarProps {
  greeting: string;
  onMenuClick: () => void;
}

export function TopBar({ greeting, onMenuClick }: TopBarProps) {
  const { notifications, setPanelOpen } = useNotificationStore();
  const unread = notifications.filter(n => !n.isRead).length;
  const profile = useAuthStore(s => s.profile);
  const logout = useAuthStore(s => s.logout);
  const navigate = useNavigate();

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
        <p className="text-sm font-medium text-gray-700">{greeting}</p>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Notification bell */}
        <button
          onClick={() => setPanelOpen(true)}
          className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
          aria-label="Notifications"
        >
          <Bell size={20} />
          {unread > 0 && (
            <span className="absolute top-1 right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {/* User avatar + name */}
        {profile && (
          <button
            onClick={() => navigate('/profile')}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0" style={{ backgroundColor: '#f97316' }}>
              {(profile.displayName || '?').charAt(0).toUpperCase()}
            </div>
            <span className="hidden sm:block text-sm font-medium text-gray-700 truncate max-w-[120px]">{profile.displayName}</span>
          </button>
        )}

        {/* Sign out */}
        <button
          onClick={logout}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-red-500 transition-colors"
          aria-label="Sign out"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
