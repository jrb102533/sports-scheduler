/**
 * SubscriptionStatusBadge — unit tests
 *
 * Behaviors under test:
 *   - Free tier user: renders nothing
 *   - Active Pro subscriber: shows "Pro" pill
 *   - Admin-granted Pro (no Stripe status): shows "Pro" pill
 *   - Trialing: shows "Trial · Nd" pill with correct day count
 *   - Trialing: 0 days left still shows "Trial · 0d"
 *   - Past due: shows "Past due" pill
 *   - Canceled status: renders nothing
 *   - Incomplete status: renders nothing
 *   - Click on Pro badge navigates to /account/subscription
 *   - Click on Trial badge navigates to /account/subscription
 *   - Click on Past due badge navigates to /account/subscription
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile } from '@/types';

// ── Firebase stub ─────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, functions: {} }));

// ── Router ────────────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// ── Auth store ────────────────────────────────────────────────────────────────
let currentProfile: UserProfile | null = null;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector?: (s: { profile: UserProfile | null }) => unknown) => {
    const state = { profile: currentProfile };
    return selector ? selector(state) : state;
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { SubscriptionStatusBadge } from '@/components/subscription/SubscriptionStatusBadge';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'uid-1',
    email: 'lm@example.com',
    displayName: 'League Mgr',
    role: 'league_manager',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function futureDate(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

function renderBadge() {
  return render(
    <MemoryRouter>
      <SubscriptionStatusBadge />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = null;
});

// ── Visibility tests ──────────────────────────────────────────────────────────

describe('SubscriptionStatusBadge — visibility', () => {
  it('renders nothing for a free-tier user', () => {
    currentProfile = makeProfile({ subscriptionTier: 'free', subscriptionStatus: undefined });
    const { container } = renderBadge();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when profile is null', () => {
    currentProfile = null;
    const { container } = renderBadge();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a canceled subscription', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'canceled',
    });
    const { container } = renderBadge();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for an incomplete subscription', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'incomplete',
    });
    const { container } = renderBadge();
    expect(container.firstChild).toBeNull();
  });

  it('shows "Pro" pill for an active Pro subscriber', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'active',
    });
    renderBadge();
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });

  it('shows "Pro" pill for an admin-granted user even without a Stripe status', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'free',
      subscriptionStatus: undefined,
      adminGrantedLM: true,
    });
    renderBadge();
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });

  it('shows "Past due" pill for a past_due subscription', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'past_due',
    });
    renderBadge();
    expect(screen.getByText('Past due')).toBeInTheDocument();
  });
});

// ── Trial countdown tests ─────────────────────────────────────────────────────

describe('SubscriptionStatusBadge — trial countdown', () => {
  it('shows "Trial · 10d" when 10 days remain', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'trialing',
      subscriptionExpiresAt: futureDate(10),
    });
    renderBadge();
    expect(screen.getByText('Trial · 10d')).toBeInTheDocument();
  });

  it('shows "Trial · 1d" when 1 day remains', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'trialing',
      subscriptionExpiresAt: futureDate(1),
    });
    renderBadge();
    expect(screen.getByText('Trial · 1d')).toBeInTheDocument();
  });

  it('shows "Trial · 0d" when trial has expired', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'trialing',
      subscriptionExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    renderBadge();
    expect(screen.getByText('Trial · 0d')).toBeInTheDocument();
  });
});

// ── Navigation tests ──────────────────────────────────────────────────────────

describe('SubscriptionStatusBadge — navigation', () => {
  it('navigates to /account/subscription when Pro badge is clicked', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'active',
    });
    renderBadge();
    fireEvent.click(screen.getByText('Pro'));
    expect(mockNavigate).toHaveBeenCalledWith('/account/subscription');
  });

  it('navigates to /account/subscription when Trial badge is clicked', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'trialing',
      subscriptionExpiresAt: futureDate(7),
    });
    renderBadge();
    fireEvent.click(screen.getByText('Trial · 7d'));
    expect(mockNavigate).toHaveBeenCalledWith('/account/subscription');
  });

  it('navigates to /account/subscription when Past due badge is clicked', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'past_due',
    });
    renderBadge();
    fireEvent.click(screen.getByText('Past due'));
    expect(mockNavigate).toHaveBeenCalledWith('/account/subscription');
  });
});
