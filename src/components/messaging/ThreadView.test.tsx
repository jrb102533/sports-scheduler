/**
 * ThreadView — unit tests
 *
 * Covers:
 *   1. Empty state message when messages array is empty
 *   2. Loading spinner/text when loading=true (hides messages)
 *   3. Sender's message rendered with right-aligned bubble (flex-row-reverse)
 *   4. Recipient's message rendered with left-aligned bubble (flex-row)
 *   5. Recipient name label visible for other-side messages; hidden for own
 *   6. Message text rendered correctly
 *   7. Send button disabled when textarea is empty
 *   8. onSend called with trimmed text when form is submitted
 *   9. Textarea cleared after successful send
 *  10. Send error message displayed when onSend rejects
 *  11. Send button disabled while a send is in flight
 *  12. Enter key (no shift) submits the form
 *  13. Shift+Enter does NOT submit the form
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThreadView } from './ThreadView';
import type { TeamMessage } from '@/types';

// ThreadView imports lucide-react's Send icon — mock lucide-react to avoid
// SVG rendering issues in jsdom.
vi.mock('lucide-react', () => ({
  Send: () => <span data-testid="send-icon" />,
}));

// jsdom does not implement scrollIntoView; stub it so the auto-scroll useEffect
// does not throw.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MY_UID = 'user-me';
const OTHER_UID = 'user-other';

function makeMsg(overrides: Partial<TeamMessage> = {}): TeamMessage {
  return {
    id: 'msg-1',
    teamId: 'team-1',
    senderId: MY_UID,
    senderName: 'Me',
    text: 'Hello world',
    createdAt: new Date('2024-01-01T10:00:00Z').toISOString(),
    ...overrides,
  };
}

const noop = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Empty / loading states ────────────────────────────────────────────────────

describe('ThreadView — empty and loading states', () => {
  it('shows empty state text when there are no messages', () => {
    render(<ThreadView messages={[]} loading={false} currentUid={MY_UID} onSend={noop} />);
    expect(screen.getByText('No messages yet. Say hello!')).toBeInTheDocument();
  });

  it('shows loading text when loading is true', () => {
    render(<ThreadView messages={[]} loading={true} currentUid={MY_UID} onSend={noop} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('does not show empty-state text while loading', () => {
    render(<ThreadView messages={[]} loading={true} currentUid={MY_UID} onSend={noop} />);
    expect(screen.queryByText('No messages yet. Say hello!')).not.toBeInTheDocument();
  });
});

// ── Message bubble alignment ──────────────────────────────────────────────────

describe('ThreadView — sender vs recipient bubble positioning', () => {
  it('renders own message bubble with right-side alignment class', () => {
    const msg = makeMsg({ senderId: MY_UID, senderName: 'Me' });
    const { container } = render(
      <ThreadView messages={[msg]} loading={false} currentUid={MY_UID} onSend={noop} />
    );
    // The row wrapper for "mine" uses flex-row-reverse
    const rowWrapper = container.querySelector('.flex-row-reverse');
    expect(rowWrapper).toBeTruthy();
  });

  it('renders other person message bubble with left-side alignment class', () => {
    const msg = makeMsg({ senderId: OTHER_UID, senderName: 'Alice' });
    const { container } = render(
      <ThreadView messages={[msg]} loading={false} currentUid={MY_UID} onSend={noop} />
    );
    // Rows for others use flex-row (not flex-row-reverse)
    const rowWrapper = container.querySelector('.flex-row:not(.flex-row-reverse)');
    expect(rowWrapper).toBeTruthy();
    // flex-row-reverse should NOT be present
    expect(container.querySelector('.flex-row-reverse')).toBeNull();
  });

  it('shows the senderName label for other-side messages', () => {
    const msg = makeMsg({ senderId: OTHER_UID, senderName: 'Alice' });
    render(<ThreadView messages={[msg]} loading={false} currentUid={MY_UID} onSend={noop} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('does not show a senderName label for own messages', () => {
    const msg = makeMsg({ senderId: MY_UID, senderName: 'Me' });
    render(<ThreadView messages={[msg]} loading={false} currentUid={MY_UID} onSend={noop} />);
    // The avatar initial may be "M" but the full name span is suppressed for own messages
    expect(screen.queryByText('Me')).not.toBeInTheDocument();
  });
});

// ── Message text rendering ────────────────────────────────────────────────────

describe('ThreadView — message text', () => {
  it('renders the message text', () => {
    const msg = makeMsg({ text: 'Practice is at 5pm' });
    render(<ThreadView messages={[msg]} loading={false} currentUid={MY_UID} onSend={noop} />);
    expect(screen.getByText('Practice is at 5pm')).toBeInTheDocument();
  });

  it('renders multiple messages in the list', () => {
    const msgs = [
      makeMsg({ id: 'm1', text: 'First message' }),
      makeMsg({ id: 'm2', senderId: OTHER_UID, senderName: 'Bob', text: 'Second message' }),
    ];
    render(<ThreadView messages={msgs} loading={false} currentUid={MY_UID} onSend={noop} />);
    expect(screen.getByText('First message')).toBeInTheDocument();
    expect(screen.getByText('Second message')).toBeInTheDocument();
  });
});

// ── Compose box behaviour ─────────────────────────────────────────────────────

describe('ThreadView — compose box', () => {
  it('send button is disabled when textarea is empty', () => {
    render(<ThreadView messages={[]} loading={false} currentUid={MY_UID} onSend={noop} />);
    const btn = screen.getByRole('button', { name: '' });
    expect(btn).toBeDisabled();
  });

  it('send button is enabled once text is typed', async () => {
    const user = userEvent.setup();
    render(<ThreadView messages={[]} loading={false} currentUid={MY_UID} onSend={noop} />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Hello');
    const btn = screen.getByRole('button');
    expect(btn).not.toBeDisabled();
  });

  it('calls onSend with trimmed text when form is submitted', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<ThreadView messages={[]} loading={false} currentUid={MY_UID} onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, '  hello  ');
    await user.click(screen.getByRole('button'));
    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it('clears the textarea after a successful send', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<ThreadView messages={[]} loading={false} currentUid={MY_UID} onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'good luck tonight');
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(textarea).toHaveValue(''));
  });

  it('shows error message when onSend rejects', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockRejectedValue(new Error('Permission denied'));
    render(<ThreadView messages={[]} loading={false} currentUid={MY_UID} onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'will fail');
    await user.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(screen.getByText('Failed to send — please try again.')).toBeInTheDocument()
    );
  });

  it('disables the send button while a send is in flight', async () => {
    const user = userEvent.setup();
    let resolve!: () => void;
    const onSend = vi.fn(
      () => new Promise<void>(r => { resolve = r; })
    );
    render(<ThreadView messages={[]} loading={false} currentUid={MY_UID} onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'sending...');
    await user.click(screen.getByRole('button'));
    // Mid-flight: button should be disabled
    expect(screen.getByRole('button')).toBeDisabled();
    // Cleanup: resolve the promise so React state settles
    resolve();
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
  });

  it('submits the form when Enter is pressed (no shift)', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<ThreadView messages={[]} loading={false} currentUid={MY_UID} onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'enter sends');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('enter sends'));
  });

  it('does NOT submit when Shift+Enter is pressed', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<ThreadView messages={[]} loading={false} currentUid={MY_UID} onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'line one');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('uses the custom placeholder prop when provided', () => {
    render(
      <ThreadView
        messages={[]}
        loading={false}
        currentUid={MY_UID}
        onSend={noop}
        placeholder="Message Alice…"
      />
    );
    expect(screen.getByPlaceholderText('Message Alice…')).toBeInTheDocument();
  });
});
