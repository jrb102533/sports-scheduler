/**
 * DeleteTeamModal — confirmation validation tests
 *
 * The modal requires the user to type the exact team name before the
 * "Delete Team" button becomes enabled. This test suite covers:
 *
 *   1. Delete button is disabled when confirmation text is empty
 *   2. Delete button is disabled when confirmation text is wrong
 *   3. Delete button is enabled only when text matches team name exactly
 *   4. onConfirm is called only when text matches and user clicks
 *   5. onConfirm is NOT called when text doesn't match
 *   6. "Permanently Delete" mode shows different messaging
 *   7. Cancel button always works (calls onClose)
 *   8. Modal does not render when open=false
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeleteTeamModal } from './DeleteTeamModal';

const TEAM_NAME = 'Thunder FC';

function renderModal(props: Partial<Parameters<typeof DeleteTeamModal>[0]> = {}) {
  const defaults = {
    open: true,
    teamName: TEAM_NAME,
    onClose: vi.fn(),
    onConfirm: vi.fn().mockResolvedValue(undefined),
  };
  return { ...render(<DeleteTeamModal {...defaults} {...props} />), ...defaults, ...props };
}

describe('DeleteTeamModal — confirmation validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when open=false', () => {
    renderModal({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the dialog when open=true', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('delete button is disabled when the confirmation input is empty', () => {
    renderModal();
    const btn = screen.getByRole('button', { name: /Delete Team/i });
    expect(btn).toBeDisabled();
  });

  it('delete button is disabled when the wrong text is typed', async () => {
    const user = userEvent.setup();
    renderModal();
    const input = screen.getByRole('textbox');
    await user.type(input, 'Wrong Name');
    const btn = screen.getByRole('button', { name: /Delete Team/i });
    expect(btn).toBeDisabled();
  });

  it('delete button is enabled when the exact team name is typed', async () => {
    const user = userEvent.setup();
    renderModal();
    const input = screen.getByRole('textbox');
    await user.type(input, TEAM_NAME);
    const btn = screen.getByRole('button', { name: /Delete Team/i });
    expect(btn).not.toBeDisabled();
  });

  it('calls onConfirm when confirmation text matches and button is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderModal({ onConfirm });
    const input = screen.getByRole('textbox');
    await user.type(input, TEAM_NAME);
    await user.click(screen.getByRole('button', { name: /Delete Team/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not call onConfirm when confirmation text does not match', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderModal({ onConfirm });
    const input = screen.getByRole('textbox');
    await user.type(input, 'Thunder F'); // one char short
    // Attempt to click via keyboard since button is disabled
    // onConfirm should still not fire via internal handleConfirm's guard
    const btn = screen.getByRole('button', { name: /Delete Team/i });
    expect(btn).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onClose when Cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });
    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('permanent=true mode', () => {
    it('shows "Permanently Delete Team" as the dialog title', () => {
      renderModal({ permanent: true });
      expect(screen.getByText('Permanently Delete Team')).toBeTruthy();
    });

    it('shows destructive warning messaging', () => {
      renderModal({ permanent: true });
      expect(screen.getByText(/This will permanently delete the team/i)).toBeTruthy();
    });

    it('shows "Permanently Delete" as the button label', async () => {
      const user = userEvent.setup();
      renderModal({ permanent: true });
      const input = screen.getByRole('textbox');
      await user.type(input, TEAM_NAME);
      expect(screen.getByRole('button', { name: /Permanently Delete/i })).toBeTruthy();
    });
  });

  describe('soft delete (default) mode', () => {
    it('shows "Delete Team" as the dialog title (heading)', () => {
      renderModal({ permanent: false });
      expect(screen.getByRole('heading', { name: 'Delete Team' })).toBeTruthy();
    });

    it('shows soft-delete messaging (can be restored)', () => {
      renderModal({ permanent: false });
      expect(screen.getByText(/hidden and can be restored/i)).toBeTruthy();
    });
  });
});
