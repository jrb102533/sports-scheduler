import { useAuthStore, hasRole } from '@/store/useAuthStore';
import type { UserRole } from '@/types';

interface RoleGuardProps {
  roles: UserRole[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/** Renders children only when the signed-in user has one of the given roles. */
export function RoleGuard({ roles, children, fallback = null }: RoleGuardProps) {
  const profile = useAuthStore(s => s.profile);
  if (!hasRole(profile, ...roles)) return <>{fallback}</>;
  return <>{children}</>;
}
