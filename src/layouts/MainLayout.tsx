import { useEffect } from 'react';
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

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/calendar': 'Calendar',
  '/events': 'Events',
  '/teams': 'Teams',
  '/standings': 'Standings',
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

  const { user } = useAuthStore();
  const subscribeTeams = useTeamStore(s => s.subscribe);
  const subscribePlayers = usePlayerStore(s => s.subscribe);
  const subscribeEvents = useEventStore(s => s.subscribe);
  const subscribeNotifications = useNotificationStore(s => s.subscribe);
  const subscribeSettings = useSettingsStore(s => s.subscribe);
  const subscribeLeagues = useLeagueStore(s => s.subscribe);

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
    ];
    return () => unsubs.forEach(u => u());
  }, [user, subscribeTeams, subscribePlayers, subscribeEvents, subscribeNotifications, subscribeSettings, subscribeLeagues]);

  const location = useLocation();
  const title = PAGE_TITLES[location.pathname]
    ?? (location.pathname.startsWith('/teams/') ? 'Team Details' : 'First Whistle');

  return (
    <div className="flex w-full min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={title} />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <NotificationPanel />
    </div>
  );
}
