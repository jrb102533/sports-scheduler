import { createBrowserRouter, Navigate } from 'react-router-dom';
import { MainLayout } from '@/layouts/MainLayout';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { Dashboard } from '@/pages/Dashboard';
import { CalendarPage } from '@/pages/CalendarPage';
import { EventsPage } from '@/pages/EventsPage';
import { TeamsPage } from '@/pages/TeamsPage';
import { TeamDetailPage } from '@/pages/TeamDetailPage';
import { StandingsPage } from '@/pages/StandingsPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { MessagingPage } from '@/pages/MessagingPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { LoginPage } from '@/pages/LoginPage';
import { SignupPage } from '@/pages/SignupPage';
import { UsersPage } from '@/pages/UsersPage';
import { LeaguesPage } from '@/pages/LeaguesPage';

export const router = createBrowserRouter([
  // Public auth routes
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },

  // Protected app routes
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <MainLayout />
      </ProtectedRoute>
    ),
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
      { path: 'profile', element: <ProfilePage /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'leagues', element: <LeaguesPage /> },
    ],
  },

  // Catch-all
  { path: '*', element: <Navigate to="/" replace /> },
]);
