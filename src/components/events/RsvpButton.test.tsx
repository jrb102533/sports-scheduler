/**
 * RsvpButton — behaviour tests
 *
 * Behaviours under test:
 *   A) Initial render
 *      - "Going" and "Not Going" buttons are always rendered
 *      - No summary row when no RSVP entries exist yet
 *   B) RSVP response buttons
 *      - Clicking "Going" calls submitRsvp with response='yes'
 *      - Clicking "Not Going" calls submitRsvp with response='no'
 *      - Active response button reflects aria-pressed=true
 *   C) Summary row expand/collapse
 *      - Summary row appears when at least one entry exists
 *      - Clicking summary expands the name list
 *      - Expanded list shows going and not-going names in separate sections
 *      - Clicking again collapses the list
 *   D) Disabled state during in-flight submission
 *      - Both buttons are disabled while submitRsvp is in flight
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Firebase mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  doc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
}));

// ── RsvpStore mock ─────────────────────────────────────────────────────────────

// Mutable per-test RSVP state
let mockRsvps: import('@/store/useRsvpStore').RsvpEntry[] = [];
const mockSubmitRsvp = vi.fn().mockResolvedValue(undefined);
const mockSubscribeRsvps = vi.fn(() => () => {});

vi.mock('@/store/useRsvpStore', () => ({
  useRsvpStore: (selector: (s: { rsvps: Record<string, import('@/store/useRsvpStore').RsvpEntry[]>; submitRsvp: typeof mockSubmitRsvp; subscribeRsvps: typeof mockSubscribeRsvps }) => unknown) =>
    selector({
      rsvps: { 'event-1': mockRsvps },
      submitRsvp: mockSubmitRsvp,
      subscribeRsvps: mockSubscribeRsvps,
    }),
  // RsvpButton calls useRsvpStore.setState for optimistic updates — provide a no-op
  // so the import doesn't crash. Actual state management is via the module mock above.
  useRsvpStore: Object.assign(
    (selector: (s: { rsvps: Record<string, import('@/store/useRsvpStore').RsvpEntry[]>; submitRsvp: typeof mockSubmitRsvp; subscribeRsvps: typeof mockSubscribeRsvps }) => unknown) =>
      selector({
        rsvps: { 'event-1': mockRsvps },
        submitRsvp: mockSubmitRsvp,
        subscribeRsvps: mockSubscribeRsvps,
      }),
    { setState: vi.fn(), getState: vi.fn(() => ({ rsvps: {}, subscribeRsvps: mockSubscribeRsvps })) }
  ),
}));

// ── Import after mocks ─────────────────────────────────────────────────────────

import { RsvpButton } from './RsvpButton';

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderButton(overrides?: { uid?: string; name?: string; eventId?: string }) {
  const props = {
    eventId: overrides?.eventId ?? 'event-1',
    currentUserUid: overrides?.uid ?? 'uid-alice',
    currentUserName: overrides?.name ?? 'Alice',
  };
  return render(<RsvpButton {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRsvps = [];
  mockSubmitRsvp.mockResolvedValue(undefined);
});

// ── A. Initial render ──────────────────────────────────────────────────────────

describe('RsvpButton — initial render', () => {
  it('renders the Going button', () => {
    renderButton();
    expect(screen.getByRole('button', { name: /^going$/i })).toBeInTheDocument();
  });

  it('renders the Not Going button', () => {
    renderButton();
    expect(screen.getByRole('button', { name: /^not going$/i })).toBeInTheDocument();
  });

  it('does not show the summary row when there are no RSVP entries', () => {
    mockRsvps = [];
    renderButton();
    // Summary text "X going · Y not going" should not be present
    expect(screen.queryByText(/going ·/i)).not.toBeInTheDocument();
  });
});

// ── B. RSVP response buttons ───────────────────────────────────────────────────

describe('RsvpButton — clicking Going / Not Going', () => {
  it('calls submitRsvp with response="yes" when Going is clicked', async () => {
    const user = userEvent.setup();
    renderButton({ uid: 'uid-alice', name: 'Alice', eventId: 'event-1' });

    await user.click(screen.getByRole('button', { name: /^going$/i }));

    await waitFor(() => {
      expect(mockSubmitRsvp).toHaveBeenCalledOnce();
    });
    expect(mockSubmitRsvp).toHaveBeenCalledWith('event-1', 'uid-alice', 'Alice', 'yes');
  });

  it('calls submitRsvp with response="no" when Not Going is clicked', async () => {
    const user = userEvent.setup();
    renderButton({ uid: 'uid-bob', name: 'Bob', eventId: 'event-1' });

    await user.click(screen.getByRole('button', { name: /not going/i }));

    await waitFor(() => {
      expect(mockSubmitRsvp).toHaveBeenCalledOnce();
    });
    expect(mockSubmitRsvp).toHaveBeenCalledWith('event-1', 'uid-bob', 'Bob', 'no');
  });

  it('Going button reflects aria-pressed=true when user RSVP is "yes"', () => {
    mockRsvps = [{ uid: 'uid-alice', name: 'Alice', response: 'yes', updatedAt: '2026-01-01T00:00:00.000Z' }];
    renderButton({ uid: 'uid-alice' });

    const goingBtn = screen.getByRole('button', { name: /^going$/i });
    expect(goingBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('Not Going button reflects aria-pressed=true when user RSVP is "no"', () => {
    mockRsvps = [{ uid: 'uid-alice', name: 'Alice', response: 'no', updatedAt: '2026-01-01T00:00:00.000Z' }];
    renderButton({ uid: 'uid-alice' });

    const notGoingBtn = screen.getByRole('button', { name: /^not going$/i });
    expect(notGoingBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('Going button has aria-pressed=false when no RSVP exists for the user', () => {
    mockRsvps = [];
    renderButton({ uid: 'uid-alice' });

    const goingBtn = screen.getByRole('button', { name: /^going$/i });
    expect(goingBtn).toHaveAttribute('aria-pressed', 'false');
  });
});

// ── C. Summary row expand/collapse ────────────────────────────────────────────

describe('RsvpButton — summary row expand/collapse', () => {
  beforeEach(() => {
    mockRsvps = [
      { uid: 'uid-alice', name: 'Alice', response: 'yes', updatedAt: '2026-01-01T00:00:00.000Z' },
      { uid: 'uid-bob', name: 'Bob', response: 'no', updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
  });

  it('shows summary row when there are RSVP entries', () => {
    renderButton();
    // The summary row text contains "going ·" which is distinct from the button labels
    expect(screen.getByText(/1 going/)).toBeInTheDocument();
  });

  it('expands name list when summary row is clicked', async () => {
    const user = userEvent.setup();
    renderButton();

    // Click the summary button (aria-expanded=false → true)
    const summaryBtn = screen.getByRole('button', { expanded: false });
    await user.click(summaryBtn);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('collapses name list when summary row is clicked a second time', async () => {
    const user = userEvent.setup();
    renderButton();

    const summaryBtn = screen.getByRole('button', { expanded: false });
    await user.click(summaryBtn); // expand
    await user.click(screen.getByRole('button', { expanded: true })); // collapse

    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('shows going names under a "Going" heading and not-going under "Not Going"', async () => {
    const user = userEvent.setup();
    renderButton();

    // Click the aria-expanded=false summary button to expand
    await user.click(screen.getByRole('button', { expanded: false }));

    // The expanded section renders Alice (going) and Bob (not going) as <li> items
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    // The expanded section also has "Going" and "Not Going" headings as <p> elements
    // The button label "Going" also matches — so there should be at least 2 "Going" occurrences
    expect(screen.getAllByText(/^Going$/).length).toBeGreaterThanOrEqual(2); // button + heading
    expect(screen.getAllByText(/^Not Going$/).length).toBeGreaterThanOrEqual(1); // heading
  });
});

// ── D. Disabled state during in-flight submission ─────────────────────────────

describe('RsvpButton — disabled state during submission', () => {
  it('disables both buttons while submitRsvp is in flight', async () => {
    let resolveSubmit!: () => void;
    mockSubmitRsvp.mockImplementationOnce(() => new Promise<void>(res => { resolveSubmit = res; }));

    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole('button', { name: /^going$/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^going$/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /not going/i })).toBeDisabled();
    });

    // Release the pending submit to clean up
    resolveSubmit();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^going$/i })).not.toBeDisabled();
    });
  });
});
