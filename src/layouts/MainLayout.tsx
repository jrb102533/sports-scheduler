import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { NotificationPanel } from '@/components/layout/NotificationPanel';
import { useNotificationTrigger } from '@/hooks/useNotificationTrigger';
import { useAttendanceNotification } from '@/hooks/useAttendanceNotification';
import { useAuthStore } from '@/store/useAuthStore';
import { useTeamStore } from '@/store/useTeamStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useEventStore } from '@/store/useEventStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useLeagueStore } from '@/store/useLeagueStore';
import { useOpponentStore } from '@/store/useOpponentStore';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/calendar': 'Calendar',
  '/teams': 'Teams',
  '/notifications': 'Notifications',
  '/messaging': 'Messaging',
  '/settings': 'Settings',
  '/profile': 'My Profile',
  '/users': 'Manage Users',
  '/leagues': 'Leagues',
};

export function MainLayout() {
  useNotificationTrigger();
  useAttendanceNotification();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const user = useAuthStore(s => s.user);
  const profile = useAuthStore(s => s.profile);
  const subscribeTeams = useTeamStore(s => s.subscribe);
  const subscribePlayers = usePlayerStore(s => s.subscribe);
  const subscribeEvents = useEventStore(s => s.subscribe);
  const subscribeNotifications = useNotificationStore(s => s.subscribe);
  const subscribeSettings = useSettingsStore(s => s.subscribe);
  const subscribeLeagues = useLeagueStore(s => s.subscribe);
  const subscribeOpponents = useOpponentStore(s => s.subscribe);

  // Subscribe all Firestore collections when user is authenticated
  useEffect(() => {
    if (!user) return;
    const unsubs = [
      subscribeTeams(),
      subscribePlayers(),
      subscribeEvents(),
      subscribeNotifications(user.uid),
      subscribeSettings(user.uid),
      subscribeLeagues(),
      subscribeOpponents(),
    ];
    return () => unsubs.forEach(u => u());
  }, [user, subscribeTeams, subscribePlayers, subscribeEvents, subscribeNotifications, subscribeSettings, subscribeLeagues, subscribeOpponents]);

  const location = useLocation();
  const firstName = profile?.displayName?.split(' ')[0] ?? '';
  const isHome = location.pathname === '/';
  const greeting = isHome ? (firstName ? `Welcome, ${firstName}` : 'Welcome') : '';
  const pageTitle = isHome
    ? ''
    : PAGE_TITLES[location.pathname]
      ?? (location.pathname.startsWith('/teams/') ? 'Team Details'
        : location.pathname.startsWith('/leagues/') ? 'League'
        : 'First Whistle');

  return (
    <div className="flex w-full min-h-screen">
      <Sidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <div style={{ background: 'linear-gradient(135deg, #1B3A6B 0%, #0f2a52 100%)' }}>
          <div className="px-4 py-3 sm:px-6 flex items-center gap-3">
            <div className="flex-shrink-0 bg-white rounded-xl p-1" style={{ width: 44, height: 44, overflow: 'hidden' }}>
              <img src="/logo.png" alt="First Whistle" className="w-full h-full object-contain" style={{ transform: 'scale(1.2)', transformOrigin: 'center', borderRadius: '10px' }} />
            </div>
            <div>
              <p className="text-base font-bold text-white leading-none">First <span style={{ color: '#f97316' }}>Whistle</span></p>
              <p className="text-blue-300 text-xs mt-1 leading-snug">Schedule games · Track rosters · Manage leagues</p>
            </div>
          </div>
        </div>
        <TopBar greeting={greeting} pageTitle={pageTitle} onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <NotificationPanel />
    </div>
  );
}
