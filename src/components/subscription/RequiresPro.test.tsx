/**
 * RequiresPro — unit tests
 *
 * Behaviors under test:
 *
 *   When user IS Pro:
 *     - Renders children as-is in both modes
 *     - No upgrade badge rendered
 *     - No click interception
 *
 *   Mode 'disabled' (default) when NOT Pro:
 *     - Renders children (but they are pointer-events-none)
 *     - Renders the upgrade badge
 *     - Clicking the wrapper navigates to /upgrade
 *     - Custom ctaLabel appears in the badge
 *
 *   Mode 'hidden' when NOT Pro:
 *     - Renders nothing (null)
 *
 *   Mode 'hidden' when IS Pro:
 *     - Renders children normally
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile } from '@/types';

// ── Firebase stub ─────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, functions: {} }));

// ── Router — capture navigate calls ──────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// ── Auth store ────────────────────────────────────────────────────────────────
let currentProfile: UserProfile | null = null;

vi.mock('@/store/useAuthStore', async () => {
  const real = await vi.importActual<typeof import('@/store/useAuthStore')>('@/store/useAuthStore');
  const mockState = {
    get profile() { return currentProfile; },
  };
  const useAuthStore = (sel?: (s: typeof mockState) => unknown) =>
    typeof sel === 'function' ? sel(mockState) : mockState;
  useAuthStore.getState = () => mockState;
  return { ...real, useAuthStore };
});

// ── Import under test (after all mocks) ──────────────────────────────────────
import { RequiresPro } from './RequiresPro';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProProfile(): UserProfile {
  return {
    uid: 'uid-pro',
    email: 'pro@example.com',
    displayName: 'Pro User',
    role: 'league_manager',
    createdAt: '2024-01-01T00:00:00.000Z',
    memberships: [{ role: 'league_manager', leagueId: 'l-1', isPrimary: true }],
    subscriptionTier: 'league_manager_pro',
    subscriptionStatus: 'active',
  };
}

function makeFreeProfile(): UserProfile {
  return {
    uid: 'uid-free',
    email: 'free@example.com',
    displayName: 'Free User',
    role: 'league_manager',
    createdAt: '2024-01-01T00:00:00.000Z',
    memberships: [{ role: 'league_manager', leagueId: 'l-1', isPrimary: true }],
    subscriptionTier: 'free',
    subscriptionStatus: undefined,
  };
}

function renderWrapper(props: React.ComponentProps<typeof RequiresPro>) {
  return render(
    <MemoryRouter>
      <RequiresPro {...props} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = null;
});

// ─────────────────────────────────────────────────────────────────────────────

describe('RequiresPro — Pro user (both modes)', () => {
  it('renders children normally when Pro (disabled mode)', () => {
    currentProfile = makeProProfile();
    renderWrapper({ children: <button>Create League</button> });
    expect(screen.getByRole('button', { name: 'Create League' })).toBeInTheDocument();
  });

  it('does not render upgrade badge when Pro', () => {
    currentProfile = makeProProfile();
    renderWrapper({ children: <button>Create League</button> });
    expect(screen.queryByText(/upgrade to pro/i)).toBeNull();
  });

  it('renders children when Pro in hidden mode', () => {
    currentProfile = makeProProfile();
    renderWrapper({ children: <button>Create League</button>, mode: 'hidden' });
    expect(screen.getByRole('button', { name: 'Create League' })).toBeInTheDocument();
  });
});

describe('RequiresPro — free user, disabled mode (default)', () => {
  it('renders children (visually disabled) when not Pro', () => {
    currentProfile = makeFreeProfile();
    renderWrapper({ children: <button>Create League</button> });
    // The button text is still in the DOM (opacity-50 + pointer-events-none)
    expect(screen.getByText('Create League')).toBeInTheDocument();
  });

  it('renders the upgrade badge when not Pro', () => {
    currentProfile = makeFreeProfile();
    renderWrapper({ children: <button>Create League</button> });
    expect(screen.getByText(/upgrade to pro/i)).toBeInTheDocument();
  });

  it('navigates to /upgrade when the wrapper is clicked', () => {
    currentProfile = makeFreeProfile();
    renderWrapper({ children: <button>Create League</button> });
    const upgradeBtn = screen.getByRole('button', { name: /pro feature/i });
    fireEvent.click(upgradeBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/upgrade');
  });

  it('renders a custom ctaLabel in the badge', () => {
    currentProfile = makeFreeProfile();
    renderWrapper({
      children: <button>New Season</button>,
      ctaLabel: 'Go Pro',
    });
    expect(screen.getByText(/go pro/i)).toBeInTheDocument();
  });
});

describe('RequiresPro — free user, hidden mode', () => {
  it('renders nothing when not Pro in hidden mode', () => {
    currentProfile = makeFreeProfile();
    const { container } = renderWrapper({
      children: <button>Create League</button>,
      mode: 'hidden',
    });
    expect(container.firstChild).toBeNull();
  });
});
