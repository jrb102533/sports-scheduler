import { createBrowserRouter } from 'react-router-dom';
import { MainLayout } from '@/layouts/MainLayout';
import { Dashboard } from '@/pages/Dashboard';
import { CalendarPage } from '@/pages/CalendarPage';
import { EventsPage } from '@/pages/EventsPage';
import { TeamsPage } from '@/pages/TeamsPage';
import { TeamDetailPage } from '@/pages/TeamDetailPage';
import { StandingsPage } from '@/pages/StandingsPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { MessagingPage } from '@/pages/MessagingPage';
import { SettingsPage } from '@/pages/SettingsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <MainLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'calendar', element: <CalendarPage /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'teams', element: <TeamsPage /> },
      { path: 'teams/:id', element: <TeamDetailPage /> },
      { path: 'standings', element: <StandingsPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'messaging', element: <MessagingPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);
