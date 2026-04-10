import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { buildInfo } from '@/lib/buildInfo';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { NotificationPanel } from '@/components/layout/NotificationPanel';
import { useNotificationTrigger } from '@/hooks/useNotificationTrigger';
import { useAttendanceNotification } from '@/hooks/useAttendanceNotification';
import { useIdleTimeout } from '@/hooks/useIdleTimeout';
import { SessionTimeoutModal } from '@/components/auth/SessionTimeoutModal';
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
  '/home': 'Home',
  '/calendar': 'Calendar',
  '/teams': 'Teams',
  '/notifications': 'Notifications',
  '/messaging': 'Messaging',
  '/settings': 'Settings',
  '/profile': 'My Profile',
  '/users': 'Manage Users',
  '/leagues': 'Leagues',
  '/venues': 'Venues',
  '/parent': 'My Team',
  '/standings': 'Standings',
};

export function MainLayout() {
  useNotificationTrigger();
  useAttendanceNotification();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuthStore();
  const logout = useAuthStore(s => s.logout);

  const handleTimeout = useCallback(() => { void logout(); }, [logout]);
  const { showWarning, countdown, resetTimer } = useIdleTimeout({ onTimeout: handleTimeout });
  // Subscribe all Firestore collections when user is authenticated.
  useEffect(() => {
    if (!user) return;
    const unsubs = [
      useTeamStore.getState().subscribe(),
      usePlayerStore.getState().subscribe(),
      useEventStore.getState().subscribe(),
      useNotificationStore.getState().subscribe(user.uid),
      useSettingsStore.getState().subscribe(user.uid),
      useLeagueStore.getState().subscribe(),
      useOpponentStore.getState().subscribe(),
    ];
    return () => unsubs.forEach(u => u());
  }, [user]);

  const profile = useAuthStore(s => s.profile);

  const location = useLocation();
  const isHome = location.pathname === '/' || location.pathname === '/home';
  const firstName = profile?.displayName?.split(' ')[0] ?? '';
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const greeting = firstName ? `${timeOfDay}, ${firstName}` : timeOfDay;
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
        {/* Staging/preview environment banner — hidden in production */}
        {!buildInfo.isProduction && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-1 flex items-center gap-2 text-[11px] flex-shrink-0">
            <span className={`font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
              buildInfo.env === 'staging' ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'
            }`}>
              {buildInfo.env}
            </span>
            <span className="text-amber-600 font-mono">
              {buildInfo.pr ? `PR #${buildInfo.pr} · ${buildInfo.shortSha}` : `${buildInfo.branch} · ${buildInfo.shortSha}`}
            </span>
          </div>
        )}
        <div style={{ background: 'linear-gradient(135deg, #1B3A6B 0%, #0f2a52 100%)' }}>
          <div className="px-4 py-3 sm:px-6 flex items-center">
            <div>
              <p className="text-base font-bold text-white leading-none">First <span style={{ color: '#f97316' }}>Whistle</span></p>
              <p className="text-blue-300 text-xs mt-1 leading-snug">Schedule games · Track rosters · Manage leagues</p>
            </div>
          </div>
        </div>
        <TopBar greeting={greeting} onMenuClick={() => setSidebarOpen(true)} />
        {pageTitle && (
          <div className="bg-gray-50 border-b border-gray-200 px-4 sm:px-6 py-2">
            <p className="text-sm font-semibold text-gray-700">{pageTitle}</p>
          </div>
        )}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <NotificationPanel />
      {showWarning && (
        <SessionTimeoutModal
          countdown={countdown}
          onStaySignedIn={resetTimer}
          onSignOut={() => void logout()}
        />
      )}
    </div>
  );
}
