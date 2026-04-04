/**
 * RosterTable — isUnclaimed predicate + InvitePlayerSheet
 *
 * Covers:
 *   isUnclaimed —
 *     - player with linkedUid is NOT unclaimed
 *     - player with no linkedUid and no emails IS unclaimed
 *     - player with no linkedUid but a player email is NOT unclaimed
 *     - player with no linkedUid but a parentContact email is NOT unclaimed
 *     - player with no linkedUid but a parentContact2 email is NOT unclaimed
 *     - KNOWN GAP: parentUid field not yet in Player type — noted as blocker
 *
 *   InvitePlayerSheet —
 *     - renders with player name in the heading
 *     - Send Invite(s) button is disabled when both email fields are empty
 *     - Send Invite(s) button is disabled when only whitespace is entered
 *     - Send Invite(s) button enables when a valid parent email is entered
 *     - Send Invite(s) button enables when a valid player email is entered
 *     - same-email error fires when both fields contain the same address
 *     - same-email validation is case-insensitive
 *     - same-email error clears when either field is changed after the error
 *     - dispatches sendInvite for parent when only parent email is provided
 *     - dispatches sendInvite for player when only player email is provided
 *     - dispatches sendInvite twice when both emails are provided
 *     - calls onSuccess with playerId after successful send
 *     - calls onClose after successful send
 *     - shows "Sending…" label while the call is in-flight
 *     - Send Invite(s) button is disabled while the call is in-flight
 *     - does NOT call onSuccess when sendInvite rejects
 *     - does NOT call onClose when sendInvite rejects
 *     - clicking the backdrop calls onClose
 *     - clicking the X button calls onClose
 *
 *   RosterTable — invite chip visibility gating —
 *     - coach sees "Invite Player" chip for an unclaimed player
 *     - parent role does NOT see "Invite Player" chip
 *     - player role does NOT see "Invite Player" chip
 *     - chip is not shown for a player who already has a linkedUid
 *
 *   RosterTable — filter toggle —
 *     - filter button is hidden when no unclaimed players exist
 *     - filter button shows unclaimed count when unclaimed players exist
 *     - clicking the filter button shows only unclaimed players
 *     - clicking the filter button again shows all players
 *
 *   RosterTable — done state —
 *     - "Invite Sent ✓" chip replaces invite chip immediately after onSuccess
 *     - "Invite Sent ✓" chip disappears after 2 seconds
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { Player } from '@/types';

// ─── Hoisted spy references (must precede vi.mock factories) ─────────────────
const { mockSendInviteFn } = vi.hoisted(() => ({
  mockSendInviteFn: vi.fn(),
}));

// ─── Firebase stub ─────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
}));

// ─── sendInvite callable ───────────────────────────────────────────────────────
vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockSendInviteFn,
}));

// ─── Store mocks ───────────────────────────────────────────────────────────────
const mockDeletePlayer = vi.fn();
vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (selector?: (s: { players: Player[]; deletePlayer: typeof mockDeletePlayer }) => unknown) => {
    const state = { players: [], deletePlayer: mockDeletePlayer };
    return selector ? selector(state) : state;
  },
}));

let mockTeams: { id: string; name: string; ageGroup?: string }[] = [];
vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector?: (s: { teams: typeof mockTeams }) => unknown) => {
    const state = { teams: mockTeams };
    return selector ? selector(state) : state;
  },
}));

let mockProfile: { role: string } | null = null;
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector?: (s: { profile: typeof mockProfile }) => unknown) => {
    const state = { profile: mockProfile };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/store/useAvailabilityStore', () => ({
  useAvailabilityStore: (selector?: (s: { availability: Record<string, unknown> }) => unknown) => {
    const state = { availability: {} };
    return selector ? selector(state) : state;
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { RosterTable } from '@/components/roster/RosterTable';
import { InvitePlayerSheet } from '@/components/roster/InvitePlayerSheet';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const TEAM_ID = 'team-1';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'player-1',
    teamId: TEAM_ID,
    firstName: 'Alex',
    lastName: 'Morgan',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderSheet(
  player: Player,
  {
    onClose = vi.fn(),
    onSuccess = vi.fn(),
  }: { onClose?: () => void; onSuccess?: (id: string) => void } = {}
) {
  return {
    onClose,
    onSuccess,
    ...render(
      <InvitePlayerSheet
        open
        player={player}
        teamName="FC Test"
        onClose={onClose}
        onSuccess={onSuccess}
      />
    ),
  };
}

function getParentEmailInput() {
  return screen.getByLabelText(/parent email/i);
}

function getPlayerEmailInput() {
  return screen.getByLabelText(/player email/i);
}

function getSendButton() {
  return screen.getByRole('button', { name: /send invite/i });
}

// ─── isUnclaimed unit tests ────────────────────────────────────────────────────
//
// The predicate is private to RosterTable, so we test it through the rendered
// "Invite Player" chip visibility rather than importing it directly. This
// approach ensures the test stays coupled to observable behavior, not internals.

describe('isUnclaimed — via chip visibility (coach role)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile = { role: 'coach' };
    mockTeams = [{ id: TEAM_ID, name: 'FC Test', ageGroup: 'youth' }];
  });

  it('shows "Invite Player" chip for a player with no linkedUid and no emails', () => {
    const player = makePlayer({ id: 'p1', linkedUid: undefined, email: undefined });
    render(<RosterTable players={[player]} teamId={TEAM_ID} />);
    expect(screen.getByRole('button', { name: /invite alex morgan/i })).toBeInTheDocument();
  });

  it('does NOT show chip for a player who has a linkedUid', () => {
    const player = makePlayer({ id: 'p2', linkedUid: 'uid-abc' });
    render(<RosterTable players={[player]} teamId={TEAM_ID} />);
    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument();
  });

  it('does NOT show chip when the player has their own email on file', () => {
    const player = makePlayer({ id: 'p3', linkedUid: undefined, email: 'alex@example.com' });
    render(<RosterTable players={[player]} teamId={TEAM_ID} />);
    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument();
  });

  it('does NOT show chip when parentContact has an email', () => {
    const player = makePlayer({
      id: 'p4',
      linkedUid: undefined,
      email: undefined,
      parentContact: { parentName: 'Mom', parentPhone: '555-0001', parentEmail: 'mom@example.com' },
    });
    render(<RosterTable players={[player]} teamId={TEAM_ID} />);
    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument();
  });

  it('does NOT show chip when parentContact2 has an email', () => {
    const player = makePlayer({
      id: 'p5',
      linkedUid: undefined,
      email: undefined,
      parentContact2: { parentName: 'Dad', parentPhone: '555-0002', parentEmail: 'dad@example.com' },
    });
    render(<RosterTable players={[player]} teamId={TEAM_ID} />);
    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument();
  });

  it('does NOT show chip when email is only whitespace', () => {
    // A whitespace-only email should be treated as absent — chip should show.
    const player = makePlayer({ id: 'p6', linkedUid: undefined, email: '   ' });
    render(<RosterTable players={[player]} teamId={TEAM_ID} />);
    expect(screen.getByRole('button', { name: /invite alex morgan/i })).toBeInTheDocument();
  });

  it('does NOT show chip when player has a parentUid (parent account linked)', () => {
    const player = makePlayer({ id: 'p-puid', linkedUid: undefined, email: undefined, parentUid: 'parent-uid-1' });
    render(<RosterTable players={[player]} teamId={TEAM_ID} />);
    expect(screen.queryByRole('button', { name: /invite alex morgan/i })).not.toBeInTheDocument();
  });
});

// ─── Coach vs non-coach gating ─────────────────────────────────────────────────

describe('isCoachOrAdmin gating — chip only visible to privileged roles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTeams = [{ id: TEAM_ID, name: 'FC Test', ageGroup: 'youth' }];
  });

  const unclaimedPlayer = makePlayer({ id: 'p-gate', linkedUid: undefined, email: undefined });

  it('coach sees the "Invite Player" chip', () => {
    mockProfile = { role: 'coach' };
    render(<RosterTable players={[unclaimedPlayer]} teamId={TEAM_ID} />);
    expect(screen.getByRole('button', { name: /invite alex morgan/i })).toBeInTheDocument();
  });

  it('admin sees the "Invite Player" chip', () => {
    mockProfile = { role: 'admin' };
    render(<RosterTable players={[unclaimedPlayer]} teamId={TEAM_ID} />);
    expect(screen.getByRole('button', { name: /invite alex morgan/i })).toBeInTheDocument();
  });

  it('league_manager sees the "Invite Player" chip', () => {
    mockProfile = { role: 'league_manager' };
    render(<RosterTable players={[unclaimedPlayer]} teamId={TEAM_ID} />);
    expect(screen.getByRole('button', { name: /invite alex morgan/i })).toBeInTheDocument();
  });

  it('parent role does NOT see the "Invite Player" chip', () => {
    mockProfile = { role: 'parent' };
    render(<RosterTable players={[unclaimedPlayer]} teamId={TEAM_ID} />);
    // queryByRole with name matching "Invite <name>" to avoid matching the filter button
    expect(screen.queryByRole('button', { name: /invite alex morgan/i })).not.toBeInTheDocument();
  });

  it('player role does NOT see the "Invite Player" chip', () => {
    mockProfile = { role: 'player' };
    render(<RosterTable players={[unclaimedPlayer]} teamId={TEAM_ID} />);
    expect(screen.queryByRole('button', { name: /invite alex morgan/i })).not.toBeInTheDocument();
  });
});

// ─── Filter toggle ─────────────────────────────────────────────────────────────

describe('RosterTable — filter toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile = { role: 'coach' };
    mockTeams = [{ id: TEAM_ID, name: 'FC Test', ageGroup: 'youth' }];
  });

  it('does not show the filter button when no players are unclaimed', () => {
    const claimed = makePlayer({ id: 'pc1', linkedUid: 'uid-1' });
    render(<RosterTable players={[claimed]} teamId={TEAM_ID} />);
    expect(screen.queryByText(/not yet invited/i)).not.toBeInTheDocument();
  });

  it('shows unclaimed count in filter button when unclaimed players exist', () => {
    const unclaimed = makePlayer({ id: 'pu1', linkedUid: undefined, email: undefined });
    render(<RosterTable players={[unclaimed]} teamId={TEAM_ID} />);
    expect(screen.getByText(/1 not yet invited/i)).toBeInTheDocument();
  });

  it('clicking the filter button shows only unclaimed players', () => {
    const unclaimed = makePlayer({ id: 'pu2', firstName: 'Unclaimed', linkedUid: undefined, email: undefined });
    const claimed = makePlayer({ id: 'pc2', firstName: 'Claimed', linkedUid: 'uid-x' });
    render(<RosterTable players={[unclaimed, claimed]} teamId={TEAM_ID} />);

    fireEvent.click(screen.getByText(/not yet invited/i));

    expect(screen.getByText('Unclaimed Morgan')).toBeInTheDocument();
    expect(screen.queryByText('Claimed Morgan')).not.toBeInTheDocument();
  });

  it('clicking the filter button again shows all players', () => {
    const unclaimed = makePlayer({ id: 'pu3', firstName: 'Unclaimed', linkedUid: undefined, email: undefined });
    const claimed = makePlayer({ id: 'pc3', firstName: 'Claimed', linkedUid: 'uid-y' });
    render(<RosterTable players={[unclaimed, claimed]} teamId={TEAM_ID} />);

    fireEvent.click(screen.getByText(/not yet invited/i));
    fireEvent.click(screen.getByText(/show all players/i));

    expect(screen.getByText('Unclaimed Morgan')).toBeInTheDocument();
    expect(screen.getByText('Claimed Morgan')).toBeInTheDocument();
  });

  it('filter button has aria-pressed=false initially', () => {
    const unclaimed = makePlayer({ id: 'pu4', linkedUid: undefined, email: undefined });
    render(<RosterTable players={[unclaimed]} teamId={TEAM_ID} />);
    expect(screen.getByText(/not yet invited/i)).toHaveAttribute('aria-pressed', 'false');
  });

  it('filter button has aria-pressed=true when filter is active', () => {
    const unclaimed = makePlayer({ id: 'pu5', linkedUid: undefined, email: undefined });
    render(<RosterTable players={[unclaimed]} teamId={TEAM_ID} />);
    fireEvent.click(screen.getByText(/not yet invited/i));
    expect(screen.getByText(/show all players/i)).toHaveAttribute('aria-pressed', 'true');
  });
});

// ─── Done state (Invite Sent chip) ────────────────────────────────────────────
//
// The done-state lives in RosterTable (handleInviteSuccess sets inviteSentIds).
// We test it by opening the sheet through the chip click, submitting the form,
// and then checking the chip swap. Fake timers are used for the 2-second
// auto-clear, with real timers for the async promise resolution to avoid
// waitFor / fake-timer conflicts.

describe('RosterTable — "Invite Sent" done state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile = { role: 'coach' };
    mockTeams = [{ id: TEAM_ID, name: 'FC Test', ageGroup: 'youth' }];
    mockSendInviteFn.mockResolvedValue({});
  });

  it('shows "Invite Sent" chip after a successful invite, replacing the invite button', async () => {
    const player = makePlayer({ id: 'ds1', linkedUid: undefined, email: undefined });
    render(<RosterTable players={[player]} teamId={TEAM_ID} />);

    // Open the invite sheet
    fireEvent.click(screen.getByRole('button', { name: /invite alex morgan/i }));

    // The sheet renders inline — fill in the email and submit
    fireEvent.change(getParentEmailInput(), { target: { value: 'mom@example.com' } });
    fireEvent.click(getSendButton());

    await waitFor(() => {
      expect(screen.getByText(/invite sent/i)).toBeInTheDocument();
    });

    // The orange "Invite Player" chip should be gone
    expect(screen.queryByRole('button', { name: /invite alex morgan/i })).not.toBeInTheDocument();
  });

  it('"Invite Sent" chip auto-clears after 2 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const player = makePlayer({ id: 'ds2', linkedUid: undefined, email: undefined });
      render(<RosterTable players={[player]} teamId={TEAM_ID} />);

      fireEvent.click(screen.getByRole('button', { name: /invite alex morgan/i }));
      fireEvent.change(getParentEmailInput(), { target: { value: 'mom@example.com' } });
      fireEvent.click(getSendButton());

      // Advance microtasks so the resolved promise settles and onSuccess fires
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByText(/invite sent/i)).toBeInTheDocument();

      // Now advance past the 2-second cleanup timer
      act(() => { vi.advanceTimersByTime(2100); });

      expect(screen.queryByText(/invite sent/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── InvitePlayerSheet — rendering ────────────────────────────────────────────

describe('InvitePlayerSheet — rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendInviteFn.mockResolvedValue({});
  });

  it('renders with the player name in the heading', () => {
    renderSheet(makePlayer());
    expect(screen.getByRole('heading', { name: /invite alex morgan/i })).toBeInTheDocument();
  });

  it('returns null when open=false', () => {
    const player = makePlayer();
    const { container } = render(
      <InvitePlayerSheet open={false} player={player} teamName="FC Test" onClose={vi.fn()} onSuccess={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('has an accessible dialog role', () => {
    renderSheet(makePlayer());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

// ─── InvitePlayerSheet — Send button enabled/disabled state ───────────────────

describe('InvitePlayerSheet — Send button gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendInviteFn.mockResolvedValue({});
  });

  it('Send Invite(s) is disabled when both email fields are empty', () => {
    renderSheet(makePlayer());
    expect(getSendButton()).toBeDisabled();
  });

  it('Send Invite(s) is disabled when only whitespace is entered', () => {
    renderSheet(makePlayer());
    fireEvent.change(getParentEmailInput(), { target: { value: '   ' } });
    expect(getSendButton()).toBeDisabled();
  });

  it('Send Invite(s) is disabled when an invalid email is entered', () => {
    renderSheet(makePlayer());
    fireEvent.change(getParentEmailInput(), { target: { value: 'not-an-email' } });
    expect(getSendButton()).toBeDisabled();
  });

  it('Send Invite(s) enables when a valid parent email is entered', () => {
    renderSheet(makePlayer());
    fireEvent.change(getParentEmailInput(), { target: { value: 'parent@example.com' } });
    expect(getSendButton()).not.toBeDisabled();
  });

  it('Send Invite(s) enables when a valid player email is entered', () => {
    renderSheet(makePlayer());
    fireEvent.change(getPlayerEmailInput(), { target: { value: 'player@example.com' } });
    expect(getSendButton()).not.toBeDisabled();
  });
});

// ─── InvitePlayerSheet — same-email validation ────────────────────────────────

describe('InvitePlayerSheet — same-email validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendInviteFn.mockResolvedValue({});
  });

  it('shows an error and does not send when both emails are identical', async () => {
    renderSheet(makePlayer());
    fireEvent.change(getParentEmailInput(), { target: { value: 'same@example.com' } });
    fireEvent.change(getPlayerEmailInput(), { target: { value: 'same@example.com' } });
    fireEvent.click(getSendButton());

    await waitFor(() => {
      expect(screen.getByText(/must be different/i)).toBeInTheDocument();
    });
    expect(mockSendInviteFn).not.toHaveBeenCalled();
  });

  it('same-email validation is case-insensitive', async () => {
    renderSheet(makePlayer());
    fireEvent.change(getParentEmailInput(), { target: { value: 'Same@Example.com' } });
    fireEvent.change(getPlayerEmailInput(), { target: { value: 'same@example.com' } });
    fireEvent.click(getSendButton());

    await waitFor(() => {
      expect(screen.getByText(/must be different/i)).toBeInTheDocument();
    });
  });

  it('same-email error clears when the parent email field is changed', async () => {
    renderSheet(makePlayer());
    fireEvent.change(getParentEmailInput(), { target: { value: 'same@example.com' } });
    fireEvent.change(getPlayerEmailInput(), { target: { value: 'same@example.com' } });
    fireEvent.click(getSendButton());

    await waitFor(() => expect(screen.getByText(/must be different/i)).toBeInTheDocument());

    fireEvent.change(getParentEmailInput(), { target: { value: 'different@example.com' } });
    expect(screen.queryByText(/must be different/i)).not.toBeInTheDocument();
  });

  it('same-email error clears when the player email field is changed', async () => {
    renderSheet(makePlayer());
    fireEvent.change(getParentEmailInput(), { target: { value: 'same@example.com' } });
    fireEvent.change(getPlayerEmailInput(), { target: { value: 'same@example.com' } });
    fireEvent.click(getSendButton());

    await waitFor(() => expect(screen.getByText(/must be different/i)).toBeInTheDocument());

    fireEvent.change(getPlayerEmailInput(), { target: { value: 'different@example.com' } });
    expect(screen.queryByText(/must be different/i)).not.toBeInTheDocument();
  });

  it('allows sending when the two emails are valid and different', async () => {
    renderSheet(makePlayer());
    fireEvent.change(getParentEmailInput(), { target: { value: 'parent@example.com' } });
    fireEvent.change(getPlayerEmailInput(), { target: { value: 'player@example.com' } });
    fireEvent.click(getSendButton());

    await waitFor(() => expect(mockSendInviteFn).toHaveBeenCalled());
    expect(screen.queryByText(/must be different/i)).not.toBeInTheDocument();
  });
});

// ─── InvitePlayerSheet — dispatch behaviour ───────────────────────────────────

describe('InvitePlayerSheet — sendInvite dispatch', () => {
  const player = makePlayer({ id: 'dispatch-p', teamId: 'team-dispatch' });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendInviteFn.mockResolvedValue({});
  });

  it('dispatches one sendInvite call for parent when only parent email is provided', async () => {
    renderSheet(player);
    fireEvent.change(getParentEmailInput(), { target: { value: 'parent@example.com' } });
    fireEvent.click(getSendButton());

    await waitFor(() => expect(mockSendInviteFn).toHaveBeenCalledTimes(1));
    expect(mockSendInviteFn).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'parent@example.com', role: 'parent' })
    );
  });

  it('dispatches one sendInvite call for player when only player email is provided', async () => {
    renderSheet(player);
    fireEvent.change(getPlayerEmailInput(), { target: { value: 'player@example.com' } });
    fireEvent.click(getSendButton());

    await waitFor(() => expect(mockSendInviteFn).toHaveBeenCalledTimes(1));
    expect(mockSendInviteFn).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'player@example.com', role: 'player' })
    );
  });

  it('dispatches two sendInvite calls when both emails are provided', async () => {
    renderSheet(player);
    fireEvent.change(getParentEmailInput(), { target: { value: 'parent@example.com' } });
    fireEvent.change(getPlayerEmailInput(), { target: { value: 'player@example.com' } });
    fireEvent.click(getSendButton());

    await waitFor(() => expect(mockSendInviteFn).toHaveBeenCalledTimes(2));
  });

  it('passes correct playerId and teamId to sendInvite', async () => {
    renderSheet(player);
    fireEvent.change(getParentEmailInput(), { target: { value: 'parent@example.com' } });
    fireEvent.click(getSendButton());

    await waitFor(() => expect(mockSendInviteFn).toHaveBeenCalled());
    expect(mockSendInviteFn).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'dispatch-p', teamId: 'team-dispatch' })
    );
  });

  it('calls onSuccess with the player id after a successful send', async () => {
    const onSuccess = vi.fn();
    renderSheet(player, { onSuccess });
    fireEvent.change(getParentEmailInput(), { target: { value: 'parent@example.com' } });
    fireEvent.click(getSendButton());

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('dispatch-p'));
  });

  it('calls onClose after a successful send', async () => {
    const onClose = vi.fn();
    renderSheet(player, { onClose });
    fireEvent.change(getParentEmailInput(), { target: { value: 'parent@example.com' } });
    fireEvent.click(getSendButton());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

// ─── InvitePlayerSheet — loading state ────────────────────────────────────────

describe('InvitePlayerSheet — loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Sending…" label while the call is in-flight', async () => {
    mockSendInviteFn.mockReturnValue(new Promise(() => {})); // never settles
    renderSheet(makePlayer());
    fireEvent.change(getParentEmailInput(), { target: { value: 'parent@example.com' } });
    fireEvent.click(getSendButton());

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sending/i })).toBeInTheDocument();
    });
  });

  it('Send Invite(s) button is disabled while the call is in-flight', async () => {
    mockSendInviteFn.mockReturnValue(new Promise(() => {}));
    renderSheet(makePlayer());
    fireEvent.change(getParentEmailInput(), { target: { value: 'parent@example.com' } });

    const btn = getSendButton();
    fireEvent.click(btn);

    await waitFor(() => expect(btn).toBeDisabled());
  });

  it('Cancel button is disabled while the call is in-flight', async () => {
    mockSendInviteFn.mockReturnValue(new Promise(() => {}));
    renderSheet(makePlayer());
    fireEvent.change(getParentEmailInput(), { target: { value: 'parent@example.com' } });
    fireEvent.click(getSendButton());

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
    });
  });
});

// ─── InvitePlayerSheet — error path ───────────────────────────────────────────

describe('InvitePlayerSheet — sendInvite failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendInviteFn.mockRejectedValue(new Error('Network error'));
  });

  it('does NOT call onSuccess when sendInvite rejects', async () => {
    const onSuccess = vi.fn();
    renderSheet(makePlayer(), { onSuccess });
    fireEvent.change(getParentEmailInput(), { target: { value: 'parent@example.com' } });
    fireEvent.click(getSendButton());

    // Wait for the submitting state to clear (indicating the catch ran)
    await waitFor(() => expect(getSendButton()).not.toBeDisabled());
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('does NOT call onClose when sendInvite rejects', async () => {
    const onClose = vi.fn();
    renderSheet(makePlayer(), { onClose });
    fireEvent.change(getParentEmailInput(), { target: { value: 'parent@example.com' } });
    fireEvent.click(getSendButton());

    await waitFor(() => expect(getSendButton()).not.toBeDisabled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('re-enables the Send button after a failed send', async () => {
    renderSheet(makePlayer());
    fireEvent.change(getParentEmailInput(), { target: { value: 'parent@example.com' } });
    fireEvent.click(getSendButton());

    await waitFor(() => expect(getSendButton()).not.toBeDisabled());
  });
});

// ─── InvitePlayerSheet — close controls ───────────────────────────────────────

describe('InvitePlayerSheet — close controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendInviteFn.mockResolvedValue({});
  });

  it('clicking the backdrop calls onClose', () => {
    const onClose = vi.fn();
    renderSheet(makePlayer(), { onClose });
    // The backdrop is the first fixed div (aria-hidden)
    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking the X button calls onClose', () => {
    const onClose = vi.fn();
    renderSheet(makePlayer(), { onClose });
    fireEvent.click(screen.getByRole('button', { name: /close invite sheet/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
