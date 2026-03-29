import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { buildInfo } from '@/lib/buildInfo';
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
  const { user, profile } = useAuthStore();
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
          <div className="px-4 py-3 sm:px-6 flex items-center">
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
        {/* Build indicator — full info on non-prod, version only on prod */}
        <div className="px-4 py-1.5 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-2">
          {!buildInfo.isProduction && (
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
              buildInfo.env === 'staging' ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'
            }`}>
              {buildInfo.env}
            </span>
          )}
          <span className="text-[10px] text-gray-400 font-mono">
            {buildInfo.isProduction
              ? `v${buildInfo.version}`
              : buildInfo.pr
                ? `PR #${buildInfo.pr} · ${buildInfo.shortSha}`
                : `${buildInfo.branch} · ${buildInfo.shortSha}`
            }
          </span>
        </div>
      </div>
      <NotificationPanel />
    </div>
  );
}
