import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Calendar, Users, Bell, MessageSquare, Settings, LogOut, Shield, UserCog, Layers } from 'lucide-react';
import { WhistleLogo } from '@/components/ui/WhistleLogo';
import { clsx } from 'clsx';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useAuthStore, hasRole } from '@/store/useAuthStore';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
  { to: '/teams', label: 'Teams', icon: Users },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/messaging', label: 'Messaging', icon: MessageSquare },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const adminNavItems = [
  { to: '/users', label: 'Manage Users', icon: UserCog, end: undefined },
];

const leagueNavItems = [
  { to: '/leagues', label: 'Leagues', icon: Layers, end: undefined },
];

const roleColors: Record<string, string> = {
  admin: 'text-purple-300',
  league_manager: 'text-indigo-300',
  coach: 'text-blue-300',
  player: 'text-green-300',
  parent: 'text-orange-300',
};

export function Sidebar() {
  const unread = useNotificationStore(s => s.notifications.filter(n => !n.isRead).length);
  const kidsMode = useSettingsStore(s => s.settings.kidsSportsMode);
  const { user, profile, logout } = useAuthStore();
  const navigate = useNavigate();

  return (
    <aside className="w-60 min-h-screen bg-gray-900 flex flex-col flex-shrink-0">
      <div className="px-4 py-5 border-b border-gray-700/60">
        <div className="flex items-center gap-3">
          <WhistleLogo size={36} />
          <div className="min-w-0">
            <div className="flex items-baseline gap-1">
              <span className="text-white font-bold text-sm tracking-tight">First</span>
              <span className="text-green-400 font-medium text-sm tracking-tight">Whistle</span>
            </div>
            {kidsMode && <span className="text-green-400 text-xs font-medium">Kids Mode</span>}
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {[
          ...navItems,
          ...(hasRole(profile, 'admin', 'league_manager') ? leagueNavItems : []),
          ...(hasRole(profile, 'admin') ? adminNavItems : []),
        ].map(({ to, label, icon: Icon, end }) => (
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

      {/* User section — always show logout when authenticated */}
      {user && (
        <div className="border-t border-gray-700 px-3 py-3">
          {profile ? (
            <button
              onClick={() => navigate('/profile')}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800 transition-colors text-left"
            >
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                {profile.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{profile.displayName}</p>
                <p className={clsx('text-xs flex items-center gap-1', roleColors[profile.role] ?? 'text-gray-400')}>
                  <Shield size={10} /> {profile.role.replace('_', ' ')}
                </p>
              </div>
            </button>
          ) : (
            <div className="px-3 py-2.5 text-xs text-gray-500">Loading profile…</div>
          )}
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-gray-800 transition-colors text-sm mt-0.5"
          >
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      )}
    </aside>
  );
}
