/**
 * PaywallAwareError — unit tests
 *
 * Behaviors:
 *   - Renders nothing when error is null/empty
 *   - Renders generic red banner for non-permission errors
 *   - Renders upgrade CTA banner for permission-denied errors when user is NOT Pro
 *   - Renders generic banner for permission-denied errors when user IS Pro
 *     (avoids confusing message in cases where the rules denial is a real bug)
 *   - Upgrade button navigates to /upgrade
 *   - Custom action prop appears in the prompt
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PaywallAwareError } from '@/components/subscription/PaywallAwareError';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

let mockIsPro = false;
vi.mock('@/hooks/useIsPro', () => ({ useIsPro: () => mockIsPro }));

function renderWithRouter(ui: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PaywallAwareError', () => {
  beforeEach(() => {
    mockIsPro = false;
    mockNavigate.mockReset();
  });

  it('renders nothing when error is null', () => {
    const { container } = renderWithRouter(<PaywallAwareError error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when error is empty string', () => {
    const { container } = renderWithRouter(<PaywallAwareError error="" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders generic red banner for a non-permission error', () => {
    renderWithRouter(<PaywallAwareError error="Network timeout" />);
    expect(screen.getByText('Network timeout')).toBeInTheDocument();
    expect(screen.queryByText(/upgrade/i)).not.toBeInTheDocument();
  });

  it('renders upgrade CTA for "Missing or insufficient permissions" when user is not Pro', () => {
    renderWithRouter(<PaywallAwareError error="FirebaseError: Missing or insufficient permissions." />);
    expect(screen.getByText(/league manager pro is required/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upgrade to pro/i })).toBeInTheDocument();
  });

  it('renders upgrade CTA for "permission-denied" code when user is not Pro', () => {
    renderWithRouter(<PaywallAwareError error="FirebaseError [permission-denied]: Forbidden" />);
    expect(screen.getByText(/league manager pro is required/i)).toBeInTheDocument();
  });

  it('renders upgrade CTA for explicit Pro-required CF message', () => {
    renderWithRouter(<PaywallAwareError error="This feature requires a League Manager Pro subscription." />);
    expect(screen.getByText(/league manager pro is required/i)).toBeInTheDocument();
  });

  it('uses the custom action label in the upgrade prompt', () => {
    renderWithRouter(<PaywallAwareError error="permission-denied" action="edit a league" />);
    expect(screen.getByText(/league manager pro is required to edit a league/i)).toBeInTheDocument();
  });

  it('falls back to generic banner for permission errors when user IS Pro (likely a real bug, not paywall)', () => {
    mockIsPro = true;
    renderWithRouter(<PaywallAwareError error="Missing or insufficient permissions" />);
    expect(screen.getByText('Missing or insufficient permissions')).toBeInTheDocument();
    expect(screen.queryByText(/upgrade/i)).not.toBeInTheDocument();
  });

  it('upgrade button navigates to /upgrade', () => {
    renderWithRouter(<PaywallAwareError error="permission-denied" />);
    fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/upgrade');
  });
});
