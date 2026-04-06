/**
 * ProfilePage — TD #117
 *
 * Tests for first/last name validation: touched state, error visibility,
 * submit-time guard, and save button disabled state.
 *
 * Strategy: render ProfilePage with mocked Zustand stores. All four store
 * hooks are mocked at the module boundary so no Firebase connection is
 * needed. updateProfile is a vi.fn() spy — we assert it was or was not called.
 *
 * Mocking note: useAuthStore is called without a selector (destructured),
 * so the mock returns the state object directly. Other stores use selectors
 * and so receive the state as an argument.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserProfile } from '@/types';

// ── Mutable state shared across tests ─────────────────────────────────────────

const mockUpdateProfile = vi.fn().mockResolvedValue(undefined);
const mockLogout = vi.fn();
let currentProfile: UserProfile | null;

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'uid-1',
    email: 'coach@example.com',
    displayName: 'Jane Smith',
    role: 'coach',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Module mocks ──────────────────────────────────────────────────────────────
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector?: (s: object) => unknown) => {
    const state = { profile: currentProfile, updateProfile: mockUpdateProfile, logout: mockLogout };
    return selector ? selector(state) : state;
  },
  getMemberships: () => [],
}));

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector: (s: { teams: never[] }) => unknown) =>
    selector({ teams: [] }),
}));

vi.mock('@/store/useLeagueStore', () => ({
  useLeagueStore: (selector: (s: { leagues: never[] }) => unknown) =>
    selector({ leagues: [] }),
}));

vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (selector: (s: { players: never[] }) => unknown) =>
    selector({ players: [] }),
}));

// RoleCardPicker is a heavy sub-component not relevant to name validation.
vi.mock('@/components/auth/RoleCardPicker', () => ({
  ROLE_DEFINITIONS: [],
  RoleCardPicker: () => null,
}));

// ── Render helper ─────────────────────────────────────────────────────────────

 
let ProfilePage: typeof import('@/pages/ProfilePage').ProfilePage;

beforeEach(async () => {
  currentProfile = makeProfile();
  vi.clearAllMocks();
  mockUpdateProfile.mockResolvedValue(undefined);
  ({ ProfilePage } = await import('@/pages/ProfilePage'));
});

function renderPage() {
  return render(<ProfilePage />);
}

function getFirstNameInput() {
  return screen.getByRole('textbox', { name: /first name/i });
}

function getLastNameInput() {
  return screen.getByRole('textbox', { name: /last name/i });
}

function getSaveButton() {
  return screen.getByRole('button', { name: /save changes/i });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProfilePage — rendering', () => {
  it('renders without crashing when profile is populated', () => {
    renderPage();
    expect(getFirstNameInput()).toBeInTheDocument();
    expect(getLastNameInput()).toBeInTheDocument();
  });

  it('renders nothing when profile is null', () => {
    currentProfile = null;
    const { container } = renderPage();
    expect(container).toBeEmptyDOMElement();
  });

  it('pre-fills first name and last name from displayName', () => {
    renderPage();
    // 'Jane Smith' splits to firstName='Jane', lastName='Smith'
    expect(getFirstNameInput()).toHaveValue('Jane');
    expect(getLastNameInput()).toHaveValue('Smith');
  });
});

describe('ProfilePage — error visibility on blur', () => {
  it('does not show a first name error before the field is blurred', () => {
    currentProfile = makeProfile({ displayName: '' });
    renderPage();
    expect(screen.queryByText(/first name is required/i)).not.toBeInTheDocument();
  });

  it('does not show a last name error before the field is blurred', () => {
    currentProfile = makeProfile({ displayName: '' });
    renderPage();
    expect(screen.queryByText(/last name is required/i)).not.toBeInTheDocument();
  });

  it('shows "First name is required" after clearing first name and blurring', async () => {
    renderPage();
    const input = getFirstNameInput();
    await userEvent.clear(input);
    fireEvent.blur(input);
    expect(await screen.findByText(/first name is required/i)).toBeInTheDocument();
  });

  it('shows "Last name is required" after clearing last name and blurring', async () => {
    renderPage();
    const input = getLastNameInput();
    await userEvent.clear(input);
    fireEvent.blur(input);
    expect(await screen.findByText(/last name is required/i)).toBeInTheDocument();
  });

  it('does not show last name error when only first name field is blurred', async () => {
    currentProfile = makeProfile({ displayName: '' });
    renderPage();
    fireEvent.blur(getFirstNameInput());
    // Wait for first error to appear
    await screen.findByText(/first name is required/i);
    expect(screen.queryByText(/last name is required/i)).not.toBeInTheDocument();
  });

  it('does not show first name error when only last name field is blurred', async () => {
    currentProfile = makeProfile({ displayName: '' });
    renderPage();
    fireEvent.blur(getLastNameInput());
    // Wait for last name error to appear
    await screen.findByText(/last name is required/i);
    expect(screen.queryByText(/first name is required/i)).not.toBeInTheDocument();
  });
});

describe('ProfilePage — save button disabled state', () => {
  // TD #117: the button is no longer pre-disabled for empty names.
  // Instead, clicking it triggers inline validation errors. The button
  // stays disabled only when the composed name equals the saved displayName
  // (i.e. no change has been made).

  it('save button is enabled (not silently blocked) when first name is cleared', async () => {
    // Clearing first name produces ' Smith', which differs from 'Jane Smith',
    // so the "no changes" guard does not apply. Button must be enabled so
    // the user can click and receive the inline error.
    renderPage();
    await userEvent.clear(getFirstNameInput());
    expect(getSaveButton()).not.toBeDisabled();
  });

  it('save button is enabled (not silently blocked) when last name is cleared', async () => {
    // Clearing last name produces 'Jane ', which differs from 'Jane Smith'.
    renderPage();
    await userEvent.clear(getLastNameInput());
    expect(getSaveButton()).not.toBeDisabled();
  });

  it('save button is disabled when both fields are empty', () => {
    currentProfile = makeProfile({ displayName: '' });
    renderPage();
    expect(getSaveButton()).toBeDisabled();
  });

  it('save button is enabled after typing valid first and last names that differ from the saved display name', async () => {
    // Profile displayName is 'Jane Smith'; type a different name so the
    // "no changes" guard doesn't also disable the button.
    currentProfile = makeProfile({ displayName: 'Jane Smith' });
    renderPage();
    const firstInput = getFirstNameInput();
    const lastInput = getLastNameInput();
    await userEvent.clear(firstInput);
    await userEvent.type(firstInput, 'Jane');
    await userEvent.clear(lastInput);
    await userEvent.type(lastInput, 'Doe');
    expect(getSaveButton()).toBeEnabled();
  });
});

describe('ProfilePage — submit guard and save behaviour', () => {
  it('shows both errors when both fields are empty and each is blurred', async () => {
    currentProfile = makeProfile({ displayName: '' });
    renderPage();
    fireEvent.blur(getFirstNameInput());
    fireEvent.blur(getLastNameInput());
    expect(await screen.findByText(/first name is required/i)).toBeInTheDocument();
    expect(await screen.findByText(/last name is required/i)).toBeInTheDocument();
  });

  it('does not call updateProfile when Save is clicked with empty first name', async () => {
    renderPage();
    await userEvent.clear(getFirstNameInput());
    // Button is enabled; handleSave guard rejects the call and shows inline error.
    await userEvent.click(getSaveButton());
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('does not call updateProfile when Save is clicked with empty last name', async () => {
    renderPage();
    await userEvent.clear(getLastNameInput());
    await userEvent.click(getSaveButton());
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('shows inline errors when Save is clicked with empty first name', async () => {
    renderPage();
    await userEvent.clear(getFirstNameInput());
    await userEvent.click(getSaveButton());
    expect(await screen.findByText(/first name is required/i)).toBeInTheDocument();
  });

  it('shows inline errors when Save is clicked with empty last name', async () => {
    renderPage();
    await userEvent.clear(getLastNameInput());
    await userEvent.click(getSaveButton());
    expect(await screen.findByText(/last name is required/i)).toBeInTheDocument();
  });

  it('calls updateProfile with the combined displayName when both fields are valid', async () => {
    // Use a display name that differs from the input so the "unchanged" guard
    // does not disable the button.
    currentProfile = makeProfile({ displayName: 'Old Name' });
    renderPage();

    const firstInput = getFirstNameInput();
    const lastInput = getLastNameInput();

    // Initial values from 'Old Name': firstName='Old', lastName='Name'
    // Type new values.
    await userEvent.clear(firstInput);
    await userEvent.type(firstInput, 'Jane');
    await userEvent.clear(lastInput);
    await userEvent.type(lastInput, 'Doe');

    await userEvent.click(getSaveButton());

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({ displayName: 'Jane Doe' });
    });
  });

  it('trims whitespace from names before calling updateProfile', async () => {
    currentProfile = makeProfile({ displayName: 'Old Name' });
    renderPage();

    await userEvent.clear(getFirstNameInput());
    await userEvent.type(getFirstNameInput(), '  Jane  ');
    await userEvent.clear(getLastNameInput());
    await userEvent.type(getLastNameInput(), '  Doe  ');

    await userEvent.click(getSaveButton());

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({ displayName: 'Jane Doe' });
    });
  });
});
