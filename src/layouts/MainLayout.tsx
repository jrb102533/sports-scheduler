import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { NotificationPanel } from '@/components/layout/NotificationPanel';
import { useNotificationTrigger } from '@/hooks/useNotificationTrigger';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/calendar': 'Calendar',
  '/events': 'Events',
  '/teams': 'Teams',
  '/standings': 'Standings',
  '/notifications': 'Notifications',
};

export function MainLayout() {
  useNotificationTrigger();
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] ?? (location.pathname.startsWith('/teams/') ? 'Team Details' : 'Sports Scheduler');

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
