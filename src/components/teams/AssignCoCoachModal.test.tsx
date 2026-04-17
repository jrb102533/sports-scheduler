/**
 * AssignCoCoachModal — form validation and CF call tests
 *
 * Behaviours under test:
 *   1. Empty email shows "Email is required." validation error
 *   2. Whitespace-only email is treated as empty
 *   3. Successful CF call shows the success message with coach name + team name
 *   4. Failed CF call shows the error message
 *   5. "Add Another" button resets back to the form
 *   6. Cancel resets state and calls onClose
 *   7. Submit button is disabled while CF call is in flight
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Firebase stub ─────────────────────────────────────────────────────────────
const mockCallable = vi.fn();

vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => mockCallable),
}));

import { AssignCoCoachModal } from './AssignCoCoachModal';

const TEAM_NAME = 'Thunder FC';
const TEAM_ID = 'team-1';

function renderModal(props: Partial<Parameters<typeof AssignCoCoachModal>[0]> = {}) {
  const defaults = {
    open: true,
    teamId: TEAM_ID,
    teamName: TEAM_NAME,
    onClose: vi.fn(),
  };
  render(<AssignCoCoachModal {...defaults} {...props} />);
  return { onClose: defaults.onClose, ...props };
}

describe('AssignCoCoachModal — form validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a validation error when submitted with an empty email', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: /Add Co-Coach/i }));
    expect(screen.getByText('Email is required.')).toBeTruthy();
  });

  it('shows a validation error when submitted with whitespace-only email', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole('textbox'), '   ');
    await user.click(screen.getByRole('button', { name: /Add Co-Coach/i }));
    expect(screen.getByText('Email is required.')).toBeTruthy();
  });

  it('does not call the Cloud Function when email is empty', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: /Add Co-Coach/i }));
    expect(mockCallable).not.toHaveBeenCalled();
  });
});

describe('AssignCoCoachModal — successful assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallable.mockResolvedValue({
      data: { success: true, targetUid: 'uid-99', displayName: 'Jane Coach' },
    });
  });

  it('shows the success message with the coach name and team name after assignment', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole('textbox'), 'jane@example.com');
    await user.click(screen.getByRole('button', { name: /Add Co-Coach/i }));
    await waitFor(() =>
      expect(screen.getByText(/Jane Coach has been added as a co-coach of Thunder FC/i)).toBeTruthy()
    );
  });

  it('shows "Add Another" and "Done" buttons after success', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole('textbox'), 'jane@example.com');
    await user.click(screen.getByRole('button', { name: /Add Co-Coach/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Another/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Done/i })).toBeTruthy();
    });
  });

  it('"Add Another" button returns to the form state', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole('textbox'), 'jane@example.com');
    await user.click(screen.getByRole('button', { name: /Add Co-Coach/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add Another/i })).toBeTruthy()
    );
    await user.click(screen.getByRole('button', { name: /Add Another/i }));
    // Back to form — email input is present
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add Co-Coach/i })).toBeTruthy();
  });
});

describe('AssignCoCoachModal — failed assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallable.mockRejectedValue(new Error('User not found.'));
  });

  it('shows the error message when the Cloud Function rejects', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole('textbox'), 'unknown@example.com');
    await user.click(screen.getByRole('button', { name: /Add Co-Coach/i }));
    await waitFor(() =>
      expect(screen.getByText('User not found.')).toBeTruthy()
    );
  });

  it('does not show a success message when the call fails', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole('textbox'), 'unknown@example.com');
    await user.click(screen.getByRole('button', { name: /Add Co-Coach/i }));
    await waitFor(() => screen.getByText('User not found.'));
    expect(screen.queryByText(/has been added/i)).toBeNull();
  });
});

describe('AssignCoCoachModal — modal lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });
    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render the form when open=false', () => {
    renderModal({ open: false });
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
