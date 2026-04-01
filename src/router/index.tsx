import { createBrowserRouter, Navigate, useRouteError } from 'react-router-dom';
import { MainLayout } from '@/layouts/MainLayout';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

function RootErrorBoundary() {
  const error = useRouteError() as Error;
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 720 }}>
      <h1 style={{ color: '#dc2626', fontSize: 20, marginBottom: 12 }}>Something went wrong</h1>
      <pre style={{ background: '#f3f4f6', padding: 16, borderRadius: 8, fontSize: 12, overflow: 'auto', whiteSpace: 'pre-wrap', color: '#1f2937' }}>
        {error?.message ?? String(error)}
      </pre>
      <pre style={{ background: '#fef3c7', padding: 16, borderRadius: 8, fontSize: 11, overflow: 'auto', whiteSpace: 'pre-wrap', color: '#92400e', marginTop: 8 }}>
        {error?.stack ?? ''}
      </pre>
      <button onClick={() => window.location.href = '/'} style={{ marginTop: 16, background: '#2563eb', color: 'white', border: 'none', padding: '8px 20px', borderRadius: 8, cursor: 'pointer' }}>
        Reload App
      </button>
    </div>
  );
}
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
import { LogoComparisonPage } from '@/pages/LogoComparisonPage';

export const router = createBrowserRouter([
  // Public auth routes
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },

  // Dev-only routes
  { path: '/logo-compare', element: <LogoComparisonPage /> },

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
    errorElement: <RootErrorBoundary />,
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
      { path: 'parent', element: <ParentHomePage /> },
    ],
  },

  // Catch-all
  { path: '*', element: <Navigate to="/" replace /> },
]);
