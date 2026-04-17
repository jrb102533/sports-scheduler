/**
 * SnackVolunteerForm — behaviour tests
 *
 * Behaviours under test:
 *   A) Visibility guard
 *      - Renders nothing when no snackItem, not canManage, and no signups (parent role)
 *      - Renders when canManage (coach/admin/lm) even with no snackItem and no signups
 *      - Renders for any role when snackItem is set on the event
 *      - Renders for any role when signups already exist
 *   B) Snack request display
 *      - Shows "Requested: orange slices" when event.snackItem is set
 *   C) Sign up form — validation
 *      - Shows "Your name is required" when name field is empty
 *      - Shows "Please enter what you're bringing" when bringing field is empty
 *      - Does not call updateEvent when validation fails
 *   D) Successful sign up
 *      - Calls updateEvent with the new signup appended to snackSignups
 *      - Closes the sign-up form after successful submission
 *   E) Removal (canManage only)
 *      - Trash button present for canManage roles next to each signup
 *      - Clicking trash calls updateEvent without the removed signup
 *      - Trash button absent for non-manager roles
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScheduledEvent, UserProfile } from '@/types';

// ── Firebase mock ──────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {} }));

// ── Store mocks ────────────────────────────────────────────────────────────────

const mockUpdateEvent = vi.fn().mockResolvedValue(undefined);

vi.mock('@/store/useEventStore', () => ({
  useEventStore: (sel?: (s: Record<string, unknown>) => unknown) => {
    const state = { updateEvent: mockUpdateEvent, events: [], addEvent: vi.fn() };
    return sel ? sel(state) : state;
  },
}));

let currentProfile: UserProfile | null = null;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (sel: (s: { profile: typeof currentProfile }) => unknown) =>
    sel({ profile: currentProfile }),
}));

// ── Import after mocks ─────────────────────────────────────────────────────────

import { SnackVolunteerForm } from './SnackVolunteerForm';

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    id: 'event-1',
    title: 'Practice',
    type: 'practice',
    status: 'scheduled',
    date: '2026-06-01',
    startTime: '10:00',
    teamIds: ['team-1'],
    isRecurring: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ScheduledEvent;
}

function makeProfile(role: UserProfile['role'], displayName = 'Test User'): UserProfile {
  return {
    uid: 'uid-1',
    email: 'test@example.com',
    displayName,
    role,
    teamId: 'team-1',
    createdAt: '2024-01-01T00:00:00.000Z',
  } as UserProfile;
}

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = null;
});

// ── A. Visibility guard ────────────────────────────────────────────────────────

describe('SnackVolunteerForm — visibility guard', () => {
  it('renders nothing for a parent with no snackItem and no signups', () => {
    currentProfile = makeProfile('parent');
    const { container } = render(<SnackVolunteerForm event={makeEvent()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a player with no snackItem and no signups', () => {
    currentProfile = makeProfile('player');
    const { container } = render(<SnackVolunteerForm event={makeEvent()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders for a coach even with no snackItem and no signups', () => {
    currentProfile = makeProfile('coach');
    render(<SnackVolunteerForm event={makeEvent()} />);
    expect(screen.getByText('Snack Volunteer')).toBeInTheDocument();
  });

  it('renders for an admin even with no snackItem and no signups', () => {
    currentProfile = makeProfile('admin');
    render(<SnackVolunteerForm event={makeEvent()} />);
    expect(screen.getByText('Snack Volunteer')).toBeInTheDocument();
  });

  it('renders for a league_manager even with no snackItem and no signups', () => {
    currentProfile = makeProfile('league_manager');
    render(<SnackVolunteerForm event={makeEvent()} />);
    expect(screen.getByText('Snack Volunteer')).toBeInTheDocument();
  });

  it('renders for a parent when snackItem is set on the event', () => {
    currentProfile = makeProfile('parent');
    render(<SnackVolunteerForm event={makeEvent({ snackItem: 'Orange slices' })} />);
    expect(screen.getByText('Snack Volunteer')).toBeInTheDocument();
  });

  it('renders for a player when existing signups are present', () => {
    currentProfile = makeProfile('player');
    render(
      <SnackVolunteerForm
        event={makeEvent({
          snackSignups: [{ id: 'su-1', name: 'Alice', bringing: 'Juice', signedUpAt: '2026-01-01T00:00:00.000Z' }],
        })}
      />
    );
    expect(screen.getByText('Snack Volunteer')).toBeInTheDocument();
  });
});

// ── B. Snack request display ───────────────────────────────────────────────────

describe('SnackVolunteerForm — snack request display', () => {
  it('shows the requested snack item', () => {
    currentProfile = makeProfile('parent');
    render(<SnackVolunteerForm event={makeEvent({ snackItem: 'Orange slices' })} />);
    expect(screen.getByText(/orange slices/i)).toBeInTheDocument();
    expect(screen.getByText(/requested/i)).toBeInTheDocument();
  });

  it('does not show the requested section when snackItem is not set', () => {
    currentProfile = makeProfile('coach');
    render(<SnackVolunteerForm event={makeEvent({ snackItem: '' })} />);
    expect(screen.queryByText(/requested/i)).not.toBeInTheDocument();
  });
});

// ── C. Sign up form — validation ───────────────────────────────────────────────

describe('SnackVolunteerForm — sign up form validation', () => {
  beforeEach(() => {
    currentProfile = makeProfile('parent', '');
  });

  async function openSignupForm() {
    const user = userEvent.setup();
    render(<SnackVolunteerForm event={makeEvent({ snackItem: 'Juice boxes' })} />);
    await user.click(screen.getByRole('button', { name: /sign up/i }));
    return user;
  }

  it('shows "Your name is required" when name field is empty and Sign Up is clicked', async () => {
    const user = await openSignupForm();
    // Name field is empty (profile.displayName is ''), bringing is pre-filled by snackItem
    // Clear bringing too so we hit name validation first
    const bringingInput = screen.getByPlaceholderText(/juice boxes/i);
    await user.clear(bringingInput);

    await user.click(screen.getByRole('button', { name: /^sign up$/i }));
    expect(screen.getByText(/your name is required/i)).toBeInTheDocument();
    expect(mockUpdateEvent).not.toHaveBeenCalled();
  });

  it('shows "Please enter what you\'re bringing" when bringing field is empty', async () => {
    const user = await openSignupForm();
    const nameInput = screen.getByPlaceholderText(/your name/i);
    await user.type(nameInput, 'Alice');

    const bringingInput = screen.getByPlaceholderText(/juice boxes/i);
    await user.clear(bringingInput);

    await user.click(screen.getByRole('button', { name: /^sign up$/i }));
    expect(screen.getByText(/please enter what you're bringing/i)).toBeInTheDocument();
    expect(mockUpdateEvent).not.toHaveBeenCalled();
  });
});

// ── D. Successful sign up ──────────────────────────────────────────────────────

describe('SnackVolunteerForm — successful sign up', () => {
  it('calls updateEvent with the new signup when form is filled out and submitted', async () => {
    currentProfile = makeProfile('parent', 'Bob');
    const user = userEvent.setup();
    render(<SnackVolunteerForm event={makeEvent({ snackItem: 'Juice boxes' })} />);

    await user.click(screen.getByRole('button', { name: /sign up/i }));

    const nameInput = screen.getByPlaceholderText(/your name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Bob');

    await user.click(screen.getByRole('button', { name: /^sign up$/i }));

    await waitFor(() => {
      expect(mockUpdateEvent).toHaveBeenCalledOnce();
    });

    const [updatedEvent] = mockUpdateEvent.mock.calls[0] as [ScheduledEvent];
    expect(updatedEvent.snackSignups).toHaveLength(1);
    expect(updatedEvent.snackSignups![0].name).toBe('Bob');
    expect(updatedEvent.snackSignups![0].bringing).toBe('Juice boxes');
  });

  it('closes the signup form after successful submission', async () => {
    currentProfile = makeProfile('parent', 'Charlie');
    const user = userEvent.setup();
    render(<SnackVolunteerForm event={makeEvent({ snackItem: 'Juice boxes' })} />);

    await user.click(screen.getByRole('button', { name: /sign up/i }));
    await user.click(screen.getByRole('button', { name: /^sign up$/i }));

    await waitFor(() => {
      // The form inputs should no longer be visible
      expect(screen.queryByPlaceholderText(/your name/i)).not.toBeInTheDocument();
    });
  });
});

// ── E. Removal (canManage only) ────────────────────────────────────────────────

describe('SnackVolunteerForm — signup removal', () => {
  const eventWithSignup = makeEvent({
    snackSignups: [
      { id: 'su-1', name: 'Alice', bringing: 'Juice', signedUpAt: '2026-01-01T00:00:00.000Z' },
    ],
    snackItem: 'Juice',
  });

  it('shows a remove (trash) button for a coach next to each signup', () => {
    currentProfile = makeProfile('coach');
    render(<SnackVolunteerForm event={eventWithSignup} />);
    // Trash2 button — no accessible name, but it is a button element next to the signup
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2); // "Sign up" + at least 1 trash
  });

  it('calls updateEvent without the removed signup when trash is clicked', async () => {
    currentProfile = makeProfile('coach');
    const user = userEvent.setup();
    render(<SnackVolunteerForm event={eventWithSignup} />);

    // The trash button has no accessible text — find all buttons and click the first non-"Sign up" one
    const allButtons = screen.getAllByRole('button');
    const trashButton = allButtons.find(btn => !btn.textContent?.includes('Sign up'));
    expect(trashButton).toBeDefined();
    await user.click(trashButton!);

    await waitFor(() => {
      expect(mockUpdateEvent).toHaveBeenCalledOnce();
    });
    const [updatedEvent] = mockUpdateEvent.mock.calls[0] as [ScheduledEvent];
    expect(updatedEvent.snackSignups).toHaveLength(0);
  });

  it('does not show trash buttons for a parent (non-manager)', () => {
    currentProfile = makeProfile('parent');
    // Parent can see the form because signups exist
    render(<SnackVolunteerForm event={eventWithSignup} />);
    // Only the "Sign up" button should be present, no trash
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1); // just "Sign up"
  });
});
