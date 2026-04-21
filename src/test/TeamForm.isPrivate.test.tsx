/**
 * TeamForm — isPrivate (team visibility) checkbox
 *
 * Behaviors under test:
 *   Checkbox visibility
 *     1. "Make this team discoverable" checkbox shown in create mode
 *     2. "Make this team discoverable" checkbox shown in edit mode
 *   Initial state (isPrivate stored as inverted "discoverable" checkbox)
 *     3. Checkbox is unchecked (team is private/not discoverable) by default on new team
 *     4. Checkbox is checked (discoverable) when editTeam.isPrivate is false
 *     5. Checkbox is unchecked (not discoverable) when editTeam.isPrivate is true
 *     6. Checkbox is unchecked (not discoverable) when editTeam.isPrivate is undefined (defaults private)
 *   Persistence: updateTeam includes isPrivate field
 *     7. updateTeam is called with isPrivate: false when checkbox is checked (make discoverable)
 *     8. updateTeam is called with isPrivate: true when checkbox is unchecked (make private)
 *     9. updateTeam is called with isPrivate: false when checkbox was never touched on a non-private team
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Team } from '@/types';

// ─── Firebase stub ─────────────────────────────────────────────────────────────
const mockCallable = vi.fn();
vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockCallable,
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn((_s: unknown, path: string) => ({ path })),
  uploadBytes: vi.fn().mockResolvedValue({}),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage.example.com/logo.png'),
  deleteObject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
  storage: {},
}));

// ─── Settings store ───────────────────────────────────────────────────────────
vi.mock('@/store/useSettingsStore', () => ({
  useSettingsStore: (sel: (s: { settings: { kidsSportsMode: boolean } }) => unknown) =>
    sel({ settings: { kidsSportsMode: false } }),
}));

// ─── Venue store ──────────────────────────────────────────────────────────────
vi.mock('@/store/useVenueStore', () => {
  const subscribe = vi.fn().mockReturnValue(() => {});
  const useVenueStore = (sel?: (s: { venues: never[]; subscribe: typeof subscribe }) => unknown) => {
    const state = { venues: [] as never[], subscribe };
    return sel ? sel(state) : state;
  };
  useVenueStore.getState = () => ({ venues: [] as never[], subscribe });
  return { useVenueStore };
});

// ─── Team store ───────────────────────────────────────────────────────────────
const mockUpdateTeam = vi.fn().mockResolvedValue(undefined);

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (sel?: (s: object) => unknown) => {
    const state = { updateTeam: mockUpdateTeam };
    return sel ? sel(state) : state;
  },
}));

// ─── Auth store (mutable per-test) ───────────────────────────────────────────
let currentUid = 'uid-coach';

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (sel: (s: { profile: { uid: string; displayName: string; email: string; role: string }; user: { uid: string } }) => unknown) =>
    sel({
      profile: { uid: currentUid, displayName: 'Coach A', email: 'coach@example.com', role: 'coach' },
      user: { uid: currentUid },
    }),
}));

import { TeamForm } from '@/components/teams/TeamForm';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    name: 'Test Team',
    sportType: 'soccer',
    color: '#ef4444',
    createdBy: 'uid-coach',
    ownerName: 'Coach A',
    coachId: 'uid-coach',
    attendanceWarningsEnabled: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function getPrivacyCheckbox() {
  return screen.queryByRole('checkbox', { name: /make this team discoverable/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUid = 'uid-coach';
  mockCallable.mockResolvedValue({ data: { teamId: 'new-team-id' } });
  mockUpdateTeam.mockResolvedValue(undefined);
});

// ─── Checkbox visibility ──────────────────────────────────────────────────────
// Post-refactor: the "Make this team discoverable" checkbox is visible in BOTH
// create and edit mode (it was edit-only before).

describe('TeamForm — isPrivate checkbox visibility', () => {
  it('shows the "Make this team discoverable" checkbox when creating a new team', () => {
    render(<TeamForm open onClose={vi.fn()} />);
    expect(getPrivacyCheckbox()).toBeInTheDocument();
  });

  it('shows the "Make this team discoverable" checkbox when editing an existing team', () => {
    render(<TeamForm open onClose={vi.fn()} editTeam={makeTeam()} />);
    expect(getPrivacyCheckbox()).toBeInTheDocument();
  });
});

// ─── Checkbox initial state ───────────────────────────────────────────────────
// The UI checkbox is "Make this team discoverable" — the inverse of isPrivate.
// checked=true  → isPrivate=false (discoverable)
// checked=false → isPrivate=true  (private, default)

describe('TeamForm — isPrivate checkbox initial state', () => {
  it('renders unchecked (private) by default on a new team form', () => {
    render(<TeamForm open onClose={vi.fn()} />);
    const cb = getPrivacyCheckbox() as HTMLInputElement;
    expect(cb.checked).toBe(false); // default: private
  });

  it('renders checked (discoverable) when editTeam.isPrivate is false', () => {
    render(<TeamForm open onClose={vi.fn()} editTeam={makeTeam({ isPrivate: false })} />);
    const cb = getPrivacyCheckbox() as HTMLInputElement;
    expect(cb.checked).toBe(true); // isPrivate=false → discoverable → checked
  });

  it('renders unchecked (private) when editTeam.isPrivate is true', () => {
    render(<TeamForm open onClose={vi.fn()} editTeam={makeTeam({ isPrivate: true })} />);
    const cb = getPrivacyCheckbox() as HTMLInputElement;
    expect(cb.checked).toBe(false); // isPrivate=true → not discoverable → unchecked
  });

  it('renders unchecked (private) when editTeam.isPrivate is undefined (defaults private)', () => {
    render(<TeamForm open onClose={vi.fn()} editTeam={makeTeam({ isPrivate: undefined })} />);
    const cb = getPrivacyCheckbox() as HTMLInputElement;
    expect(cb.checked).toBe(false); // undefined → isPrivate=true → unchecked
  });
});

// ─── Persistence: isPrivate flows through to updateTeam ──────────────────────
// Checkbox semantics: checking "Make this team discoverable" sets isPrivate=false.
// Unchecking it sets isPrivate=true.

describe('TeamForm — isPrivate is written to updateTeam payload', () => {
  it('calls updateTeam with isPrivate: false when the discoverable checkbox is checked', async () => {
    const onClose = vi.fn();
    // Start with a private team (checkbox unchecked)
    render(<TeamForm open onClose={onClose} editTeam={makeTeam({ isPrivate: true })} />);

    const cb = getPrivacyCheckbox()!;
    fireEvent.click(cb); // check → make discoverable → isPrivate=false

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateTeam).toHaveBeenCalledOnce());

    const [savedTeam] = mockUpdateTeam.mock.calls[0] as [Team];
    expect(savedTeam.isPrivate).toBe(false);
  });

  it('calls updateTeam with isPrivate: true when the discoverable checkbox is unchecked', async () => {
    const onClose = vi.fn();
    // Start with a discoverable team (checkbox checked)
    render(<TeamForm open onClose={onClose} editTeam={makeTeam({ isPrivate: false })} />);

    const cb = getPrivacyCheckbox()!;
    fireEvent.click(cb); // uncheck → make private → isPrivate=true

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateTeam).toHaveBeenCalledOnce());

    const [savedTeam] = mockUpdateTeam.mock.calls[0] as [Team];
    expect(savedTeam.isPrivate).toBe(true);
  });

  it('calls updateTeam with isPrivate: false when checkbox was never touched on a non-private team', async () => {
    const onClose = vi.fn();
    render(<TeamForm open onClose={onClose} editTeam={makeTeam({ isPrivate: false })} />);

    // Do not interact with the checkbox
    const nameInput = screen.getByRole('textbox', { name: /team name/i });
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Renamed Team');

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateTeam).toHaveBeenCalledOnce());

    const [savedTeam] = mockUpdateTeam.mock.calls[0] as [Team];
    expect(savedTeam.isPrivate).toBe(false);
  });
});
