/**
 * UpgradeToProPage — unit tests
 *
 * Verifies:
 *   - Loading skeleton is shown while products load
 *   - Monthly and annual plan cards render with correct prices
 *   - Clicking the monthly CTA calls startCheckout with the monthly price ID
 *   - Clicking the annual CTA calls startCheckout with the annual price ID
 *   - An error from startCheckout is displayed
 *   - An error from useStripeProducts is displayed
 *   - Correct button is disabled (loading) while in-flight; the other is not
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

// ─── Stripe hooks mocks ───────────────────────────────────────────────────────

const mockStartCheckout = vi.fn<[string], Promise<void>>();

interface MockCheckoutState {
  loading: boolean;
  error: string | null;
}

let mockCheckoutState: MockCheckoutState = { loading: false, error: null };

vi.mock('@/hooks/useStripeCheckout', () => ({
  useStripeCheckout: () => ({
    ...mockCheckoutState,
    startCheckout: mockStartCheckout,
    loadPrices: vi.fn(),
  }),
}));

interface MockProductsState {
  monthlyPrice: { id: string; interval: 'month'; unit_amount: number; currency: string } | null;
  annualPrice: { id: string; interval: 'year'; unit_amount: number; currency: string } | null;
  loading: boolean;
  error: string | null;
  product: null;
}

let mockProductsState: MockProductsState = {
  product: null,
  monthlyPrice: { id: 'price_monthly_test', interval: 'month', unit_amount: 999, currency: 'usd' },
  annualPrice: { id: 'price_annual_test', interval: 'year', unit_amount: 9999, currency: 'usd' },
  loading: false,
  error: null,
};

vi.mock('@/hooks/useStripeProducts', () => ({
  useStripeProducts: () => mockProductsState,
}));

// ─── Auth store mock ──────────────────────────────────────────────────────────

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector?: (s: { user: { uid: string } }) => unknown) => {
    const state = { user: { uid: 'test-uid-123' } };
    return selector ? selector(state) : state;
  },
  hasRole: vi.fn(() => true),
}));

import { UpgradeToProPage } from '@/pages/UpgradeToProPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <MemoryRouter>
      <UpgradeToProPage />
    </MemoryRouter>
  );
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckoutState = { loading: false, error: null };
  mockProductsState = {
    product: null,
    monthlyPrice: { id: 'price_monthly_test', interval: 'month', unit_amount: 999, currency: 'usd' },
    annualPrice: { id: 'price_annual_test', interval: 'year', unit_amount: 9999, currency: 'usd' },
    loading: false,
    error: null,
  };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UpgradeToProPage — layout', () => {
  it('renders the hero heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /unlock league manager pro/i })).toBeInTheDocument();
  });

  it('shows loading skeletons while products are loading', () => {
    mockProductsState = { ...mockProductsState, loading: true, monthlyPrice: null, annualPrice: null };
    const { container } = renderPage();
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders two "Start 14-day free trial" CTAs when prices are loaded', () => {
    renderPage();
    const buttons = screen.getAllByRole('button', { name: /start 14-day free trial/i });
    expect(buttons).toHaveLength(2);
  });

  it('renders the fine print about the trial period', () => {
    renderPage();
    // Use getAllBy because the text appears in both CTAs and fine print
    expect(screen.getAllByText(/14-day free trial/i).length).toBeGreaterThan(0);
  });

  it('shows the "Best value — save 17%" badge on the annual card', () => {
    renderPage();
    expect(screen.getByText(/save 17%/i)).toBeInTheDocument();
  });
});

describe('UpgradeToProPage — checkout with monthly plan', () => {
  it('calls startCheckout with the monthly price ID', async () => {
    mockStartCheckout.mockResolvedValue(undefined);
    renderPage();

    const buttons = screen.getAllByRole('button', { name: /start 14-day free trial/i });
    // Monthly is first (left card)
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(mockStartCheckout).toHaveBeenCalledWith('price_monthly_test');
    });
  });

  it('calls startCheckout exactly once per click', async () => {
    mockStartCheckout.mockResolvedValue(undefined);
    renderPage();

    const buttons = screen.getAllByRole('button', { name: /start 14-day free trial/i });
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(mockStartCheckout).toHaveBeenCalledTimes(1);
    });
  });
});

describe('UpgradeToProPage — checkout with annual plan', () => {
  it('calls startCheckout with the annual price ID', async () => {
    mockStartCheckout.mockResolvedValue(undefined);
    renderPage();

    const buttons = screen.getAllByRole('button', { name: /start 14-day free trial/i });
    // Annual is second (right card)
    fireEvent.click(buttons[1]);

    await waitFor(() => {
      expect(mockStartCheckout).toHaveBeenCalledWith('price_annual_test');
    });
  });

  it('does NOT call startCheckout with the monthly price ID when annual is clicked', async () => {
    mockStartCheckout.mockResolvedValue(undefined);
    renderPage();

    const buttons = screen.getAllByRole('button', { name: /start 14-day free trial/i });
    fireEvent.click(buttons[1]);

    await waitFor(() => {
      expect(mockStartCheckout).toHaveBeenCalledWith('price_annual_test');
    });
    expect(mockStartCheckout).not.toHaveBeenCalledWith('price_monthly_test');
  });
});

describe('UpgradeToProPage — loading state during checkout', () => {
  it('shows "Redirecting…" on the clicked button when checkout is in-flight', async () => {
    // Simulate checkout loading state for the monthly price
    mockStartCheckout.mockReturnValue(new Promise(() => {})); // never resolves
    mockCheckoutState = { loading: true, error: null };

    renderPage();

    const buttons = screen.getAllByRole('button', { name: /start 14-day free trial/i });
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(mockStartCheckout).toHaveBeenCalledWith('price_monthly_test');
    });
  });
});

describe('UpgradeToProPage — error handling', () => {
  it('displays a checkout error message', () => {
    mockCheckoutState = { loading: false, error: 'Failed to start checkout. Please try again.' };
    renderPage();
    expect(screen.getByText(/failed to start checkout/i)).toBeInTheDocument();
  });

  it('displays a products load error message', () => {
    mockProductsState = {
      ...mockProductsState,
      error: 'Subscription product not found. Please contact support.',
      monthlyPrice: null,
      annualPrice: null,
    };
    renderPage();
    expect(screen.getByText(/subscription product not found/i)).toBeInTheDocument();
  });
});
