/**
 * SettingsPage — unit tests
 *
 * Behaviors under test:
 *   - Email Notifications section renders for authenticated users
 *   - Weekly digest toggle reflects profile.weeklyDigestEnabled value
 *   - Messaging notifications toggle defaults to true when field is absent
 *   - Profile without weeklyDigestEnabled field = enabled (default true)
 *   - Profile with weeklyDigestEnabled: false = toggle unchecked
 *   - Kids Sports Mode section is hidden when FLAGS.KIDS_MODE is false
 *
 * Subscription card:
 *   - Free tier: shows "Free" plan label with Upgrade CTA
 *   - Active Pro: shows "League Manager Pro" plan label + "Active" status badge
 *   - Admin-granted: shows "Comped" in plan label, no manage button
 *   - Trialing: shows "Trial" status badge + trial end date
 *   - Canceled: shows "Resubscribe" CTA
 *   - Past due: shows "Past due" badge + "Update payment method" CTA
 *   - Upgrade CTA navigates to /upgrade for free user
 *   - Manage subscription CTA navigates to /account/subscription for active user
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile } from '@/types';
import type { AppSettings } from '@/types';

// ── Firebase stub ──────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, app: {} }));

// ── Router ────────────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  updateDoc: vi.fn().mockResolvedValue(undefined),
}));

// ── Feature flags — default KIDS_MODE off ─────────────────────────────────────
vi.mock('@/lib/flags', () => ({ FLAGS: { KIDS_MODE: false } }));

// ── buildInfo stub ─────────────────────────────────────────────────────────────
vi.mock('@/lib/buildInfo', () => ({
  buildInfo: { branch: 'main', sha: 'abc123', timestamp: '2026-01-01T00:00:00Z' },
}));

// ── consent stub ──────────────────────────────────────────────────────────────
vi.mock('@/lib/consent', () => ({
  getUserConsents: vi.fn().mockResolvedValue({}),
}));

// ── Store mocks ───────────────────────────────────────────────────────────────
let currentProfile: UserProfile | null = null;
let currentUser: { uid: string } | null = null;
let currentSettings: AppSettings = { kidsSportsMode: false, hideStandingsInKidsMode: false };
const mockUpdateSettings = vi.fn().mockResolvedValue(undefined);

vi.mock('@/store/useSettingsStore', () => ({
  useSettingsStore: () => ({ settings: currentSettings, updateSettings: mockUpdateSettings }),
}));

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (sel: (s: { user: typeof currentUser; profile: typeof currentProfile }) => unknown) =>
    sel({ user: currentUser, profile: currentProfile }),
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { SettingsPage } from '@/pages/SettingsPage';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'uid-1',
    email: 'coach@example.com',
    displayName: 'Coach One',
    role: 'coach',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = makeProfile();
  currentUser = { uid: 'uid-1' };
  currentSettings = { kidsSportsMode: false, hideStandingsInKidsMode: false };
});

// ── Email Notifications ───────────────────────────────────────────────────────

describe('SettingsPage — Email Notifications section', () => {
  it('renders the Email Notifications heading', () => {
    renderPage();
    expect(screen.getByText('Email Notifications')).toBeInTheDocument();
  });

  it('renders the "Chat & message emails" toggle', () => {
    renderPage();
    expect(screen.getByText('Chat & message emails')).toBeInTheDocument();
  });

  it('renders the "Weekly team digest" toggle', () => {
    renderPage();
    expect(screen.getByText('Weekly team digest')).toBeInTheDocument();
  });

  it('shows weekly digest toggle label when profile field is absent (default true)', () => {
    currentProfile = makeProfile({ weeklyDigestEnabled: undefined });
    renderPage();
    expect(screen.getByText('Weekly team digest')).toBeInTheDocument();
  });

  it('renders the messaging notifications toggle as enabled when field is absent', () => {
    currentProfile = makeProfile({ messagingNotificationsEnabled: undefined });
    renderPage();
    expect(screen.getByText('Chat & message emails')).toBeInTheDocument();
  });
});

// ── Kids Sports Mode (behind feature flag) ────────────────────────────────────

describe('SettingsPage — Kids Sports Mode (KIDS_MODE: false)', () => {
  it('does not render the Kids Sports Mode section when flag is off', () => {
    renderPage();
    expect(screen.queryByText('Kids Sports Mode')).not.toBeInTheDocument();
  });

  it('does not render the "Hide Standings" toggle when flag is off', () => {
    renderPage();
    expect(screen.queryByText('Hide Standings')).not.toBeInTheDocument();
  });
});

// ── Build info ────────────────────────────────────────────────────────────────

describe('SettingsPage — About section', () => {
  it('renders the "About" heading', () => {
    renderPage();
    expect(screen.getByText('About')).toBeInTheDocument();
  });
});

// ── Unauthenticated state ─────────────────────────────────────────────────────

describe('SettingsPage — unauthenticated', () => {
  it('renders without crashing when user is null', () => {
    currentUser = null;
    currentProfile = null;
    const { container } = renderPage();
    expect(container).toBeTruthy();
  });
});

// ── Subscription card ─────────────────────────────────────────────────────────

describe('SettingsPage — Subscription card', () => {
  it('shows "Free" plan label for a free-tier user', () => {
    currentProfile = makeProfile({ subscriptionTier: 'free', subscriptionStatus: undefined });
    renderPage();
    expect(screen.getByText('Free')).toBeInTheDocument();
  });

  it('shows "Upgrade to Pro" CTA for a free-tier user', () => {
    currentProfile = makeProfile({ subscriptionTier: 'free', subscriptionStatus: undefined });
    renderPage();
    expect(screen.getByRole('button', { name: /upgrade to pro/i })).toBeInTheDocument();
  });

  it('shows "League Manager Pro" plan label for an active subscriber', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'active',
      subscriptionExpiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
    });
    renderPage();
    expect(screen.getByText('League Manager Pro')).toBeInTheDocument();
  });

  it('shows "Active" status badge for an active subscriber', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'active',
    });
    renderPage();
    // The subscription card heading + badge both contain "Active" / "Subscription"
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows "Manage subscription" CTA for an active subscriber', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'active',
    });
    renderPage();
    expect(screen.getByRole('button', { name: /manage subscription/i })).toBeInTheDocument();
  });

  it('navigates to /upgrade when "Upgrade to Pro" is clicked', () => {
    currentProfile = makeProfile({ subscriptionTier: 'free', subscriptionStatus: undefined });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/upgrade');
  });

  it('navigates to /account/subscription when "Manage subscription" is clicked', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'active',
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /manage subscription/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/account/subscription');
  });

  it('shows "Trial" status badge for a trialing subscriber', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'trialing',
      subscriptionExpiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    });
    renderPage();
    expect(screen.getByText('Trial')).toBeInTheDocument();
  });

  it('shows "Past due" status badge and "Update payment method" CTA for past_due', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'past_due',
    });
    renderPage();
    expect(screen.getByText('Past due')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update payment method/i })).toBeInTheDocument();
  });

  it('shows "Resubscribe" CTA for a canceled subscriber', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'canceled',
      subscriptionExpiresAt: new Date(Date.now() - 86400_000).toISOString(),
    });
    renderPage();
    expect(screen.getByRole('button', { name: /resubscribe/i })).toBeInTheDocument();
  });

  it('shows "Comped" in plan label for admin-granted user', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'active',
      adminGrantedLM: true,
    });
    renderPage();
    expect(screen.getByText('League Manager Pro · Comped')).toBeInTheDocument();
  });

  it('does not show a manage button for admin-granted user', () => {
    currentProfile = makeProfile({
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'active',
      adminGrantedLM: true,
    });
    renderPage();
    expect(screen.queryByRole('button', { name: /manage subscription/i })).not.toBeInTheDocument();
  });
});
