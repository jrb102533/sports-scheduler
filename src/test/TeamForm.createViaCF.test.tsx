/**
 * TeamForm — createTeamAndBecomeCoach CF routing
 *
 * Behaviors under test:
 *   New team (no logo)
 *     - calls createTeamAndBecomeCoach CF, NOT addTeam / updateTeam
 *     - does NOT pass coachId in CF payload (security check)
 *     - passes all expected fields to the CF
 *     - calls onClose() after successful CF call
 *   New team (with logo)
 *     - calls createTeamAndBecomeCoach CF with logoUrl after upload
 *     - does NOT pass coachId in CF payload
 *   Edit team
 *     - calls updateTeam store action (NOT the CF)
 *     - onClose() is called after save
 *   Validation
 *     - does not call CF when team name is empty
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Team } from '@/types';

// ─── Firebase stub ─────────────────────────────────────────────────────────────
const mockCallable = vi.fn();
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, _name: string) => mockCallable,
}));

const mockUploadBytes = vi.fn().mockResolvedValue({});
const mockGetDownloadURL = vi.fn().mockResolvedValue('https://storage.example.com/logo.png');
const mockDeleteObject = vi.fn().mockResolvedValue(undefined);
const mockRef = vi.fn((_storage: unknown, path: string) => ({ path }));

vi.mock('firebase/storage', () => ({
  ref: (...args: unknown[]) => mockRef(...args),
  uploadBytes: (...args: unknown[]) => mockUploadBytes(...args),
  getDownloadURL: (...args: unknown[]) => mockGetDownloadURL(...args),
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
}));

vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
  storage: {},
}));

// ─── Auth store ───────────────────────────────────────────────────────────────
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: { profile: { uid: string; displayName: string; email: string }; user: { uid: string } }) => unknown) =>
    selector({
      profile: { uid: 'uid-1', displayName: 'Jane Coach', email: 'jane@example.com' },
      user: { uid: 'uid-1' },
    }),
}));

// ─── Team store ───────────────────────────────────────────────────────────────
const mockUpdateTeam = vi.fn().mockResolvedValue(undefined);

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: () => ({ updateTeam: mockUpdateTeam }),
}));

// ─── Settings store ───────────────────────────────────────────────────────────
vi.mock('@/store/useSettingsStore', () => ({
  useSettingsStore: (selector: (s: { settings: { kidsSportsMode: boolean } }) => unknown) =>
    selector({ settings: { kidsSportsMode: false } }),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { TeamForm } from '@/components/teams/TeamForm';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    name: 'Existing Team',
    sportType: 'soccer',
    color: '#ef4444',
    createdBy: 'uid-1',
    ownerName: 'Jane Coach',
    coachId: 'uid-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    attendanceWarningsEnabled: true,
    ...overrides,
  };
}

function getNameInput() {
  return screen.getByRole('textbox', { name: /team name/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCallable.mockResolvedValue({ data: { teamId: 'new-team-id', newMembershipIndex: 0 } });
  mockUpdateTeam.mockResolvedValue(undefined);
});

// ─── Tests: new team (no logo) ────────────────────────────────────────────────

describe('TeamForm — new team calls CF (no logo)', () => {
  it('calls createTeamAndBecomeCoach CF when creating a new team', async () => {
    const onClose = vi.fn();
    render(<TeamForm open onClose={onClose} />);

    await userEvent.clear(getNameInput());
    await userEvent.type(getNameInput(), 'Thunder Hawks');

    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => {
      expect(mockCallable).toHaveBeenCalledOnce();
    });
    expect(mockUpdateTeam).not.toHaveBeenCalled();
  });

  it('does NOT pass coachId in the CF payload for a new team', async () => {
    const onClose = vi.fn();
    render(<TeamForm open onClose={onClose} />);

    await userEvent.clear(getNameInput());
    await userEvent.type(getNameInput(), 'Thunder Hawks');

    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => {
      expect(mockCallable).toHaveBeenCalledOnce();
    });

    const [payload] = mockCallable.mock.calls[0] as [Record<string, unknown>];
    expect(payload).not.toHaveProperty('coachId');
  });

  it('passes name, sportType, color, and attendanceWarningsEnabled to CF', async () => {
    const onClose = vi.fn();
    render(<TeamForm open onClose={onClose} />);

    await userEvent.clear(getNameInput());
    await userEvent.type(getNameInput(), 'Thunder Hawks');

    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => {
      expect(mockCallable).toHaveBeenCalledOnce();
    });

    const [payload] = mockCallable.mock.calls[0] as [Record<string, unknown>];
    expect(payload.name).toBe('Thunder Hawks');
    expect(payload.sportType).toBe('soccer');
    expect(typeof payload.color).toBe('string');
    expect(payload).toHaveProperty('attendanceWarningsEnabled');
  });

  it('calls onClose() after successful CF call', async () => {
    const onClose = vi.fn();
    render(<TeamForm open onClose={onClose} />);

    await userEvent.clear(getNameInput());
    await userEvent.type(getNameInput(), 'Thunder Hawks');

    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});

// ─── Tests: new team (with logo) ─────────────────────────────────────────────

describe('TeamForm — new team calls CF (with logo)', () => {
  it('calls CF with logoUrl when a logo is uploaded for a new team', async () => {
    const onClose = vi.fn();
    render(<TeamForm open onClose={onClose} />);

    await userEvent.clear(getNameInput());
    await userEvent.type(getNameInput(), 'Thunder Hawks');

    // Simulate logo file selection
    const file = new File(['img-bytes'], 'logo.png', { type: 'image/png' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => {
      expect(mockCallable).toHaveBeenCalledOnce();
    });

    const [payload] = mockCallable.mock.calls[0] as [Record<string, unknown>];
    expect(payload.logoUrl).toBe('https://storage.example.com/logo.png');
    expect(mockUpdateTeam).not.toHaveBeenCalled();
  });

  it('does NOT pass coachId in the CF payload when a logo is provided', async () => {
    const onClose = vi.fn();
    render(<TeamForm open onClose={onClose} />);

    await userEvent.clear(getNameInput());
    await userEvent.type(getNameInput(), 'Thunder Hawks');

    const file = new File(['img-bytes'], 'logo.png', { type: 'image/png' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => {
      expect(mockCallable).toHaveBeenCalledOnce();
    });

    const [payload] = mockCallable.mock.calls[0] as [Record<string, unknown>];
    expect(payload).not.toHaveProperty('coachId');
  });
});

// ─── Tests: edit team uses updateTeam (not CF) ────────────────────────────────

describe('TeamForm — edit team uses updateTeam, not CF', () => {
  it('calls updateTeam (not CF) when editing an existing team', async () => {
    const onClose = vi.fn();
    render(<TeamForm open onClose={onClose} editTeam={makeTeam()} />);

    // Modify the name to ensure save is triggered
    const nameInput = getNameInput();
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Updated Team Name');

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdateTeam).toHaveBeenCalledOnce();
    });
    expect(mockCallable).not.toHaveBeenCalled();
  });

  it('calls onClose() after successfully editing a team', async () => {
    const onClose = vi.fn();
    render(<TeamForm open onClose={onClose} editTeam={makeTeam()} />);

    const nameInput = getNameInput();
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Updated Team Name');

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});

// ─── Tests: validation guard ──────────────────────────────────────────────────

describe('TeamForm — validation prevents CF call', () => {
  it('does not call CF when team name is empty', async () => {
    const onClose = vi.fn();
    render(<TeamForm open onClose={onClose} />);

    // Name field is auto-populated; clear it
    await userEvent.clear(getNameInput());

    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => {
      expect(screen.getByText(/team name is required/i)).toBeInTheDocument();
    });
    expect(mockCallable).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
