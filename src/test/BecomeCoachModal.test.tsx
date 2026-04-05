/**
 * BecomeCoachModal
 *
 * Tests:
 *   1. Renders when open=true, null when open=false
 *   2. Shows validation error when name is empty on submit
 *   3. Calls createTeamAndBecomeCoach CF with correct payload on valid submit
 *   4. Calls updateDoc with { activeContext: N } after CF success
 *   5. Navigates to /teams/:teamId after success
 *   6. Shows error banner when CF throws
 *   7. Resets form fields when closed and reopened
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/lib/firebase', () => ({
  auth: {},
  db: {},
  functions: {},
}));

// ─── firebase/functions mock ──────────────────────────────────────────────────

const mockCallableFn = vi.fn();
vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => mockCallableFn),
}));

// ─── firebase/firestore mock ──────────────────────────────────────────────────

const mockUpdateDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, _col: unknown, id: string) => ({ path: `users/${id}` })),
  updateDoc: vi.fn((...args: unknown[]) => mockUpdateDoc(...args)),
}));

// ─── useAuthStore mock ────────────────────────────────────────────────────────

const mockUser = { uid: 'user-123' };

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector?: (s: { user: typeof mockUser }) => unknown) => {
    const state = { user: mockUser };
    if (selector) return selector(state);
    return state;
  },
}));

// Attach getState so the submit handler can call useAuthStore.getState()
import { useAuthStore } from '@/store/useAuthStore';
(useAuthStore as unknown as { getState: () => { user: typeof mockUser } }).getState = () => ({
  user: mockUser,
});

// ─── Component under test ─────────────────────────────────────────────────────

import { BecomeCoachModal } from '@/components/onboarding/BecomeCoachModal';
import { TEAM_COLORS } from '@/constants';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderModal(open = true, onClose = vi.fn()) {
  return { onClose, ...render(
    <MemoryRouter>
      <BecomeCoachModal open={open} onClose={onClose} />
    </MemoryRouter>
  )};
}

function fillName(value: string) {
  fireEvent.change(screen.getByLabelText(/team name/i), { target: { value } });
}

async function submitForm() {
  fireEvent.click(screen.getByRole('button', { name: /create team/i }));
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateDoc.mockResolvedValue(undefined);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BecomeCoachModal — visibility', () => {
  it('renders the modal when open=true', () => {
    renderModal(true);
    expect(screen.getByText('Create a Team')).toBeInTheDocument();
  });

  it('renders nothing when open=false', () => {
    renderModal(false);
    expect(screen.queryByText('Create a Team')).not.toBeInTheDocument();
  });
});

describe('BecomeCoachModal — validation', () => {
  it('shows a validation error when name is empty on submit', async () => {
    renderModal();
    await submitForm();
    await waitFor(() => {
      expect(screen.getByText(/team name is required/i)).toBeInTheDocument();
    });
    expect(mockCallableFn).not.toHaveBeenCalled();
  });
});

describe('BecomeCoachModal — successful submit', () => {
  const cfResult = { data: { teamId: 'team-abc', newMembershipIndex: 2 } };

  beforeEach(() => {
    mockCallableFn.mockResolvedValue(cfResult);
  });

  it('calls createTeamAndBecomeCoach with correct payload', async () => {
    renderModal();
    fillName('Thunder Hawks');
    await submitForm();

    await waitFor(() => {
      expect(mockCallableFn).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Thunder Hawks',
          sportType: 'soccer',
          color: TEAM_COLORS[0],
        })
      );
    });
  });

  it('trims whitespace from the name before sending', async () => {
    renderModal();
    fillName('  Thunder Hawks  ');
    await submitForm();

    await waitFor(() => {
      expect(mockCallableFn).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Thunder Hawks' })
      );
    });
  });

  it('does not call updateDoc — activeContext is set server-side in the CF', async () => {
    renderModal();
    fillName('Thunder Hawks');
    await submitForm();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/teams/team-abc');
    });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('navigates to /teams/:teamId after success', async () => {
    renderModal();
    fillName('Thunder Hawks');
    await submitForm();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/teams/team-abc');
    });
  });

  it('calls onClose after success', async () => {
    const { onClose } = renderModal();
    fillName('Thunder Hawks');
    await submitForm();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });
});

describe('BecomeCoachModal — error handling', () => {
  it('shows the error banner when the CF throws', async () => {
    mockCallableFn.mockRejectedValue(new Error('Permission denied'));

    renderModal();
    fillName('Thunder Hawks');
    await submitForm();

    await waitFor(() => {
      expect(screen.getByText(/permission denied/i)).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not navigate when the CF throws', async () => {
    mockCallableFn.mockRejectedValue(new Error('Internal error'));

    renderModal();
    fillName('Thunder Hawks');
    await submitForm();

    await waitFor(() => {
      expect(screen.getByText(/internal error/i)).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('BecomeCoachModal — reset on close/reopen', () => {
  it('resets form fields when closed and reopened', async () => {
    const { rerender, onClose } = renderModal();

    fillName('Thunder Hawks');
    expect(screen.getByLabelText(/team name/i)).toHaveValue('Thunder Hawks');

    // Close the modal
    rerender(
      <MemoryRouter>
        <BecomeCoachModal open={false} onClose={onClose} />
      </MemoryRouter>
    );

    // Reopen the modal
    rerender(
      <MemoryRouter>
        <BecomeCoachModal open={true} onClose={onClose} />
      </MemoryRouter>
    );

    expect(screen.getByLabelText(/team name/i)).toHaveValue('');
  });

  it('clears the error banner when closed and reopened', async () => {
    mockCallableFn.mockRejectedValue(new Error('Something went wrong'));

    const { rerender, onClose } = renderModal();
    fillName('Thunder Hawks');
    await submitForm();

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });

    rerender(
      <MemoryRouter>
        <BecomeCoachModal open={false} onClose={onClose} />
      </MemoryRouter>
    );
    rerender(
      <MemoryRouter>
        <BecomeCoachModal open={true} onClose={onClose} />
      </MemoryRouter>
    );

    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });
});
