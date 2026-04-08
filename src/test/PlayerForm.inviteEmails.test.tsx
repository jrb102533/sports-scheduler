/**
 * PlayerForm — parent email invite behavior
 *
 * Tests the invite logic after the parentInviteEmail field was removed.
 * Parent invites are now sent to the p1Email field inside the Parent 1
 * contact section (label "Email", name="parent-email").
 *
 * Behaviors covered:
 *   - New player with p1Email → sendInvite called with { to: p1Email, role: 'parent' }
 *   - New player with no p1Email → no parent invite sent
 *   - New player with both player email and p1Email → two invites sent
 *   - Edit player → no invites sent (invite logic is add-only)
 *   - Adult team → parent section hidden, no parent invite ever sent
 *   - Invite hint message visible when email OR p1Email is non-empty (new player only)
 *   - Player email format validation still fires; p1Email has no separate format validation
 *   - No parentInviteEmail field or state exists anywhere
 *
 * Strategy:
 *   sendInviteFn is constructed at module level inside PlayerForm via
 *   httpsCallable(functions, 'sendInvite'). We intercept httpsCallable so
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

function renderForm(props?: Partial<typeof DEFAULT_PROPS> & Record<string, unknown>) {
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

/**
 * Target the P1 email input by its name attribute.
 * The ParentFields component renders label="Email" for all three parent email inputs,
 * so accessible-name queries are ambiguous. The name attribute "parent-email" is unique
 * to the P1 Email input and is stable.
 */
function setP1Email(email: string) {
  // eslint-disable-next-line testing-library/no-node-access
  const input = document.querySelector<HTMLInputElement>('input[name="parent-email"]');
  if (!input) throw new Error('P1 email input not found — is the parent section visible?');
  fireEvent.change(input, { target: { value: email } });
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

describe('PlayerForm — new player with parent email', () => {
  it('sends one invite with role "parent" when p1Email is provided and player email is empty', async () => {
    renderForm();
    fillRequiredFields();
    setP1Email('parent@example.com');
    clickAddPlayer();

    await waitFor(() => expect(mockSendInvite).toHaveBeenCalledTimes(1));
    expect(mockSendInvite).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'parent@example.com', role: 'parent' })
    );
  });

  it('includes teamId, teamName, and playerName in the parent invite', async () => {
    renderForm();
    fillRequiredFields('Jordan', 'Lee');
    setP1Email('parent@example.com');
    clickAddPlayer();

    await waitFor(() => expect(mockSendInvite).toHaveBeenCalled());
    expect(mockSendInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-1',
        teamName: 'Blue Thunder',
        playerName: 'Jordan Lee',
        to: 'parent@example.com',
        role: 'parent',
      })
    );
  });
});

describe('PlayerForm — new player with no parent email', () => {
  it('sends no invites when both player email and p1Email are empty', async () => {
    renderForm();
    fillRequiredFields();
    clickAddPlayer();

    await waitFor(() => expect(mockAddPlayer).toHaveBeenCalled());
    expect(mockSendInvite).not.toHaveBeenCalled();
  });

  it('sends only the player invite when player email is set but p1Email is empty', async () => {
    renderForm();
    fillRequiredFields();
    setPlayerEmail('player@example.com');
    clickAddPlayer();

    await waitFor(() => expect(mockSendInvite).toHaveBeenCalledTimes(1));
    expect(mockSendInvite).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'player@example.com', role: 'player' })
    );
  });
});

describe('PlayerForm — new player with both emails', () => {
  it('sends two separate invites when both player email and p1Email are provided', async () => {
    renderForm();
    fillRequiredFields();
    setPlayerEmail('player@example.com');
    setP1Email('parent@example.com');
    clickAddPlayer();

    await waitFor(() => expect(mockSendInvite).toHaveBeenCalledTimes(2));
  });

  it('sends player invite with role "player" and parent invite with role "parent"', async () => {
    renderForm();
    fillRequiredFields();
    setPlayerEmail('player@example.com');
    setP1Email('parent@example.com');
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
});

describe('PlayerForm — edit player', () => {
  const editPlayer = {
    id: 'player-99',
    teamId: 'team-1',
    firstName: 'Jordan',
    lastName: 'Lee',
    status: 'active' as const,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    mockUpdatePlayer.mockResolvedValue(undefined);
  });

  it('does not send any invites when editing an existing player', async () => {
    renderForm({ editPlayer });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdatePlayer).toHaveBeenCalled());
    expect(mockSendInvite).not.toHaveBeenCalled();
  });

  it('does not send invites even when player email is populated on an edit', async () => {
    renderForm({ editPlayer: { ...editPlayer, email: 'player@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdatePlayer).toHaveBeenCalled());
    expect(mockSendInvite).not.toHaveBeenCalled();
  });
});

describe('PlayerForm — adult team', () => {
  beforeEach(() => {
    mockTeam = { id: 'team-1', name: 'Blue Thunder', ageGroup: 'adult' };
  });

  it('does not render the parent contact section on adult teams', () => {
    renderForm();
    expect(screen.queryByText(/parent \/ guardian contact/i)).not.toBeInTheDocument();
  });

  it('does not send a parent invite on adult teams even if player email is set', async () => {
    renderForm();
    fillRequiredFields();
    setPlayerEmail('player@example.com');
    clickAddPlayer();

    await waitFor(() => expect(mockSendInvite).toHaveBeenCalledTimes(1));
    // Only player invite — never parent
    const calls = mockSendInvite.mock.calls.map(c => (c[0] as { role: string }).role);
    expect(calls).not.toContain('parent');
  });

  it('still shows the Player Email field on adult teams', () => {
    renderForm();
    expect(screen.getByRole('textbox', { name: /player email/i })).toBeInTheDocument();
  });
});

describe('PlayerForm — invite hint message', () => {
  it('shows the invite hint when player email is non-empty', () => {
    renderForm();
    fillRequiredFields();
    setPlayerEmail('player@example.com');

    expect(screen.getByText(/an invite email will be sent/i)).toBeInTheDocument();
  });

  it('shows the invite hint when p1Email is non-empty', () => {
    renderForm();
    fillRequiredFields();
    setP1Email('parent@example.com');

    expect(screen.getByText(/an invite email will be sent/i)).toBeInTheDocument();
  });

  it('does not show the invite hint when both email fields are empty', () => {
    renderForm();
    fillRequiredFields();

    expect(screen.queryByText(/an invite email will be sent/i)).not.toBeInTheDocument();
  });

  it('does not show the invite hint on the edit path', () => {
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

describe('PlayerForm — player email format validation', () => {
  it('shows validation error and blocks save when player email format is invalid', async () => {
    renderForm();
    fillRequiredFields();
    setPlayerEmail('not-an-email');
    clickAddPlayer();

    await waitFor(() => {
      expect(screen.getByText(/must be a valid email address/i)).toBeInTheDocument();
    });
    expect(mockAddPlayer).not.toHaveBeenCalled();
  });

  it('does not validate p1Email format — an invalid p1Email address still submits', async () => {
    // p1Email goes into parentContact.parentEmail via buildParentContact.
    // The validate() function does NOT check p1Email format. Coaches may enter
    // partial data; the app trusts the coach to enter correct parent info.
    renderForm();
    fillRequiredFields();
    setP1Email('not-an-email');
    clickAddPlayer();

    // Should still call addPlayer (no validation error blocks it)
    await waitFor(() => expect(mockAddPlayer).toHaveBeenCalled());
  });
});

describe('PlayerForm — no dead parentInviteEmail references', () => {
  it('does not render any input with id or name containing "parentInviteEmail"', () => {
    renderForm();
    // eslint-disable-next-line testing-library/no-node-access
    const el = document.querySelector('[id*="parentInviteEmail"], [name*="parentInviteEmail"]');
    expect(el).toBeNull();
  });

  it('does not render a label or placeholder containing "parent invite"', () => {
    renderForm();
    expect(screen.queryByText(/parent invite/i)).not.toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-node-access
    const placeholders = Array.from(document.querySelectorAll('[placeholder]'))
      .map(el => el.getAttribute('placeholder') ?? '');
    expect(placeholders.some(p => /parentInviteEmail/i.test(p))).toBe(false);
  });
});

describe('PlayerForm — save resilience', () => {
  it('still closes the form when sendInvite throws — player save is not rolled back', async () => {
    mockSendInvite.mockRejectedValue(new Error('Network error'));

    renderForm();
    fillRequiredFields();
    setPlayerEmail('player@example.com');
    clickAddPlayer();

    // onClose is called even when invite throws
    await waitFor(() => {
      expect(DEFAULT_PROPS.onClose).toHaveBeenCalled();
    });
    // The player was still added
    expect(mockAddPlayer).toHaveBeenCalled();
  });
});
