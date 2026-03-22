import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Calendar, CalendarDays, Users, Trophy, Bell, MessageSquare, Settings } from 'lucide-react';
import { clsx } from 'clsx';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useSettingsStore } from '@/store/useSettingsStore';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
  { to: '/events', label: 'Events', icon: CalendarDays },
  { to: '/teams', label: 'Teams', icon: Users },
  { to: '/standings', label: 'Standings', icon: Trophy },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/messaging', label: 'Messaging', icon: MessageSquare },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const unread = useNotificationStore(s => s.notifications.filter(n => !n.isRead).length);
  const kidsMode = useSettingsStore(s => s.settings.kidsSportsMode);

  return (
    <aside className="w-60 min-h-screen bg-gray-900 flex flex-col flex-shrink-0">
      <div className="px-5 py-5 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
            <Trophy size={16} className="text-white" />
          </div>
          <div>
            <span className="text-white font-bold text-sm block">Sports Scheduler</span>
            {kidsMode && <span className="text-blue-300 text-xs">Kids Mode</span>}
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => clsx(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative',
              isActive
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            )}
          >
            <Icon size={18} />
            {label}
            {label === 'Notifications' && unread > 0 && (
              <span className="ml-auto bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
