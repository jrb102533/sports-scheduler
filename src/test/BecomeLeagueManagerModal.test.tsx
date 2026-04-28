/**
 * BecomeLeagueManagerModal
 *
 * Tests:
 *   1. Renders acknowledgment step by default (not the form)
 *   2. "Get Started" advances to the form step
 *   3. "Cancel" on acknowledgment closes the modal
 *   4. "Cancel" on form step closes the modal entirely (not back to step 1)
 *   5. Calls createLeagueAndBecomeManager CF with the correct payload
 *   6. Calls updateDoc with { activeContext: N } after CF success
 *   7. Navigates to /leagues/:leagueId after success
 *   8. Shows error banner on CF failure
 *   9. Resets to acknowledge step when closed and reopened
 *
 * Strategy: render the modal in a MemoryRouter. Firebase, Firestore, and
 * Firebase Functions are mocked at the module boundary. useAuthStore uses a
 * selector mock that also exposes getState() for the async handler pattern
 * required by CLAUDE.md Zustand rules.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile } from '@/types';

// ─── Hoisted spy references ───────────────────────────────────────────────────
// vi.hoisted() is required because factories inside vi.mock() are hoisted above
// regular variable declarations. The spy references must be in scope inside them.
const { mockCreateLeagueFn, mockUpdateDoc, mockDoc } = vi.hoisted(() => ({
  mockCreateLeagueFn: vi.fn(),
  mockUpdateDoc: vi.fn(),
  mockDoc: vi.fn((_db: unknown, _col: string, _id: string) => ({ path: `users/${_id}` })),
}));

// ─── Firebase stub ────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
}));

// ─── firebase/functions — httpsCallable always returns mockCreateLeagueFn ─────
vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => mockCreateLeagueFn),
}));

// ─── firebase/firestore ───────────────────────────────────────────────────────
vi.mock('firebase/firestore', () => ({
  doc: mockDoc,
  updateDoc: mockUpdateDoc,
}));

// ─── navigate spy ─────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// ─── useAuthStore mock ────────────────────────────────────────────────────────
// The component uses:
//   useAuthStore(s => s.user?.uid)  — selector for render
//   useAuthStore.getState()         — in the async handler
//
// The mock must support both: the hook function acts as a selector-receiving
// function, and carries a .getState() method on the same reference.

const mockUser = { uid: 'uid-test-1' };
const mockProfile: UserProfile = {
  uid: 'uid-test-1',
  email: 'lm@example.com',
  displayName: 'League Manager',
  role: 'league_manager',
  createdAt: '2024-01-01T00:00:00.000Z',
};

vi.mock('@/store/useAuthStore', () => {
  const hook = (selector: (s: { user: typeof mockUser; profile: typeof mockProfile }) => unknown) =>
    selector({ user: mockUser, profile: mockProfile });
  hook.getState = () => ({ user: mockUser, profile: mockProfile });
  return { useAuthStore: hook };
});

// ─── Import component after all mocks ─────────────────────────────────────────
import { BecomeLeagueManagerModal } from '@/components/onboarding/BecomeLeagueManagerModal';

// ─── Render helper ─────────────────────────────────────────────────────────────

interface RenderOptions {
  open?: boolean;
  onClose?: () => void;
}

function renderModal({ open = true, onClose = vi.fn() }: RenderOptions = {}) {
  const result = render(
    <MemoryRouter>
      <BecomeLeagueManagerModal open={open} onClose={onClose} />
    </MemoryRouter>
  );
  return { ...result, onClose };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateLeagueFn.mockResolvedValue({
    data: { leagueId: 'league-abc', newMembershipIndex: 2 },
  });
  mockUpdateDoc.mockResolvedValue(undefined);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BecomeLeagueManagerModal — step 1: acknowledgment', () => {
  it('renders the acknowledgment step by default', () => {
    renderModal();
    expect(screen.getByText(/league manager plan/i)).toBeInTheDocument();
    expect(screen.getByText(/free during beta/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /league name/i })).not.toBeInTheDocument();
  });

  it('"Get Started" advances to the form step', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: /get started/i }));
    expect(await screen.findByRole('textbox', { name: /league name/i })).toBeInTheDocument();
    expect(screen.queryByText(/free during beta/i)).not.toBeInTheDocument();
  });

  it('"Cancel" on acknowledgment step calls onClose', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('BecomeLeagueManagerModal — step 2: form', () => {
  async function advanceToForm(onClose = vi.fn()) {
    renderModal({ onClose });
    await userEvent.click(screen.getByRole('button', { name: /get started/i }));
    await screen.findByRole('textbox', { name: /league name/i });
    return { onClose };
  }

  it('"Cancel" on form step calls onClose (not back to step 1)', async () => {
    const { onClose } = await advanceToForm();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // Acknowledgment step copy should NOT appear
    expect(screen.queryByText(/free during beta/i)).not.toBeInTheDocument();
  });

  it('calls createLeagueAndBecomeManager with correct payload', async () => {
    await advanceToForm();
    await userEvent.type(screen.getByRole('textbox', { name: /league name/i }), 'Premier League');
    await userEvent.type(screen.getByRole('textbox', { name: /season/i }), 'Spring 2026');

    await userEvent.click(screen.getByRole('button', { name: /create league/i }));

    await waitFor(() => {
      expect(mockCreateLeagueFn).toHaveBeenCalledWith({
        name: 'Premier League',
        sportType: undefined,
        season: 'Spring 2026',
        description: undefined,
      });
    });
  });

  it('does not call updateDoc — activeContext is set server-side in the CF', async () => {
    await advanceToForm();
    await userEvent.type(screen.getByRole('textbox', { name: /league name/i }), 'Premier League');
    await userEvent.click(screen.getByRole('button', { name: /create league/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/leagues/league-abc');
    });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('navigates to /leagues/:leagueId after success', async () => {
    await advanceToForm();
    await userEvent.type(screen.getByRole('textbox', { name: /league name/i }), 'Premier League');
    await userEvent.click(screen.getByRole('button', { name: /create league/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/leagues/league-abc');
    });
  });

  it('shows error banner when CF rejects', async () => {
    mockCreateLeagueFn.mockRejectedValueOnce(new Error('Permission denied'));
    await advanceToForm();
    await userEvent.type(screen.getByRole('textbox', { name: /league name/i }), 'Premier League');
    await userEvent.click(screen.getByRole('button', { name: /create league/i }));

    // PaywallAwareError intercepts permission-denied errors for non-Pro users and
    // replaces the raw CF message with an upgrade CTA. Assert on the paywall copy.
    expect(await screen.findByRole('alert')).toHaveTextContent(/league manager pro is required/i);
  });

  it('does not navigate when CF rejects', async () => {
    mockCreateLeagueFn.mockRejectedValueOnce(new Error('Server error'));
    await advanceToForm();
    await userEvent.type(screen.getByRole('textbox', { name: /league name/i }), 'Premier League');
    await userEvent.click(screen.getByRole('button', { name: /create league/i }));

    await screen.findByRole('alert');
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('BecomeLeagueManagerModal — reset on close', () => {
  it('resets to acknowledge step when closed and reopened', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <BecomeLeagueManagerModal open={true} onClose={onClose} />
      </MemoryRouter>
    );

    // Advance to form
    await userEvent.click(screen.getByRole('button', { name: /get started/i }));
    await screen.findByRole('textbox', { name: /league name/i });

    // Close the modal (open=false triggers the reset effect)
    rerender(
      <MemoryRouter>
        <BecomeLeagueManagerModal open={false} onClose={onClose} />
      </MemoryRouter>
    );

    // Reopen
    rerender(
      <MemoryRouter>
        <BecomeLeagueManagerModal open={true} onClose={onClose} />
      </MemoryRouter>
    );

    // Should be back on the acknowledgment step
    expect(screen.getByText(/league manager plan/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /league name/i })).not.toBeInTheDocument();
  });
});
