/**
 * ProtectedRoute — auth gate tests
 *
 * Three observable states:
 *   1. loading=true            → spinner rendered, no redirect
 *   2. loading=false, user=null → Navigate to /login
 *   3. loading=false, user set  → children rendered
 *
 * The mock uses the same pattern as ParentRoute.roleGuard.test.tsx:
 * spread the real module and replace only useAuthStore with a function
 * that reads from a module-level variable so each test can set state
 * without re-importing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { User } from 'firebase/auth';

// ── Firebase stub ─────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
}));

// ── Capture Navigate redirects ────────────────────────────────────────────────
const redirectsTo: string[] = [];
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => {
      redirectsTo.push(to);
      return null;
    },
  };
});

// ── Stub auth store ───────────────────────────────────────────────────────────
type AuthState = { user: User | null; loading: boolean };
let storeState: AuthState = { user: null, loading: true };

vi.mock('@/store/useAuthStore', async () => {
  const real = await vi.importActual<typeof import('@/store/useAuthStore')>('@/store/useAuthStore');
  return {
    ...real,
    useAuthStore: () => storeState,
  };
});

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

const CHILD_TEXT = 'protected-content-sentinel';

function renderRoute() {
  redirectsTo.length = 0;
  return render(
    <MemoryRouter>
      <ProtectedRoute>
        <span>{CHILD_TEXT}</span>
      </ProtectedRoute>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    redirectsTo.length = 0;
  });

  describe('while loading', () => {
    it('renders a loading spinner, not the children', () => {
      storeState = { user: null, loading: true };
      renderRoute();
      expect(screen.queryByText(CHILD_TEXT)).toBeNull();
    });

    it('renders "Loading…" text during auth initialisation', () => {
      storeState = { user: null, loading: true };
      renderRoute();
      expect(screen.getByText('Loading…')).toBeTruthy();
    });

    it('does not redirect while loading', () => {
      storeState = { user: null, loading: true };
      renderRoute();
      expect(redirectsTo).toHaveLength(0);
    });
  });

  describe('when unauthenticated', () => {
    it('redirects to /login when there is no user and loading is done', () => {
      storeState = { user: null, loading: false };
      renderRoute();
      expect(redirectsTo).toContain('/login');
    });

    it('does not render children when unauthenticated', () => {
      storeState = { user: null, loading: false };
      renderRoute();
      expect(screen.queryByText(CHILD_TEXT)).toBeNull();
    });
  });

  describe('when authenticated', () => {
    it('renders children when a user is present', () => {
      storeState = { user: { uid: 'user-1' } as User, loading: false };
      renderRoute();
      expect(screen.getByText(CHILD_TEXT)).toBeTruthy();
    });

    it('does not redirect when authenticated', () => {
      storeState = { user: { uid: 'user-1' } as User, loading: false };
      renderRoute();
      expect(redirectsTo).toHaveLength(0);
    });
  });
});
