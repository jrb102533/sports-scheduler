/**
 * SubscriptionPage — unit tests
 *
 * Verifies:
 *   - Redirects free-tier users to /upgrade
 *   - Active Pro subscriber: shows plan name and status badge
 *   - Trialing: shows trial status + days remaining
 *   - Canceled: shows canceled status + re-subscribe CTA
 *   - "Manage subscription" writes to portal_links and redirects
 *   - Admin-granted: shows "Admin granted" badge, no manage button
 *   - checkout=success query param shows success banner
 *   - Portal link error is displayed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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

// ─── Firebase Functions mock (createPortalLink callable) ─────────────────────

const mockCreatePortal = vi.fn();

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => mockCreatePortal),
}));

// ─── Auth store mock ──────────────────────────────────────────────────────────

interface MockProfile {
  uid: string;
  role: string;
  subscriptionTier: string;
  subscriptionStatus: string | null;
  subscriptionExpiresAt?: string;
  adminGrantedLM?: boolean;
  memberships?: Array<{ role: string; isPrimary: boolean }>;
}

let mockProfile: MockProfile | null = null;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector?: (s: { profile: MockProfile | null; user: { uid: string } | null }) => unknown) => {
    const state = {
      profile: mockProfile,
      user: mockProfile ? { uid: mockProfile.uid } : null,
    };
    return selector ? selector(state) : state;
  },
  hasRole: vi.fn((profile: MockProfile | null, ...roles: string[]) =>
    profile ? roles.includes(profile.role) : false
  ),
}));

import { SubscriptionPage } from '@/pages/SubscriptionPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/account/subscription${search}`]}>
      <Routes>
        <Route path="/account/subscription" element={<SubscriptionPage />} />
        <Route path="/upgrade" element={<div>Upgrade page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockProfile = null;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SubscriptionPage — redirect for free-tier users', () => {
  it('redirects to /upgrade when subscriptionTier is "free"', async () => {
    mockProfile = {
      uid: 'uid-1',
      role: 'league_manager',
      subscriptionTier: 'free',
      subscriptionStatus: null,
    };
    renderPage();
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/upgrade', { replace: true });
    });
  });

  it('does NOT redirect when subscriptionStatus is "trialing"', async () => {
    mockProfile = {
      uid: 'uid-1',
      role: 'league_manager',
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'trialing',
      subscriptionExpiresAt: futureDate,
    };
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /subscription/i })).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('/upgrade', expect.anything());
  });
});

describe('SubscriptionPage — active subscriber', () => {
  beforeEach(() => {
    mockProfile = {
      uid: 'uid-1',
      role: 'league_manager',
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'active',
      subscriptionExpiresAt: futureDate,
    };
  });

  it('shows the plan name', () => {
    renderPage();
    expect(screen.getAllByText(/league manager pro/i).length).toBeGreaterThan(0);
  });

  it('shows the "Active" status badge', () => {
    renderPage();
    // getAllByText because the aria description also contains "active"
    const activeEls = screen.getAllByText(/^active$/i);
    expect(activeEls.length).toBeGreaterThan(0);
  });

  it('shows the "Manage subscription" button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /manage subscription/i })).toBeInTheDocument();
  });
});

describe('SubscriptionPage — trialing subscriber', () => {
  beforeEach(() => {
    mockProfile = {
      uid: 'uid-1',
      role: 'league_manager',
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'trialing',
      subscriptionExpiresAt: futureDate,
    };
  });

  it('shows the "Free trial" status badge', () => {
    renderPage();
    // Multiple elements contain "free trial" text; just assert at least one exists
    expect(screen.getAllByText(/free trial/i).length).toBeGreaterThan(0);
  });

  it('shows days remaining in the trial', () => {
    renderPage();
    // The text is split across elements: "<N> days remaining in your free trial."
    // Use a custom matcher on the container instead of getByText.
    expect(screen.getByText(/remaining in your free trial/i)).toBeInTheDocument();
  });
});

describe('SubscriptionPage — canceled subscriber', () => {
  beforeEach(() => {
    mockProfile = {
      uid: 'uid-1',
      role: 'league_manager',
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'canceled',
      subscriptionExpiresAt: pastDate,
    };
  });

  it('shows the "Canceled" status badge', () => {
    renderPage();
    expect(screen.getAllByText(/canceled/i).length).toBeGreaterThan(0);
  });

  it('shows a re-subscribe CTA', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /view plans/i })).toBeInTheDocument();
  });

  it('navigates to /upgrade when clicking "View plans"', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /view plans/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/upgrade');
  });
});

describe('SubscriptionPage — admin-granted Pro', () => {
  beforeEach(() => {
    mockProfile = {
      uid: 'uid-1',
      role: 'league_manager',
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'active',
      adminGrantedLM: true,
    };
  });

  it('shows the "Admin granted" badge', () => {
    renderPage();
    expect(screen.getByText(/admin granted/i)).toBeInTheDocument();
  });

  it('does NOT show the "Manage subscription" button', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /manage subscription/i })).not.toBeInTheDocument();
  });
});

describe('SubscriptionPage — checkout success banner', () => {
  it('shows a success message when ?checkout=success is in the URL', () => {
    mockProfile = {
      uid: 'uid-1',
      role: 'league_manager',
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'trialing',
      subscriptionExpiresAt: futureDate,
    };
    renderPage('?checkout=success');
    expect(screen.getByText(/you're all set/i)).toBeInTheDocument();
  });

  it('does NOT show the success banner without the query param', () => {
    mockProfile = {
      uid: 'uid-1',
      role: 'league_manager',
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'trialing',
      subscriptionExpiresAt: futureDate,
    };
    renderPage();
    expect(screen.queryByText(/you're all set/i)).not.toBeInTheDocument();
  });
});

describe('SubscriptionPage — manage subscription portal', () => {
  beforeEach(() => {
    mockProfile = {
      uid: 'uid-1',
      role: 'league_manager',
      subscriptionTier: 'league_manager_pro',
      subscriptionStatus: 'active',
      subscriptionExpiresAt: futureDate,
    };
  });

  it('calls the createPortalLink function when "Manage subscription" is clicked', async () => {
    mockCreatePortal.mockResolvedValue({ data: { url: 'https://billing.stripe.com/portal/test' } });

    const assignSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: assignSpy },
      writable: true,
    });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /manage subscription/i }));

    await waitFor(() => {
      expect(mockCreatePortal).toHaveBeenCalledWith(
        expect.objectContaining({ returnUrl: expect.stringContaining('/account/subscription') }),
      );
    });
  });

  it('redirects to the portal URL returned by createPortalLink', async () => {
    const portalUrl = 'https://billing.stripe.com/portal/test-session';
    mockCreatePortal.mockResolvedValue({ data: { url: portalUrl } });

    const assignSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: assignSpy },
      writable: true,
    });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /manage subscription/i }));

    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith(portalUrl);
    });
  });

  it('shows an error message when the portal link fails', async () => {
    mockCreatePortal.mockRejectedValue(new Error('Function call failed'));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /manage subscription/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to open the billing portal/i)).toBeInTheDocument();
    });
  });
});
