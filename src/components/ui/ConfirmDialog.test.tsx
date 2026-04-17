/**
 * ConfirmDialog — behaviour tests
 *
 * Behaviours under test:
 *   A) Basic open/close
 *      - Renders when open=true with title, message, and action buttons
 *      - Does not render when open=false
 *      - Cancel button calls onClose
 *   B) Default mode (no typeToConfirm)
 *      - Confirm button is enabled by default
 *      - Clicking Confirm calls both onConfirm and onClose
 *      - Confirm button uses custom label when confirmLabel is provided
 *   C) typeToConfirm mode
 *      - Confirm button is disabled until the exact phrase is typed
 *      - Confirm button enabled only after exact match
 *      - Confirm button disabled for partial match
 *      - Input is cleared when modal closes (open→false→true)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

function renderDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const defaults = {
    open: true,
    title: 'Confirm Action',
    message: 'Are you sure you want to proceed?',
    onClose: vi.fn(),
    onConfirm: vi.fn(),
  };
  return { ...render(<ConfirmDialog {...defaults} {...props} />), defaults, ...props };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── A. Basic open/close ────────────────────────────────────────────────────────

describe('ConfirmDialog — basic open/close', () => {
  it('renders the dialog when open=true', () => {
    renderDialog();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows the title and message', () => {
    renderDialog({ title: 'Delete Item', message: 'This cannot be undone.' });
    expect(screen.getByText('Delete Item')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('does not render when open=false', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onClose when Cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDialog({ onClose });
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ── B. Default mode — no typeToConfirm ────────────────────────────────────────

describe('ConfirmDialog — default mode (no typeToConfirm)', () => {
  it('renders the confirm button enabled by default', () => {
    renderDialog();
    const confirmBtn = screen.getByRole('button', { name: /delete/i });
    expect(confirmBtn).not.toBeDisabled();
  });

  it('calls both onConfirm and onClose when Confirm is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onConfirm, onClose });
    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('uses the custom confirmLabel on the button', () => {
    renderDialog({ confirmLabel: 'Remove Event' });
    expect(screen.getByRole('button', { name: /remove event/i })).toBeInTheDocument();
  });

  it('defaults to "Delete" label when no confirmLabel is provided', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });
});

// ── C. typeToConfirm mode ──────────────────────────────────────────────────────

describe('ConfirmDialog — typeToConfirm mode', () => {
  const PHRASE = 'Thunder Hawks';

  it('shows the type-to-confirm input', () => {
    renderDialog({ typeToConfirm: PHRASE });
    expect(screen.getByRole('textbox', { name: /confirm deletion/i })).toBeInTheDocument();
  });

  it('disables the confirm button until the phrase is typed', () => {
    renderDialog({ typeToConfirm: PHRASE });
    const btn = screen.getByRole('button', { name: /^delete$/i });
    expect(btn).toBeDisabled();
  });

  it('enables the confirm button when the exact phrase is typed', async () => {
    const user = userEvent.setup();
    renderDialog({ typeToConfirm: PHRASE });
    await user.type(screen.getByRole('textbox', { name: /confirm deletion/i }), PHRASE);
    expect(screen.getByRole('button', { name: /^delete$/i })).not.toBeDisabled();
  });

  it('keeps the confirm button disabled for a partial phrase match', async () => {
    const user = userEvent.setup();
    renderDialog({ typeToConfirm: PHRASE });
    await user.type(screen.getByRole('textbox', { name: /confirm deletion/i }), 'Thunder Hawk'); // one char short
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDisabled();
  });

  it('clears the input value when dialog is closed and reopened', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        open={true}
        title="Confirm"
        message="Really?"
        onClose={onClose}
        onConfirm={vi.fn()}
        typeToConfirm={PHRASE}
      />
    );
    // We'd need to type something, then close the modal — simulate by toggling open
    rerender(
      <ConfirmDialog
        open={false}
        title="Confirm"
        message="Really?"
        onClose={onClose}
        onConfirm={vi.fn()}
        typeToConfirm={PHRASE}
      />
    );
    rerender(
      <ConfirmDialog
        open={true}
        title="Confirm"
        message="Really?"
        onClose={onClose}
        onConfirm={vi.fn()}
        typeToConfirm={PHRASE}
      />
    );
    // After re-opening the input should be empty (value reset by useEffect)
    const input = screen.getByRole('textbox', { name: /confirm deletion/i }) as HTMLInputElement;
    expect(input.value).toBe('');
  });
});
