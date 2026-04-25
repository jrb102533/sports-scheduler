/**
 * SubscriptionBanner — unit tests
 *
 * Verifies:
 *   - Returns null for non-league-manager roles
 *   - Returns null for active Pro subscribers
 *   - Returns null for admin-granted Pro
 *   - Shows trial banner with days remaining for trialing users
 *   - Shows upgrade CTA for free-tier league managers
 *   - Shows upgrade CTA for canceled subscribers
 *   - Navigates to /account/subscription when "View plan" clicked in trial state
 *   - Navigates to /upgrade when "Upgrade" clicked in free-tier state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, functions: {} }));

vi.mock('@/lib/buildInfo', () => ({
  buildInfo: { version: 'test', sha: 'test', time: '', branch: '', pr: null, env: 'development', isProduction: false, shortSha: 'abc1234' },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// ─── Auth store mock ──────────────────────────────────────────────────────────

interface MockProfile {
  uid: string;
  role: string;
  subscriptionTier?: string;
  subscriptionStatus?: string;
  subscriptionExpiresAt?: string;
  adminGrantedLM?: boolean;
  memberships?: Array<{ role: string; isPrimary: boolean }>;
}

let mockProfile: MockProfile | null = null;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector?: (s: { profile: MockProfile | null }) => unknown) => {
    const state = { profile: mockProfile };
    return selector ? selector(state) : state;
  },
  hasRole: vi.fn((profile: MockProfile | null, ...roles: string[]) =>
    profile ? roles.includes(profile.role) : false
  ),
}));

import { SubscriptionBanner } from '@/components/subscription/SubscriptionBanner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderBanner() {
  return render(
    <MemoryRouter>
      <SubscriptionBanner />
    </MemoryRouter>
  );
}

const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockProfile = null;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SubscriptionBanner — hidden states', () => {
  it('renders nothing when profile is null', () => {
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a coach (non-league-manager)', () => {
    mockProfile = { uid: 'u1', role: 'coach', subscriptionTier: 'free' };
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for an active Pro subscriber', () => {
    mockProfile = {
      uid: 'u1',
      role: 'league_manager',
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'active',
    };
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for an admin-granted Pro user', () => {
    mockProfile = {
      uid: 'u1',
      role: 'league_manager',
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'active',
      adminGrantedLM: true,
    };
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });
});

describe('SubscriptionBanner — trialing state', () => {
  beforeEach(() => {
    mockProfile = {
      uid: 'u1',
      role: 'league_manager',
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'trialing',
      subscriptionExpiresAt: futureDate,
    };
  });

  it('shows "You\'re on a free trial"', () => {
    renderBanner();
    expect(screen.getByText(/you're on a free trial/i)).toBeInTheDocument();
  });

  it('shows the number of days remaining', () => {
    renderBanner();
    expect(screen.getByText(/days remaining/i)).toBeInTheDocument();
  });

  it('shows a "View plan" button', () => {
    renderBanner();
    expect(screen.getByRole('button', { name: /view plan/i })).toBeInTheDocument();
  });

  it('navigates to /account/subscription when "View plan" is clicked', () => {
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: /view plan/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/account/subscription');
  });
});

describe('SubscriptionBanner — free-tier league manager', () => {
  beforeEach(() => {
    mockProfile = {
      uid: 'u1',
      role: 'league_manager',
      subscriptionTier: 'free',
      subscriptionStatus: undefined,
    };
  });

  it('shows "Upgrade to League Manager Pro"', () => {
    renderBanner();
    expect(screen.getByText(/upgrade to league manager pro/i)).toBeInTheDocument();
  });

  it('shows an "Upgrade" button', () => {
    renderBanner();
    expect(screen.getByRole('button', { name: /upgrade/i })).toBeInTheDocument();
  });

  it('navigates to /upgrade when "Upgrade" is clicked', () => {
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: /upgrade/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/upgrade');
  });
});

describe('SubscriptionBanner — canceled subscriber', () => {
  beforeEach(() => {
    mockProfile = {
      uid: 'u1',
      role: 'league_manager',
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'canceled',
    };
  });

  it('shows "Upgrade to League Manager Pro" after cancellation', () => {
    renderBanner();
    expect(screen.getByText(/upgrade to league manager pro/i)).toBeInTheDocument();
  });
});
