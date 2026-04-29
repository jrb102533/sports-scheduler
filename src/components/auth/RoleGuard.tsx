import { Navigate } from 'react-router-dom';
import { useAuthStore, hasRole } from '@/store/useAuthStore';
import type { UserRole } from '@/types';

interface RoleGuardProps {
  roles: UserRole[];
  children: React.ReactNode;
  /** If true, redirect to '/' when role check fails instead of rendering the fallback. */
  redirect?: boolean;
  fallback?: React.ReactNode;
}

/** Renders children only when the signed-in user has one of the given roles. */
export function RoleGuard({ roles, children, redirect = false, fallback = null }: RoleGuardProps) {
  const user = useAuthStore(s => s.user);
  const profile = useAuthStore(s => s.profile);

  // User is authenticated but profile hasn't arrived from Firestore yet — hold
  // rather than redirect. ProtectedRoute sets loading=false before the profile
  // snapshot fires, so this covers the gap window.
  if (user && !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasRole(profile, ...roles)) {
    return redirect ? <Navigate to="/" replace /> : <>{fallback}</>;
  }
  return <>{children}</>;
}
