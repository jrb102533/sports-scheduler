import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Calendar, Users, Bell, MessageSquare, Settings, LogOut, UserCog, Layers, MapPin, X, CalendarClock, Home } from 'lucide-react';
import { clsx } from 'clsx';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useAuthStore, getMemberships } from '@/store/useAuthStore';
import { useEventStore } from '@/store/useEventStore';
import { useDmStore } from '@/store/useDmStore';
import { countUnreadThreads } from '@/lib/messagingUnread';
import { FLAGS } from '@/lib/flags';
import { todayISO, formatTime } from '@/lib/dateUtils';
import { format, parseISO, isToday, isTomorrow } from 'date-fns';

interface SidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
}

const navItems = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
  { to: '/teams', label: 'Teams', icon: Users },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/messaging', label: 'Direct Messages', icon: MessageSquare },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const adminNavItems = [
  { to: '/users', label: 'Manage Users', icon: UserCog, end: undefined },
];

const leagueNavItems = [
  { to: '/leagues', label: 'Leagues', icon: Layers, end: undefined },
];

const venueNavItems = [
  { to: '/venues', label: 'Venues', icon: MapPin, end: undefined },
];

function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  const unread = useNotificationStore(s => s.notifications.filter(n => !n.isRead).length);
  const dmThreads = useDmStore(s => s.threads);
  const dmUnread = countUnreadThreads(dmThreads.map(t => ({ id: t.id, lastMessageAt: t.lastMessageAt })));
  const kidsSetting = useSettingsStore(s => s.settings.kidsSportsMode);
  const kidsMode = FLAGS.KIDS_MODE && kidsSetting;
  const user = useAuthStore(s => s.user);
  const profile = useAuthStore(s => s.profile);
  const logout = useAuthStore(s => s.logout);
  const navigate = useNavigate();
  const allEvents = useEventStore(s => s.events);

  const today = todayISO();
  const nextEvent = allEvents
    .filter(e => e.status === 'scheduled' && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))[0] ?? null;

  function formatEventDay(dateStr: string): string {
    const d = parseISO(dateStr);
    if (isToday(d)) return 'Today';
    if (isTomorrow(d)) return 'Tomorrow';
    return format(d, 'EEE, MMM d');
  }

  const memberships = getMemberships(profile);

  const roles = new Set(memberships.map(m => m.role));
  const isElevatedNav = roles.has('admin') || roles.has('league_manager') || roles.has('coach');
  const isAdminNav = roles.has('admin');

  const homeNavItem = { to: '/home', label: 'Home', icon: Home, end: true };

  const allNavItems = !isElevatedNav
    ? [
        homeNavItem,
        { to: '/parent', label: 'My Team', icon: Users, end: true },
        navItems[3], // Notifications
        navItems[4], // Messaging
        navItems[5], // Settings
      ]
    : [
        homeNavItem,
        navItems[1], // Calendar
        navItems[2], // Teams
        ...(roles.has('admin') || roles.has('league_manager') ? leagueNavItems : []),
        ...(isElevatedNav ? venueNavItems : []),
        navItems[3], // Notifications
        navItems[4], // Messaging
        navItems[5], // Settings
        ...(isAdminNav ? adminNavItems : []),
      ];

  return (
    <>
      <div className="px-3 pt-4 pb-3 border-b border-white/10">
        <div className="bg-white rounded-xl px-3 py-2" style={{ overflow: 'hidden' }}>
          <img src="/logo.png" alt="First Whistle" className="w-full h-auto object-contain" style={{ borderRadius: '10px' }} />
        </div>
        {kidsMode && <span className="text-xs font-medium mt-1 block text-center" style={{ color: '#f97316' }}>Kids Mode</span>}
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {allNavItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavClick}
            className={({ isActive }) => clsx(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative',
              isActive
                ? 'text-white'
                : 'text-blue-200 hover:text-white hover:bg-white/10'
            )}
            style={({ isActive }) => isActive ? { backgroundColor: '#f97316' } : {}}
          >
            <Icon size={18} />
            {label}
            {label === 'Notifications' && unread > 0 && (
              <span className="ml-auto bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
            {label === 'Direct Messages' && dmUnread > 0 && (
              <span className="ml-auto bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {dmUnread > 9 ? '9+' : dmUnread}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {nextEvent && (
        <div className="mx-3 mb-3 px-3 py-2.5 rounded-lg bg-white/5 border border-white/10">
          <div className="flex items-center gap-1.5 mb-0.5">
            <CalendarClock size={12} className="text-blue-300 flex-shrink-0" />
            <span className="text-[11px] font-semibold text-blue-300 uppercase tracking-wide">Next Up</span>
          </div>
          <p className="text-white text-sm font-medium truncate leading-snug">{nextEvent.title}</p>
          <p className="text-blue-300/80 text-xs mt-0.5">
            {formatEventDay(nextEvent.date)} · {formatTime(nextEvent.startTime)}
          </p>
        </div>
      )}


      {user && (
        <div className="border-t border-white/10 px-3 py-3">
          {profile ? (
            <button
              onClick={() => { navigate('/profile'); onNavClick?.(); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ backgroundColor: '#f97316' }}>
                {(profile.displayName || '?').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{profile.displayName}</p>
              </div>
            </button>
          ) : (
            <div className="px-3 py-2.5 text-xs text-gray-500">Loading profile…</div>
          )}
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-blue-300 hover:text-red-400 hover:bg-white/10 transition-colors text-sm mt-0.5"
          >
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      )}
    </>
  );
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  return (
    <>
      {/* Desktop sidebar — always visible */}
      <aside className="hidden lg:flex w-60 min-h-screen bg-[#1B3A6B] flex-col flex-shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={onClose} />
          <aside className="relative w-72 bg-[#1B3A6B] flex flex-col h-full overflow-y-auto">
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
            <SidebarContent onNavClick={onClose} />
          </aside>
        </div>
      )}
    </>
  );
}
