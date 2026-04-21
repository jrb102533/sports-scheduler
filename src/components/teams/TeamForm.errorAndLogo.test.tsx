/**
 * TeamForm — CF error banner and logo file validation
 *
 * Behaviours under test:
 *   A) CF error shows error banner and form stays open
 *      - Error message appears when createTeamAndBecomeCoach rejects
 *      - "Missing or insufficient permissions" maps to friendly message
 *      - onClose is NOT called when the CF rejects
 *   B) Logo file validation
 *      - Disallowed file type shows error (e.g. .txt)
 *      - File over 2 MB shows error
 *      - Valid file clears any previous logo error
 *   C) Logo removal
 *      - Clicking Remove clears the preview and sets removeLogo state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Team } from '@/types';

// ── Firebase stubs ─────────────────────────────────────────────────────────────

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

// ── Store mocks ────────────────────────────────────────────────────────────────

const mockUpdateTeam = vi.fn().mockResolvedValue(undefined);

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (sel?: (s: object) => unknown) => {
    const state = { updateTeam: mockUpdateTeam };
    return sel ? sel(state) : state;
  },
}));

vi.mock('@/store/useSettingsStore', () => ({
  useSettingsStore: (sel: (s: { settings: { kidsSportsMode: boolean } }) => unknown) =>
    sel({ settings: { kidsSportsMode: false } }),
}));

vi.mock('@/store/useVenueStore', () => {
  const subscribe = vi.fn().mockReturnValue(() => {});
  const useVenueStore = (sel?: (s: { venues: never[]; subscribe: typeof subscribe }) => unknown) => {
    const state = { venues: [] as never[], subscribe };
    return sel ? sel(state) : state;
  };
  useVenueStore.getState = () => ({ venues: [] as never[], subscribe });
  return { useVenueStore };
});

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (sel: (s: { profile: { uid: string; displayName: string; email: string; role: string }; user: { uid: string } }) => unknown) =>
    sel({
      profile: { uid: 'uid-1', displayName: 'Jane Coach', email: 'jane@example.com', role: 'coach' },
      user: { uid: 'uid-1' },
    }),
}));

// ── Import after mocks ─────────────────────────────────────────────────────────

import { TeamForm } from './TeamForm';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    name: 'Thunder FC',
    sportType: 'soccer',
    color: '#ef4444',
    createdBy: 'uid-1',
    ownerName: 'Jane Coach',
    coachId: 'uid-1',
    attendanceWarningsEnabled: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function getNameInput() {
  return screen.getByRole('textbox', { name: /team name/i });
}

/** Opens the Advanced section and returns the hidden file input. */
function openAdvancedAndGetFileInput() {
  const toggle = screen.getByRole('button', { name: /more details/i });
  fireEvent.click(toggle);
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCallable.mockResolvedValue({ data: { teamId: 'new-team-id' } });
  mockUpdateTeam.mockResolvedValue(undefined);
});

// ── A. CF error banner ─────────────────────────────────────────────────────────

describe('TeamForm — CF error shows error banner', () => {
  it('shows error banner when createTeamAndBecomeCoach rejects', async () => {
    mockCallable.mockRejectedValueOnce(new Error('Something went wrong'));
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TeamForm open onClose={onClose} />);

    await user.clear(getNameInput());
    await user.type(getNameInput(), 'New Team');

    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
  });

  it('does NOT call onClose when CF rejects', async () => {
    mockCallable.mockRejectedValueOnce(new Error('Network error'));
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TeamForm open onClose={onClose} />);

    await user.clear(getNameInput());
    await user.type(getNameInput(), 'New Team');

    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('maps "Missing or insufficient permissions" to a friendly message', async () => {
    mockCallable.mockRejectedValueOnce(
      new Error('Missing or insufficient permissions to perform this action')
    );
    const user = userEvent.setup();
    render(<TeamForm open onClose={vi.fn()} />);

    await user.clear(getNameInput());
    await user.type(getNameInput(), 'New Team');

    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => {
      expect(screen.getByText(/permission denied/i)).toBeInTheDocument();
    });
  });

  it('shows error banner when updateTeam rejects in edit mode', async () => {
    mockUpdateTeam.mockRejectedValueOnce(new Error('Write failed'));
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TeamForm open onClose={onClose} editTeam={makeTeam()} />);

    const nameInput = getNameInput();
    await user.clear(nameInput);
    await user.type(nameInput, 'Renamed Team');

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText(/write failed/i)).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ── B. Logo file validation ────────────────────────────────────────────────────

describe('TeamForm — logo file validation', () => {
  it('shows error when an unsupported file type is selected', () => {
    render(<TeamForm open onClose={vi.fn()} />);

    // Use fireEvent.change to bypass the `accept` attribute filter that
    // userEvent.upload would apply. The component validates MIME type itself.
    // The Advanced section must be expanded first — the file input is inside it.
    const file = new File(['text content'], 'notes.txt', { type: 'text/plain' });
    const input = openAdvancedAndGetFileInput();
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    expect(screen.getByText(/file must be an image/i)).toBeInTheDocument();
  });

  it('shows error when file exceeds 2 MB size limit', () => {
    render(<TeamForm open onClose={vi.fn()} />);

    // jsdom's File constructor doesn't enforce actual byte length for the size
    // property — define it explicitly.
    const file = new File(['x'], 'big-logo.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 2 * 1024 * 1024 + 1 });
    const input = openAdvancedAndGetFileInput();
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    expect(screen.getByText(/under 2 mb/i)).toBeInTheDocument();
  });

  it('clears logo error when a valid file is subsequently selected', () => {
    render(<TeamForm open onClose={vi.fn()} />);
    const input = openAdvancedAndGetFileInput();

    // First upload an invalid file to trigger the error
    const bad = new File(['txt'], 'doc.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [bad], configurable: true });
    fireEvent.change(input);
    expect(screen.getByText(/file must be an image/i)).toBeInTheDocument();

    // Now upload a valid file
    const good = new File(['img-bytes'], 'logo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [good], configurable: true });
    fireEvent.change(input);

    expect(screen.queryByText(/file must be an image/i)).not.toBeInTheDocument();
  });

  it('shows logo preview after a valid image file is selected', async () => {
    const user = userEvent.setup();
    render(<TeamForm open onClose={vi.fn()} />);

    // Expand the Advanced section before accessing the file input
    fireEvent.click(screen.getByRole('button', { name: /more details/i }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['img-bytes'], 'logo.png', { type: 'image/png' });
    await user.upload(fileInput, file);

    expect(screen.getByRole('img', { name: /team logo/i })).toBeInTheDocument();
  });
});

// ── C. Logo removal ───────────────────────────────────────────────────────────

describe('TeamForm — logo removal', () => {
  it('hides the logo preview after Remove is clicked', async () => {
    const user = userEvent.setup();
    // Start with an existing logo to exercise the remove path
    render(<TeamForm open onClose={vi.fn()} editTeam={makeTeam({ logoUrl: 'https://example.com/logo.png' })} />);

    expect(screen.getByRole('img', { name: /team logo/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /remove/i }));

    expect(screen.queryByRole('img', { name: /team logo/i })).not.toBeInTheDocument();
  });
});
