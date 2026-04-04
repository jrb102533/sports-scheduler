import { createBrowserRouter, Navigate } from 'react-router-dom';
import { MainLayout } from '@/layouts/MainLayout';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { RoleGuard } from '@/components/auth/RoleGuard';
import { Dashboard } from '@/pages/Dashboard';
import { CalendarPage } from '@/pages/CalendarPage';
import { TeamsPage } from '@/pages/TeamsPage';
import { TeamDetailPage } from '@/pages/TeamDetailPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { MessagingPage } from '@/pages/MessagingPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { LoginPage } from '@/pages/LoginPage';
import { SignupPage } from '@/pages/SignupPage';
import { UsersPage } from '@/pages/UsersPage';
import { LeaguesPage } from '@/pages/LeaguesPage';
import { LeagueDetailPage } from '@/pages/LeagueDetailPage';
import { SeasonDashboard } from '@/pages/SeasonDashboard';
import { CoachAvailabilityPage } from '@/pages/CoachAvailabilityPage';
import { VenuesPage } from '@/pages/VenuesPage';
import { PrivacyPolicyPage } from '@/pages/legal/PrivacyPolicyPage';
import { TermsOfServicePage } from '@/pages/legal/TermsOfServicePage';
import { InviteAcceptancePage } from '@/pages/InviteAcceptancePage';
import { ParentHomePage } from '@/pages/ParentHomePage';
import { HomePage } from '@/pages/HomePage';

export const router = createBrowserRouter([
  // Public auth routes
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },

  // Public legal routes
  { path: '/legal/privacy-policy', element: <PrivacyPolicyPage /> },
  { path: '/legal/terms-of-service', element: <TermsOfServicePage /> },

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
      { path: 'teams', element: <TeamsPage /> },
      { path: 'teams/:id', element: <TeamDetailPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'messaging', element: <MessagingPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'users', element: <RoleGuard roles={['admin']} redirect><UsersPage /></RoleGuard> },
      { path: 'leagues', element: <LeaguesPage /> },
      { path: 'leagues/:id', element: <LeagueDetailPage /> },
      { path: 'leagues/:leagueId/seasons/:seasonId', element: <SeasonDashboard /> },
      { path: 'leagues/:leagueId/availability/:collectionId', element: <CoachAvailabilityPage /> },
      { path: 'venues', element: <VenuesPage /> },
      { path: 'invite/league', element: <InviteAcceptancePage /> },
      { path: 'home', element: <HomePage /> },
      { path: 'parent', element: <ParentHomePage /> },
    ],
  },

  // Catch-all
  { path: '*', element: <Navigate to="/" replace /> },
]);
