/**
 * TeamForm — new behaviors from the core/advanced tier refactor
 *
 * Behaviors under test:
 *   Advanced section collapse/expand
 *     1. Advanced section ("More details") is collapsed by default on create
 *     2. Advanced section is collapsed by default when editing a team with no advanced values
 *     3. Advanced section auto-expands when editing a team that has a homeVenue value
 *     4. Advanced section auto-expands when editing a team that has a coachName value
 *     5. Advanced section auto-expands when editing a team that has a logoUrl value
 *     6. Advanced section auto-expands when editing a team that has attendanceWarningsEnabled=false
 *     7. Advanced section auto-expands when editing a team that has a custom attendanceWarningThreshold
 *     8. Clicking "More details" expands the section and reveals coach fields
 *     9. Clicking "More details" again collapses the section
 *
 *   onCreated callback
 *    10. onCreated is called with the teamId returned by the CF after successful create
 *    11. onCreated is NOT called when the CF rejects
 *    12. onCreated is NOT called when validation fails
 *    13. onClose is called after onCreated (both fire on success)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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

// ─── Auth store ───────────────────────────────────────────────────────────────
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (sel: (s: { profile: { uid: string; displayName: string; email: string; role: string }; user: { uid: string } }) => unknown) =>
    sel({
      profile: { uid: 'uid-coach', displayName: 'Coach A', email: 'coach@example.com', role: 'coach' },
      user: { uid: 'uid-coach' },
    }),
}));

// ─── Team store ───────────────────────────────────────────────────────────────
const mockUpdateTeam = vi.fn().mockResolvedValue(undefined);

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (sel?: (s: object) => unknown) => {
    const state = { updateTeam: mockUpdateTeam };
    return sel ? sel(state) : state;
  },
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

// ─── Import after mocks ───────────────────────────────────────────────────────
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

function getAdvancedToggle() {
  return screen.getByRole('button', { name: /more details/i });
}

function isAdvancedOpen() {
  // The toggle button has aria-expanded on it
  return getAdvancedToggle().getAttribute('aria-expanded') === 'true';
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCallable.mockResolvedValue({ data: { teamId: 'new-team-id' } });
  mockUpdateTeam.mockResolvedValue(undefined);
});

// ─── Advanced section collapse/expand ─────────────────────────────────────────

describe('TeamForm — advanced section default state', () => {
  it('is collapsed by default when creating a new team', () => {
    render(<MemoryRouter><TeamForm open onClose={vi.fn()} /></MemoryRouter>);
    expect(isAdvancedOpen()).toBe(false);
  });

  it('is collapsed when editing a team with no advanced field values', () => {
    render(
      <MemoryRouter>
        <TeamForm
          open
          onClose={vi.fn()}
          editTeam={makeTeam({
            homeVenue: undefined,
            homeVenueId: undefined,
            coachName: undefined,
            coachEmail: undefined,
            logoUrl: undefined,
            attendanceWarningsEnabled: true,
            attendanceWarningThreshold: undefined,
          })}
        />
      </MemoryRouter>
    );
    expect(isAdvancedOpen()).toBe(false);
  });

  it('auto-expands when editing a team that has a homeVenue', () => {
    render(<MemoryRouter><TeamForm open onClose={vi.fn()} editTeam={makeTeam({ homeVenue: 'City Park' })} /></MemoryRouter>);
    expect(isAdvancedOpen()).toBe(true);
  });

  it('auto-expands when editing a team that has a coachName', () => {
    render(<MemoryRouter><TeamForm open onClose={vi.fn()} editTeam={makeTeam({ coachName: 'Jane Smith' })} /></MemoryRouter>);
    expect(isAdvancedOpen()).toBe(true);
  });

  it('auto-expands when editing a team that has a logoUrl', () => {
    render(
      <MemoryRouter>
        <TeamForm
          open
          onClose={vi.fn()}
          editTeam={makeTeam({ logoUrl: 'https://example.com/logo.png' })}
        />
      </MemoryRouter>
    );
    expect(isAdvancedOpen()).toBe(true);
  });

  it('auto-expands when editing a team where attendance warnings are disabled', () => {
    // attendanceWarningsEnabled=false is a non-default value that signals the user
    // previously made an advanced change.
    render(
      <MemoryRouter>
        <TeamForm
          open
          onClose={vi.fn()}
          editTeam={makeTeam({ attendanceWarningsEnabled: false })}
        />
      </MemoryRouter>
    );
    expect(isAdvancedOpen()).toBe(true);
  });

  it('auto-expands when editing a team with a custom attendanceWarningThreshold', () => {
    render(
      <MemoryRouter>
        <TeamForm
          open
          onClose={vi.fn()}
          editTeam={makeTeam({ attendanceWarningThreshold: 6 })}
        />
      </MemoryRouter>
    );
    expect(isAdvancedOpen()).toBe(true);
  });
});

describe('TeamForm — advanced section toggle interaction', () => {
  it('expands the section and reveals coach fields when "More details" is clicked', () => {
    render(<MemoryRouter><TeamForm open onClose={vi.fn()} /></MemoryRouter>);

    expect(screen.queryByRole('textbox', { name: /coach name/i })).not.toBeInTheDocument();

    fireEvent.click(getAdvancedToggle());

    expect(isAdvancedOpen()).toBe(true);
    expect(screen.getByRole('textbox', { name: /coach name/i })).toBeInTheDocument();
  });

  it('collapses the section again when "More details" is clicked a second time', () => {
    render(<MemoryRouter><TeamForm open onClose={vi.fn()} /></MemoryRouter>);

    fireEvent.click(getAdvancedToggle()); // expand
    expect(isAdvancedOpen()).toBe(true);

    fireEvent.click(getAdvancedToggle()); // collapse
    expect(isAdvancedOpen()).toBe(false);
    expect(screen.queryByRole('textbox', { name: /coach name/i })).not.toBeInTheDocument();
  });
});

// ─── onCreated callback ───────────────────────────────────────────────────────

describe('TeamForm — onCreated callback', () => {
  it('calls onCreated with the teamId returned by the CF on successful create', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    mockCallable.mockResolvedValue({ data: { teamId: 'returned-team-id' } });

    render(<MemoryRouter><TeamForm open onClose={onClose} onCreated={onCreated} /></MemoryRouter>);

    await userEvent.type(screen.getByRole('textbox', { name: /team name/i }), 'Thunder Hawks');
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(onCreated).toHaveBeenCalledWith('returned-team-id');
  });

  it('calls onClose after onCreated on successful create', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();

    render(<MemoryRouter><TeamForm open onClose={onClose} onCreated={onCreated} /></MemoryRouter>);

    await userEvent.type(screen.getByRole('textbox', { name: /team name/i }), 'Thunder Hawks');
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    // Both must fire; onCreated fires first per implementation
    expect(onCreated).toHaveBeenCalledOnce();
  });

  it('does NOT call onCreated when the CF rejects', async () => {
    const onCreated = vi.fn();
    mockCallable.mockRejectedValueOnce(new Error('Network error'));

    render(<MemoryRouter><TeamForm open onClose={vi.fn()} onCreated={onCreated} /></MemoryRouter>);

    await userEvent.type(screen.getByRole('textbox', { name: /team name/i }), 'Thunder Hawks');
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => expect(screen.getByText(/network error/i)).toBeInTheDocument());
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('does NOT call onCreated when validation fails (team name empty)', async () => {
    const onCreated = vi.fn();
    render(<MemoryRouter><TeamForm open onClose={vi.fn()} onCreated={onCreated} /></MemoryRouter>);

    // Name input is pre-filled from profile — clear it
    await userEvent.clear(screen.getByRole('textbox', { name: /team name/i }));
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => expect(screen.getByText(/team name is required/i)).toBeInTheDocument());
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('works correctly when onCreated prop is omitted (no crash)', async () => {
    // onCreated is optional — the form should work fine without it
    const onClose = vi.fn();
    render(<MemoryRouter><TeamForm open onClose={onClose} /></MemoryRouter>);

    await userEvent.type(screen.getByRole('textbox', { name: /team name/i }), 'Thunder Hawks');
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});
