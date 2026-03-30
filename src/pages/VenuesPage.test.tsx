import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Hoisted mock functions ────────────────────────────────────────────────────
// vi.mock factories are hoisted to the top of the file by Vitest BEFORE module
// variables are initialised.  Using vi.hoisted() ensures these vi.fn() instances
// are created in the hoisted scope and are therefore accessible inside both the
// mock factory closures AND the test bodies.

const { mockAddVenue, mockUpdateVenue, mockSoftDeleteVenue, mockSubscribe } =
  vi.hoisted(() => ({
    mockAddVenue: vi.fn(),
    mockUpdateVenue: vi.fn(),
    mockSoftDeleteVenue: vi.fn(),
    mockSubscribe: vi.fn(() => () => {}),
  }));

// ── Mock firebase/firestore (required by useVenueStore import chain) ───────────

vi.mock('firebase/firestore', () => ({
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  doc: vi.fn(() => ({})),
  collection: vi.fn(() => ({})),
  orderBy: vi.fn(),
  query: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

// ── Mock stores ───────────────────────────────────────────────────────────────

// useVenueStore() is called with NO selector in VenuesPage — it destructures
// the whole store.  The mock must support both the no-arg and selector shapes.
vi.mock('@/store/useVenueStore', () => ({
  useVenueStore: (selector?: (s: unknown) => unknown) => {
    const slice = {
      venues: [],
      loading: false,
      addVenue: mockAddVenue,
      updateVenue: mockUpdateVenue,
      softDeleteVenue: mockSoftDeleteVenue,
      subscribe: mockSubscribe,
    };
    return selector ? selector(slice) : slice;
  },
}));

// useAuthStore is called with a selector: useAuthStore(s => s.user)
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: { user: { uid: string } }) => unknown) =>
    selector({ user: { uid: 'user-123' } }),
}));

// ── Import component after mocks ───────────────────────────────────────────────

import { VenuesPage } from './VenuesPage';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Opens the "New Venue" modal and fills in the minimum required fields
 * (Name and Address) so the form will pass validation.
 *
 * When venues is empty the page renders TWO "New Venue" buttons — one in the
 * header bar and one in the EmptyState.  Either one opens the same modal, so
 * we just grab the first match.
 */
async function openModalWithValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: /new venue/i })[0]);
  await user.type(screen.getByLabelText(/^name$/i), 'Test Ground');
  await user.type(screen.getByLabelText(/^address$/i), '1 Stadium Road');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VenueFormModal — save error display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribe.mockReturnValue(() => {});
  });

  it('translates "Not authenticated" to a friendly sign-in message', async () => {
    // The store throws 'Not authenticated' when no UID is present.
    // The catch block maps this to a human-readable message.
    const user = userEvent.setup();
    mockAddVenue.mockRejectedValue(new Error('Not authenticated'));

    render(<VenuesPage />);
    await openModalWithValidForm(user);
    await user.click(screen.getByRole('button', { name: /create venue/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/you are not signed in/i),
      ).toBeInTheDocument();
    });
  });

  it('translates "Missing or insufficient permissions" to a human-readable message', async () => {
    const user = userEvent.setup();
    mockAddVenue.mockRejectedValue(
      new Error('Missing or insufficient permissions'),
    );

    render(<VenuesPage />);
    await openModalWithValidForm(user);
    await user.click(screen.getByRole('button', { name: /create venue/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/permission denied.*role may not allow this action/i),
      ).toBeInTheDocument();
    });
  });

  it('does not expose the raw Firestore permission string to the user', async () => {
    const user = userEvent.setup();
    mockAddVenue.mockRejectedValue(
      new Error('Missing or insufficient permissions'),
    );

    render(<VenuesPage />);
    await openModalWithValidForm(user);
    await user.click(screen.getByRole('button', { name: /create venue/i }));

    await waitFor(() => {
      expect(
        screen.queryByText(/missing or insufficient permissions/i),
      ).not.toBeInTheDocument();
    });
  });

  it('shows a generic fallback message for unknown errors', async () => {
    // Unknown errors show "Save failed: <message>" so the user can see the cause.
    const user = userEvent.setup();
    mockAddVenue.mockRejectedValue(new Error('Network request failed'));

    render(<VenuesPage />);
    await openModalWithValidForm(user);
    await user.click(screen.getByRole('button', { name: /create venue/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/save failed: network request failed/i),
      ).toBeInTheDocument();
    });
  });

  it('shows a generic fallback when the thrown value has no message property', async () => {
    const user = userEvent.setup();
    // Throw a non-Error object so .message is undefined — falls back to String(e)
    mockAddVenue.mockRejectedValue({});

    render(<VenuesPage />);
    await openModalWithValidForm(user);
    await user.click(screen.getByRole('button', { name: /create venue/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/save failed:/i),
      ).toBeInTheDocument();
    });
  });

  it('shows no error message before any save attempt', () => {
    render(<VenuesPage />);
    expect(screen.queryByText(/you are not signed in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/permission denied/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/save failed/i)).not.toBeInTheDocument();
  });

  it('shows no error message after a successful save', async () => {
    const user = userEvent.setup();
    mockAddVenue.mockResolvedValue(undefined);

    render(<VenuesPage />);
    await openModalWithValidForm(user);
    await user.click(screen.getByRole('button', { name: /create venue/i }));

    // Modal closes on success — error paragraph should not be in the DOM
    await waitFor(() => {
      expect(screen.queryByText(/save failed/i)).not.toBeInTheDocument();
    });
  });
});

describe('VenueFormModal — modal open/close behaviour on save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribe.mockReturnValue(() => {});
  });

  it('keeps the modal open when the save throws', async () => {
    const user = userEvent.setup();
    mockAddVenue.mockRejectedValue(new Error('Not authenticated'));

    render(<VenuesPage />);
    await openModalWithValidForm(user);
    await user.click(screen.getByRole('button', { name: /create venue/i }));

    await waitFor(() => {
      // Modal title heading is still present
      expect(screen.getByRole('heading', { name: 'New Venue' })).toBeInTheDocument();
    });
  });

  it('closes the modal after a successful save', async () => {
    const user = userEvent.setup();
    mockAddVenue.mockResolvedValue(undefined);

    render(<VenuesPage />);
    await openModalWithValidForm(user);
    await user.click(screen.getByRole('button', { name: /create venue/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'New Venue' }),
      ).not.toBeInTheDocument();
    });
  });
});

describe('VenueFormModal — error cleared on modal reopen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribe.mockReturnValue(() => {});
  });

  it('clears a previous save error when the modal is reopened', async () => {
    const user = userEvent.setup();
    mockAddVenue.mockRejectedValue(new Error('Not authenticated'));

    render(<VenuesPage />);
    await openModalWithValidForm(user);
    await user.click(screen.getByRole('button', { name: /create venue/i }));

    await waitFor(() => {
      expect(screen.getByText(/you are not signed in/i)).toBeInTheDocument();
    });

    // Close the modal via the Cancel button
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    // Reopen the modal
    await user.click(screen.getAllByRole('button', { name: /new venue/i })[0]);

    // Error should not carry over to the fresh modal session
    expect(screen.queryByText(/you are not signed in/i)).not.toBeInTheDocument();
  });
});

describe('VenueFormModal — error cleared at start of a new save attempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribe.mockReturnValue(() => {});
  });

  it('clears a previous error before the next save attempt begins', async () => {
    const user = userEvent.setup();
    // First call fails, second succeeds
    mockAddVenue
      .mockRejectedValueOnce(new Error('Not authenticated'))
      .mockResolvedValueOnce(undefined);

    render(<VenuesPage />);
    await openModalWithValidForm(user);

    // First save — fails
    await user.click(screen.getByRole('button', { name: /create venue/i }));
    await waitFor(() => {
      expect(screen.getByText(/you are not signed in/i)).toBeInTheDocument();
    });

    // Second save — succeeds; error clears at the start of the new attempt
    // (setSaveError('') is called before the await in handleSubmit)
    await user.click(screen.getByRole('button', { name: /create venue/i }));

    // After success the modal closes; error is gone
    await waitFor(() => {
      expect(screen.queryByText(/you are not signed in/i)).not.toBeInTheDocument();
    });
  });
});

describe('VenueFormModal — saving spinner / button state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribe.mockReturnValue(() => {});
  });

  it('disables the submit button while saving is in progress', async () => {
    const user = userEvent.setup();
    // Never resolves during the test — keeps the component in the saving state
    mockAddVenue.mockReturnValue(new Promise(() => {}));

    render(<VenuesPage />);
    await openModalWithValidForm(user);

    // Start the submission but don't await it completing
    // We need to kick off the submit and immediately check state before it resolves
    const submitButton = screen.getByRole('button', { name: /create venue/i });

    // Dispatch click without waiting for the full async chain via fireEvent
    // so we can observe the intermediate saving state
    submitButton.click();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /saving/i }),
      ).toBeDisabled();
    });
  });

  it('re-enables the submit button after a failed save', async () => {
    const user = userEvent.setup();
    mockAddVenue.mockRejectedValue(new Error('Not authenticated'));

    render(<VenuesPage />);
    await openModalWithValidForm(user);
    await user.click(screen.getByRole('button', { name: /create venue/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /create venue/i }),
      ).not.toBeDisabled();
    });
  });
});

describe('VenueFormModal — form validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribe.mockReturnValue(() => {});
  });

  it('does not call the store when the name field is empty', async () => {
    const user = userEvent.setup();

    render(<VenuesPage />);
    await user.click(screen.getAllByRole('button', { name: /new venue/i })[0]);
    // Fill address only — leave name blank
    await user.type(screen.getByLabelText(/^address$/i), '1 Stadium Road');
    await user.click(screen.getByRole('button', { name: /create venue/i }));

    expect(mockAddVenue).not.toHaveBeenCalled();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });

  it('does not call the store when the address field is empty', async () => {
    const user = userEvent.setup();

    render(<VenuesPage />);
    await user.click(screen.getAllByRole('button', { name: /new venue/i })[0]);
    // Fill name only — leave address blank
    await user.type(screen.getByLabelText(/^name$/i), 'Test Ground');
    await user.click(screen.getByRole('button', { name: /create venue/i }));

    expect(mockAddVenue).not.toHaveBeenCalled();
    expect(screen.getByText(/address is required/i)).toBeInTheDocument();
  });
});
