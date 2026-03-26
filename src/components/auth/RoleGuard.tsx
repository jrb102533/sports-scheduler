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
  const profile = useAuthStore(s => s.profile);
  if (!hasRole(profile, ...roles)) {
    return redirect ? <Navigate to="/" replace /> : <>{fallback}</>;
  }
  return <>{children}</>;
}
