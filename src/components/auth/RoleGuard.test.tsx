/**
 * RoleGuard — fallback and non-redirect mode tests
 *
 * The existing ParentRoute.roleGuard.test.tsx covers the redirect=true path.
 * This file covers the complementary cases:
 *   1. fallback prop is rendered (not redirect) when role check fails
 *   2. Custom fallback content is rendered in place of children
 *   3. No Navigate call is made when redirect=false (default)
 *   4. null profile blocks access in non-redirect mode
 *   5. All 5 roles individually either pass or block correctly for a
 *      specific guard configuration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile } from '@/types';

// ── Firebase stub ─────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
}));

// ── Capture Navigate calls to detect unwanted redirects ───────────────────────
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

// ── Auth store — real hasRole, stubbed profile ────────────────────────────────
let currentProfile: UserProfile | null = null;
vi.mock('@/store/useAuthStore', async () => {
  const real = await vi.importActual<typeof import('@/store/useAuthStore')>('@/store/useAuthStore');
  return {
    ...real,
    useAuthStore: (selector: (s: { profile: UserProfile | null }) => unknown) =>
      selector({ profile: currentProfile }),
  };
});

import { RoleGuard } from '@/components/auth/RoleGuard';

function makeProfile(role: UserProfile['role'], overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'uid-test',
    email: 'test@example.com',
    displayName: 'Test User',
    role,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const CHILD = 'guarded-children-sentinel';
const FALLBACK = 'fallback-sentinel';

describe('RoleGuard — fallback mode (redirect=false)', () => {
  beforeEach(() => {
    redirectsTo.length = 0;
  });

  it('renders children when role is permitted', () => {
    currentProfile = makeProfile('admin');
    render(
      <MemoryRouter>
        <RoleGuard roles={['admin']} fallback={<span>{FALLBACK}</span>}>
          <span>{CHILD}</span>
        </RoleGuard>
      </MemoryRouter>
    );
    expect(screen.getByText(CHILD)).toBeTruthy();
    expect(screen.queryByText(FALLBACK)).toBeNull();
  });

  it('renders the fallback when role is not permitted', () => {
    currentProfile = makeProfile('player');
    render(
      <MemoryRouter>
        <RoleGuard roles={['admin']} fallback={<span>{FALLBACK}</span>}>
          <span>{CHILD}</span>
        </RoleGuard>
      </MemoryRouter>
    );
    expect(screen.getByText(FALLBACK)).toBeTruthy();
    expect(screen.queryByText(CHILD)).toBeNull();
  });

  it('renders null (no fallback, no redirect) when role check fails and fallback is omitted', () => {
    currentProfile = makeProfile('player');
    const { container } = render(
      <MemoryRouter>
        <RoleGuard roles={['admin']}>
          <span>{CHILD}</span>
        </RoleGuard>
      </MemoryRouter>
    );
    expect(screen.queryByText(CHILD)).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('does NOT call Navigate when redirect=false (default)', () => {
    currentProfile = makeProfile('player');
    render(
      <MemoryRouter>
        <RoleGuard roles={['admin']}>
          <span>{CHILD}</span>
        </RoleGuard>
      </MemoryRouter>
    );
    expect(redirectsTo).toHaveLength(0);
  });

  it('renders fallback when profile is null', () => {
    currentProfile = null;
    render(
      <MemoryRouter>
        <RoleGuard roles={['admin']} fallback={<span>{FALLBACK}</span>}>
          <span>{CHILD}</span>
        </RoleGuard>
      </MemoryRouter>
    );
    expect(screen.getByText(FALLBACK)).toBeTruthy();
    expect(screen.queryByText(CHILD)).toBeNull();
  });
});

describe('RoleGuard — all 5 roles against admin-only guard', () => {
  beforeEach(() => {
    redirectsTo.length = 0;
  });

  const blockedRoles: UserProfile['role'][] = ['coach', 'league_manager', 'parent', 'player'];

  for (const role of blockedRoles) {
    it(`blocks ${role} from an admin-only guard`, () => {
      currentProfile = makeProfile(role);
      render(
        <MemoryRouter>
          <RoleGuard roles={['admin']} fallback={<span>{FALLBACK}</span>}>
            <span>{CHILD}</span>
          </RoleGuard>
        </MemoryRouter>
      );
      expect(screen.queryByText(CHILD)).toBeNull();
      expect(screen.getByText(FALLBACK)).toBeTruthy();
    });
  }

  it('allows admin through the admin-only guard', () => {
    currentProfile = makeProfile('admin');
    render(
      <MemoryRouter>
        <RoleGuard roles={['admin']} fallback={<span>{FALLBACK}</span>}>
          <span>{CHILD}</span>
        </RoleGuard>
      </MemoryRouter>
    );
    expect(screen.getByText(CHILD)).toBeTruthy();
    expect(screen.queryByText(FALLBACK)).toBeNull();
  });
});

describe('RoleGuard — multi-role guards', () => {
  it('allows a coach through a coach+admin guard', () => {
    currentProfile = makeProfile('coach');
    render(
      <MemoryRouter>
        <RoleGuard roles={['admin', 'coach', 'league_manager']} fallback={<span>{FALLBACK}</span>}>
          <span>{CHILD}</span>
        </RoleGuard>
      </MemoryRouter>
    );
    expect(screen.getByText(CHILD)).toBeTruthy();
  });

  it('blocks parent from a coach+admin+league_manager guard', () => {
    currentProfile = makeProfile('parent');
    render(
      <MemoryRouter>
        <RoleGuard roles={['admin', 'coach', 'league_manager']} fallback={<span>{FALLBACK}</span>}>
          <span>{CHILD}</span>
        </RoleGuard>
      </MemoryRouter>
    );
    expect(screen.getByText(FALLBACK)).toBeTruthy();
  });

  it('allows a user with multiple memberships where one matches', () => {
    // User is primarily a parent but also a coach on another team
    currentProfile = makeProfile('parent', {
      memberships: [
        { role: 'parent', teamId: 'team-1', isPrimary: true },
        { role: 'coach', teamId: 'team-2', isPrimary: false },
      ],
    });
    render(
      <MemoryRouter>
        <RoleGuard roles={['coach']} fallback={<span>{FALLBACK}</span>}>
          <span>{CHILD}</span>
        </RoleGuard>
      </MemoryRouter>
    );
    expect(screen.getByText(CHILD)).toBeTruthy();
  });
});
