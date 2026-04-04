/**
 * PlayerForm — invite email fields
 *
 * Covers the new Player Email / Parent Email invite behavior added in this PR:
 *   - Same-email cross-field validation fires when both fields have the same address
 *   - Two separate invites are sent when both player and parent emails are provided
 *   - No invites are sent when both email fields are empty
 *   - Player invite is sent with role: 'player'
 *   - Parent invite is sent with role: 'parent'
 *   - Only one invite (player) is sent when only player email is provided
 *   - Only one invite (parent) is sent when only parent email is provided
 *   - Invalid email format on player email field shows validation error
 *   - Invalid email format on parent email field shows validation error
 *   - Parent Email field is hidden on adult teams
 *
 * Strategy:
 *   sendInviteFn is constructed at module level inside PlayerForm via
 *   httpsCallable(functions, 'sendInvite').  We intercept httpsCallable so
 *   the returned callable is our spy.
 *
 *   usePlayerStore and useTeamStore are mocked — no real Zustand/Firestore needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({
  auth: { currentUser: null },
  db: {},
  functions: {},
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  onSnapshot: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
}));

// vi.hoisted() required — spy reference is captured inside vi.mock() factory
// which is hoisted above regular variable declarations.
const { mockSendInvite } = vi.hoisted(() => ({
  mockSendInvite: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => mockSendInvite),
}));

// ─── Store mocks ──────────────────────────────────────────────────────────────

const mockAddPlayer = vi.fn();
const mockAddSensitiveData = vi.fn();
const mockUpdatePlayer = vi.fn();
const mockUpdateSensitiveData = vi.fn();

vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: vi.fn(() => ({
    addPlayer: mockAddPlayer,
    addSensitiveData: mockAddSensitiveData,
    updatePlayer: mockUpdatePlayer,
    updateSensitiveData: mockUpdateSensitiveData,
  })),
}));

// Team store returns a youth team by default; individual tests override via
// the mockTeam variable.
let mockTeam: { id: string; name: string; ageGroup: string } | undefined = {
  id: 'team-1',
  name: 'Blue Thunder',
  ageGroup: 'u10',
};

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: vi.fn((selector: (s: { teams: typeof mockTeam[] }) => unknown) =>
    selector({ teams: [mockTeam] })
  ),
}));

// ─── Constants mock ───────────────────────────────────────────────────────────

vi.mock('@/constants', () => ({
  PLAYER_STATUS_LABELS: {
    active: 'Active',
    inactive: 'Inactive',
    injured: 'Injured',
  },
}));

import { PlayerForm } from '@/components/roster/PlayerForm';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_PROPS = {
  open: true,
  onClose: vi.fn(),
  teamId: 'team-1',
};

function renderForm(props?: Partial<typeof DEFAULT_PROPS>) {
  return render(<PlayerForm {...DEFAULT_PROPS} {...props} />);
}

function fillRequiredFields(firstName = 'Jordan', lastName = 'Lee') {
  fireEvent.change(screen.getByRole('textbox', { name: /first name/i }), {
    target: { value: firstName },
  });
  fireEvent.change(screen.getByRole('textbox', { name: /last name/i }), {
    target: { value: lastName },
  });
}

function setPlayerEmail(email: string) {
  fireEvent.change(screen.getByRole('textbox', { name: /player email/i }), {
    target: { value: email },
  });
}

function setParentEmail(email: string) {
  fireEvent.change(screen.getByRole('textbox', { name: /parent email/i }), {
    target: { value: email },
  });
}

function clickAddPlayer() {
  fireEvent.click(screen.getByRole('button', { name: /add player/i }));
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockAddPlayer.mockResolvedValue(undefined);
  mockAddSensitiveData.mockResolvedValue(undefined);
  mockSendInvite.mockResolvedValue({ data: {} });
  mockTeam = { id: 'team-1', name: 'Blue Thunder', ageGroup: 'u10' };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PlayerForm — same-email cross-field validation', () => {
  it('shows a validation error when player and parent email are the same', async () => {
    renderForm();
    fillRequiredFields();
    setPlayerEmail('shared@example.com');
    setParentEmail('shared@example.com');
    clickAddPlayer();

    await waitFor(() => {
      expect(screen.getByText(/parent and player email must be different/i)).toBeInTheDocument();
    });
  });

  it('comparison is case-insensitive (SHARED@EXAMPLE.COM vs shared@example.com)', async () => {
    renderForm();
    fillRequiredFields();
    setPlayerEmail('SHARED@EXAMPLE.COM');
    setParentEmail('shared@example.com');
    clickAddPlayer();

    await waitFor(() => {
      expect(screen.getByText(/parent and player email must be different/i)).toBeInTheDocument();
    });
  });

  it('does NOT show same-email error when only player email is provided', async () => {
    renderForm();
    fillRequiredFields();
    setPlayerEmail('player@example.com');
    clickAddPlayer();

    await waitFor(() => expect(mockAddPlayer).toHaveBeenCalled());
    expect(screen.queryByText(/parent and player email must be different/i)).not.toBeInTheDocument();
  });

  it('does NOT show same-email error when player and parent emails differ', async () => {
    renderForm();
    fillRequiredFields();
    setPlayerEmail('player@example.com');
    setParentEmail('parent@example.com');
    clickAddPlayer();

    await waitFor(() => expect(mockAddPlayer).toHaveBeenCalled());
    expect(screen.queryByText(/parent and player email must be different/i)).not.toBeInTheDocument();
  });

  it('does not call addPlayer when same-email validation fails', async () => {
    renderForm();
    fillRequiredFields();
    setPlayerEmail('shared@example.com');
    setParentEmail('shared@example.com');
    clickAddPlayer();

    await waitFor(() => {
      expect(screen.getByText(/parent and player email must be different/i)).toBeInTheDocument();
    });
    expect(mockAddPlayer).not.toHaveBeenCalled();
  });
});

describe('PlayerForm — email format validation', () => {
  it('shows a validation error for an invalid player email', async () => {
    renderForm();
    fillRequiredFields();
    setPlayerEmail('not-an-email');
    clickAddPlayer();

    await waitFor(() => {
      expect(screen.getByText(/must be a valid email address/i)).toBeInTheDocument();
    });
    expect(mockAddPlayer).not.toHaveBeenCalled();
  });

  it('shows a validation error for an invalid parent email', async () => {
    renderForm();
    fillRequiredFields();
    setParentEmail('also-not-an-email');
    clickAddPlayer();

    await waitFor(() => {
      expect(screen.getByText(/must be a valid email address/i)).toBeInTheDocument();
    });
    expect(mockAddPlayer).not.toHaveBeenCalled();
  });
});

describe('PlayerForm — invite sending', () => {
  it('sends zero invites when both email fields are empty', async () => {
    renderForm();
    fillRequiredFields();
    clickAddPlayer();

    await waitFor(() => expect(mockAddPlayer).toHaveBeenCalled());
    expect(mockSendInvite).not.toHaveBeenCalled();
  });

  it('sends exactly one invite with role: "player" when only player email is provided', async () => {
    renderForm();
    fillRequiredFields();
    setPlayerEmail('player@example.com');
    clickAddPlayer();

    await waitFor(() => expect(mockSendInvite).toHaveBeenCalledTimes(1));
    expect(mockSendInvite).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'player@example.com', role: 'player' })
    );
  });

  it('sends exactly one invite with role: "parent" when only parent email is provided', async () => {
    renderForm();
    fillRequiredFields();
    setParentEmail('parent@example.com');
    clickAddPlayer();

    await waitFor(() => expect(mockSendInvite).toHaveBeenCalledTimes(1));
    expect(mockSendInvite).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'parent@example.com', role: 'parent' })
    );
  });

  it('sends two separate invites when both emails are provided', async () => {
    renderForm();
    fillRequiredFields();
    setPlayerEmail('player@example.com');
    setParentEmail('parent@example.com');
    clickAddPlayer();

    await waitFor(() => expect(mockSendInvite).toHaveBeenCalledTimes(2));
  });

  it('sends player invite with role: "player" and parent invite with role: "parent"', async () => {
    renderForm();
    fillRequiredFields();
    setPlayerEmail('player@example.com');
    setParentEmail('parent@example.com');
    clickAddPlayer();

    await waitFor(() => expect(mockSendInvite).toHaveBeenCalledTimes(2));

    const calls = mockSendInvite.mock.calls.map(c => c[0] as { to: string; role: string });
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ to: 'player@example.com', role: 'player' }),
        expect.objectContaining({ to: 'parent@example.com', role: 'parent' }),
      ])
    );
  });

  it('passes teamId and playerName to each invite', async () => {
    renderForm();
    fillRequiredFields('Jordan', 'Lee');
    setPlayerEmail('player@example.com');
    clickAddPlayer();

    await waitFor(() => expect(mockSendInvite).toHaveBeenCalled());
    expect(mockSendInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-1',
        teamName: 'Blue Thunder',
        playerName: 'Jordan Lee',
      })
    );
  });

  it('does not send invites on the edit (existing player) path', async () => {
    const editPlayer = {
      id: 'player-99',
      teamId: 'team-1',
      firstName: 'Jordan',
      lastName: 'Lee',
      status: 'active' as const,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    mockUpdatePlayer.mockResolvedValue(undefined);

    renderForm({ editPlayer });

    // Edit path: just save without changing emails
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdatePlayer).toHaveBeenCalled());
    expect(mockSendInvite).not.toHaveBeenCalled();
  });

  it('does not throw when sendInvite fails — save still completes', async () => {
    mockSendInvite.mockRejectedValue(new Error('Network error'));

    renderForm();
    fillRequiredFields();
    setPlayerEmail('player@example.com');
    clickAddPlayer();

    // onClose is called even when invite throws
    await waitFor(() => {
      expect(DEFAULT_PROPS.onClose).toHaveBeenCalled();
    });
  });
});

describe('PlayerForm — adult team', () => {
  it('does not show the Parent Email field on adult teams', () => {
    mockTeam = { id: 'team-1', name: 'Blue Thunder', ageGroup: 'adult' };
    renderForm();

    expect(screen.queryByRole('textbox', { name: /parent email/i })).not.toBeInTheDocument();
  });

  it('shows the Player Email field on adult teams', () => {
    mockTeam = { id: 'team-1', name: 'Blue Thunder', ageGroup: 'adult' };
    renderForm();

    expect(screen.getByRole('textbox', { name: /player email/i })).toBeInTheDocument();
  });
});

describe('PlayerForm — invite preview notice', () => {
  it('shows invite preview text when player email is filled', () => {
    renderForm();
    fillRequiredFields();
    setPlayerEmail('player@example.com');

    expect(screen.getByText(/an invite email will be sent/i)).toBeInTheDocument();
  });

  it('shows invite preview text when parent email is filled', () => {
    renderForm();
    fillRequiredFields();
    setParentEmail('parent@example.com');

    expect(screen.getByText(/an invite email will be sent/i)).toBeInTheDocument();
  });

  it('does not show invite preview text when both email fields are empty', () => {
    renderForm();
    fillRequiredFields();

    expect(screen.queryByText(/an invite email will be sent/i)).not.toBeInTheDocument();
  });

  it('does not show invite preview on the edit path', () => {
    const editPlayer = {
      id: 'player-99',
      teamId: 'team-1',
      firstName: 'Jordan',
      lastName: 'Lee',
      status: 'active' as const,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    renderForm({ editPlayer });

    expect(screen.queryByText(/an invite email will be sent/i)).not.toBeInTheDocument();
  });
});
