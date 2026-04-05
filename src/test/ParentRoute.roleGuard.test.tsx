/**
 * /parent route — RoleGuard enforcement (closes #182)
 *
 * The /parent route is wrapped with:
 *   <RoleGuard roles={['player', 'parent']} redirect>
 *     <ParentHomePage />
 *   </RoleGuard>
 *
 * These tests verify the guard behaviour by mounting RoleGuard directly with a
 * stubbed auth store, keeping the test surface minimal and focused.
 *
 * Behaviours under test:
 *   1. Player user       → children rendered (access granted)
 *   2. Parent user       → children rendered (access granted)
 *   3. Coach-only user   → Navigate to "/" rendered (access denied)
 *   4. Admin user        → Navigate to "/" rendered (access denied)
 *   5. Multi-membership coach+parent user → children rendered (parent role satisfies guard)
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile } from '@/types';

// ─── Firebase stub ────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
}));

// ─── Navigate spy — capture redirect target ───────────────────────────────────
const mockNavigateTo: string[] = [];

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => {
      mockNavigateTo.push(to);
      return null;
    },
  };
});

// ─── Auth store — real hasRole, stubbed profile ───────────────────────────────
let currentProfile: UserProfile | null = null;

vi.mock('@/store/useAuthStore', async () => {
  const real = await vi.importActual<typeof import('@/store/useAuthStore')>('@/store/useAuthStore');
  return {
    ...real,
    useAuthStore: (selector: (s: { profile: UserProfile | null }) => unknown) =>
      selector({ profile: currentProfile }),
  };
});

// ─── Import after mocks ───────────────────────────────────────────────────────
import { RoleGuard } from '@/components/auth/RoleGuard';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeProfile(
  role: UserProfile['role'],
  overrides: Partial<UserProfile> = {}
): UserProfile {
  return {
    uid: 'uid-test',
    email: 'test@example.com',
    displayName: 'Test User',
    role,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const SENTINEL_TEXT = 'parent-page-sentinel';

function renderGuard() {
  mockNavigateTo.length = 0;
  return render(
    <MemoryRouter>
      <RoleGuard roles={['player', 'parent']} redirect>
        <span>{SENTINEL_TEXT}</span>
      </RoleGuard>
    </MemoryRouter>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('/parent route — RoleGuard with roles=[player, parent] redirect', () => {

  it('allows a player user through the guard', () => {
    currentProfile = makeProfile('player');
    const { getByText } = renderGuard();

    expect(getByText(SENTINEL_TEXT)).toBeTruthy();
    expect(mockNavigateTo).toHaveLength(0);
  });

  it('allows a parent user through the guard', () => {
    currentProfile = makeProfile('parent');
    const { getByText } = renderGuard();

    expect(getByText(SENTINEL_TEXT)).toBeTruthy();
    expect(mockNavigateTo).toHaveLength(0);
  });

  it('redirects a coach-only user to "/"', () => {
    currentProfile = makeProfile('coach');
    const { queryByText } = renderGuard();

    expect(queryByText(SENTINEL_TEXT)).toBeNull();
    expect(mockNavigateTo).toContain('/');
  });

  it('redirects an admin user to "/"', () => {
    currentProfile = makeProfile('admin');
    const { queryByText } = renderGuard();

    expect(queryByText(SENTINEL_TEXT)).toBeNull();
    expect(mockNavigateTo).toContain('/');
  });

  it('redirects a league_manager user to "/"', () => {
    currentProfile = makeProfile('league_manager');
    const { queryByText } = renderGuard();

    expect(queryByText(SENTINEL_TEXT)).toBeNull();
    expect(mockNavigateTo).toContain('/');
  });

  it('allows a multi-membership coach+parent user through — parent membership satisfies the guard', () => {
    currentProfile = makeProfile('coach', {
      memberships: [
        { role: 'coach', teamId: 't1' },
        { role: 'parent', teamId: 't2', playerId: 'p1' },
      ],
    });
    const { getByText } = renderGuard();

    expect(getByText(SENTINEL_TEXT)).toBeTruthy();
    expect(mockNavigateTo).toHaveLength(0);
  });

  it('redirects when profile is null (unauthenticated)', () => {
    currentProfile = null;
    const { queryByText } = renderGuard();

    expect(queryByText(SENTINEL_TEXT)).toBeNull();
    expect(mockNavigateTo).toContain('/');
  });

});
