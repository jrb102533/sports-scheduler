/**
 * HomePage — unified home page
 *
 * Behaviors under test:
 *   Rendering states
 *     - Loading skeleton shown while teams/events are loading
 *     - Empty "My Teams" state for coach/admin when no teams exist
 *     - Empty "My Teams" state for parent/player when no teams exist
 *     - "Create your first team" button present for coach/admin empty state only
 *     - "No upcoming events" empty state rendered when team exists but no events
 *     - Team cards render when teams exist
 *     - Upcoming events list renders when events exist
 *
 *   Greeting
 *     - Shows first name when profile has displayName
 *     - Falls back gracefully when displayName is absent
 *
 *   Team card navigation (handleTeamClick)
 *     - Coach navigates to /teams
 *     - Admin navigates to /teams (isCoachOrAbove)
 *     - league_manager navigates to /teams (isCoachOrAbove)
 *     - Player navigates to /parent
 *     - Parent navigates to /parent
 *
 *   Team resolution (resolveTeamsForMembership)
 *     - Admin sees all teams
 *     - Coach sees only their team
 *     - Player/parent sees only their teamId team
 *     - Teams are deduplicated across multiple memberships
 *
 *   Event filtering
 *     - Cancelled events are excluded from upcoming list
 *     - Events on other teams (not in myTeams) are excluded
 *     - Events are limited to 7 items
 *
 *   "Create your first team" CTA
 *     - Navigates to /teams when clicked
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile, Team, ScheduledEvent } from '@/types';

// ─── Firebase stub ─────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
}));

// ─── navigate spy ─────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// ─── Auth store ───────────────────────────────────────────────────────────────
let currentProfile: UserProfile | null = null;

// Real getMemberships / hasRole logic is needed for resolveTeamsForMembership
// and isCoachOrAbove checks in HomePage. We import the real helpers but stub
// only the Firestore-reaching store itself.
vi.mock('@/store/useAuthStore', async () => {
  const real = await vi.importActual<typeof import('@/store/useAuthStore')>('@/store/useAuthStore');
  return {
    ...real,
    useAuthStore: (selector: (s: { profile: UserProfile | null }) => unknown) =>
      selector({ profile: currentProfile }),
  };
});

// ─── Team store ───────────────────────────────────────────────────────────────
let currentTeams: Team[] = [];
let teamsLoading = false;

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector: (s: { teams: Team[]; loading: boolean }) => unknown) =>
    selector({ teams: currentTeams, loading: teamsLoading }),
}));

// ─── Event store ──────────────────────────────────────────────────────────────
let currentEvents: ScheduledEvent[] = [];
let eventsLoading = false;

vi.mock('@/store/useEventStore', () => ({
  useEventStore: (selector: (s: { events: ScheduledEvent[]; loading: boolean }) => unknown) =>
    selector({ events: currentEvents, loading: eventsLoading }),
}));

// ─── EventDetailPanel / EventCard — stub heavy sub-trees ─────────────────────
vi.mock('@/components/events/EventDetailPanel', () => ({
  EventDetailPanel: () => null,
}));

vi.mock('@/components/events/EventCard', () => ({
  EventCard: ({ event, onClick }: { event: ScheduledEvent; onClick: () => void }) => (
    <button data-testid={`event-card-${event.id}`} onClick={onClick}>
      {event.title}
    </button>
  ),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { HomePage } from '@/pages/HomePage';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeProfile(
  role: UserProfile['role'],
  overrides: Partial<UserProfile> = {}
): UserProfile {
  return {
    uid: 'uid-1',
    email: 'user@example.com',
    displayName: 'Jane Coach',
    role,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTeam(id: string, overrides: Partial<Team> = {}): Team {
  return {
    id,
    name: `Team ${id}`,
    sportType: 'soccer',
    color: '#1d4ed8',
    createdBy: 'uid-1',
    ownerName: 'Jane Coach',
    coachId: 'uid-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Use a date well in the future so isUpcoming() always returns true
function makeEvent(id: string, teamId: string, overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    id,
    title: `Event ${id}`,
    date: '2099-12-31',
    startTime: '10:00',
    endTime: '11:00',
    type: 'game',
    status: 'scheduled',
    teamIds: [teamId],
    createdBy: 'uid-1',
    ...overrides,
  } as ScheduledEvent;
}

function renderHomePage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  );
}

// ─── Reset ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = null;
  currentTeams = [];
  currentEvents = [];
  teamsLoading = false;
  eventsLoading = false;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HomePage — loading state', () => {
  it('shows skeleton placeholders while teams are loading', () => {
    currentProfile = makeProfile('coach');
    teamsLoading = true;
    renderHomePage();

    // Skeleton divs have animate-pulse class — there should be multiple
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows skeleton placeholders while events are loading', () => {
    currentProfile = makeProfile('coach');
    eventsLoading = true;
    renderHomePage();

    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});

describe('HomePage — greeting', () => {
  it('personalises greeting with the first name from displayName', () => {
    currentProfile = makeProfile('coach', { displayName: 'Maria Rodriguez' });
    renderHomePage();

    expect(screen.getByText(/Maria/)).toBeTruthy();
  });

  it('renders greeting without a name when displayName is absent', () => {
    currentProfile = makeProfile('coach', { displayName: '' });
    renderHomePage();

    // Should not throw and should show one of the time-based greetings
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toMatch(/Good (morning|afternoon|evening)$/);
  });
});

describe('HomePage — empty state (no teams)', () => {
  it('shows coach-specific empty message when coach has no teams', () => {
    currentProfile = makeProfile('coach');
    renderHomePage();

    expect(screen.getByText('You have no teams yet.')).toBeTruthy();
    expect(screen.getByText('Create your first team to get started.')).toBeTruthy();
  });

  it('shows admin banner instead of empty-state when admin has no teams', () => {
    currentProfile = makeProfile('admin');
    renderHomePage();

    expect(screen.getByText(/you have admin access to all teams/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /go to teams/i })).toBeTruthy();
  });

  it('shows league_manager-specific empty message when league_manager has no teams', () => {
    currentProfile = makeProfile('league_manager');
    renderHomePage();

    expect(screen.getByText('You have no teams yet.')).toBeTruthy();
  });

  it('shows parent-specific empty message when parent has no teams', () => {
    currentProfile = makeProfile('parent');
    renderHomePage();

    expect(screen.getByText('You are not linked to a team yet.')).toBeTruthy();
    expect(screen.getByText('Ask your coach to send you an invite.')).toBeTruthy();
  });

  it('shows player-specific empty message when player has no teams', () => {
    currentProfile = makeProfile('player');
    renderHomePage();

    expect(screen.getByText('You are not linked to a team yet.')).toBeTruthy();
  });

  it('shows "Create your first team" button only for coach/admin/league_manager', () => {
    currentProfile = makeProfile('parent');
    renderHomePage();

    expect(screen.queryByRole('button', { name: /create your first team/i })).toBeNull();
  });

  it('shows "Create your first team" button for coach', () => {
    currentProfile = makeProfile('coach');
    renderHomePage();

    expect(screen.getByRole('button', { name: /create your first team/i })).toBeTruthy();
  });

  it('"Create your first team" button navigates to /teams', () => {
    currentProfile = makeProfile('coach');
    renderHomePage();

    fireEvent.click(screen.getByRole('button', { name: /create your first team/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/teams');
  });

  it('shows no-events empty state referencing "join a team" when teams is empty', () => {
    currentProfile = makeProfile('coach');
    renderHomePage();

    expect(screen.getByText(/join a team to see your schedule/i)).toBeTruthy();
  });
});

describe('HomePage — team cards rendered', () => {
  it('renders a card for each resolved team', () => {
    currentProfile = makeProfile('coach');
    currentTeams = [makeTeam('t1'), makeTeam('t2')];
    renderHomePage();

    expect(screen.getByText('Team t1')).toBeTruthy();
    expect(screen.getByText('Team t2')).toBeTruthy();
  });

  it('shows "No upcoming events scheduled." when team exists but no events', () => {
    currentProfile = makeProfile('coach');
    currentTeams = [makeTeam('t1')];
    currentEvents = [];
    renderHomePage();

    expect(screen.getByText('No upcoming events scheduled.')).toBeTruthy();
  });

  it('renders event cards for upcoming events on the user\'s teams', () => {
    currentProfile = makeProfile('coach');
    currentTeams = [makeTeam('t1')];
    currentEvents = [makeEvent('e1', 't1'), makeEvent('e2', 't1')];
    renderHomePage();

    expect(screen.getByTestId('event-card-e1')).toBeTruthy();
    expect(screen.getByTestId('event-card-e2')).toBeTruthy();
  });

  it('excludes cancelled events from the upcoming list', () => {
    currentProfile = makeProfile('coach');
    currentTeams = [makeTeam('t1')];
    currentEvents = [makeEvent('e1', 't1', { status: 'cancelled' })];
    renderHomePage();

    expect(screen.queryByTestId('event-card-e1')).toBeNull();
    expect(screen.getByText('No upcoming events scheduled.')).toBeTruthy();
  });

  it('excludes events for teams the user does not belong to', () => {
    currentProfile = makeProfile('coach'); // coachId: uid-1 matches team t1
    currentTeams = [makeTeam('t1'), makeTeam('t99', { id: 't99', coachId: 'other-uid', createdBy: 'other-uid' })];
    currentEvents = [makeEvent('e-other', 't99')];
    renderHomePage();

    expect(screen.queryByTestId('event-card-e-other')).toBeNull();
  });

  it('caps the upcoming events list at 7 items', () => {
    currentProfile = makeProfile('coach');
    currentTeams = [makeTeam('t1')];
    currentEvents = Array.from({ length: 10 }, (_, i) => makeEvent(`e${i}`, 't1'));
    renderHomePage();

    const cards = document.querySelectorAll('[data-testid^="event-card-"]');
    expect(cards.length).toBe(7);
  });
});

describe('HomePage — team card navigation', () => {
  it('navigates coach to /teams when team card is clicked', async () => {
    currentProfile = makeProfile('coach');
    currentTeams = [makeTeam('t1')];
    renderHomePage();

    fireEvent.click(screen.getByText('Team t1').closest('button')!);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/teams');
    });
  });

  it('navigates admin to /teams via the "Go to Teams" button in the admin banner', async () => {
    currentProfile = makeProfile('admin');
    currentTeams = [makeTeam('t1', { createdBy: 'uid-1' })];
    renderHomePage();

    fireEvent.click(screen.getByRole('button', { name: /go to teams/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/teams');
    });
  });

  it('navigates player to /parent when team card is clicked', async () => {
    currentProfile = makeProfile('player', {
      memberships: [{ role: 'player', teamId: 't1' }],
    });
    currentTeams = [makeTeam('t1', { coachId: 'other-uid', createdBy: 'other-uid' })];
    renderHomePage();

    fireEvent.click(screen.getByText('Team t1').closest('button')!);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/parent');
    });
  });

  it('navigates parent to /parent when team card is clicked', async () => {
    currentProfile = makeProfile('parent', {
      memberships: [{ role: 'parent', teamId: 't1' }],
    });
    currentTeams = [makeTeam('t1', { coachId: 'other-uid', createdBy: 'other-uid' })];
    renderHomePage();

    fireEvent.click(screen.getByText('Team t1').closest('button')!);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/parent');
    });
  });
});

describe('HomePage — admin sees all teams', () => {
  it('admin with no memberships array sees the admin banner instead of team cards', () => {
    // Admin users are directed to the Teams page for team management —
    // the home page shows a banner card with a "Go to Teams" link instead.
    currentProfile = makeProfile('admin');
    currentTeams = [
      makeTeam('t1', { coachId: 'other-uid', createdBy: 'other-uid' }),
      makeTeam('t2', { coachId: 'other-uid', createdBy: 'other-uid' }),
      makeTeam('t3', { coachId: 'other-uid', createdBy: 'other-uid' }),
    ];
    renderHomePage();

    expect(screen.getByText(/you have admin access to all teams/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /go to teams/i })).toBeTruthy();
    expect(screen.queryByText('Team t1')).toBeNull();
    expect(screen.queryByText('Team t2')).toBeNull();
    expect(screen.queryByText('Team t3')).toBeNull();
  });
});

describe('HomePage — multi-membership deduplication', () => {
  it('does not render the same team twice when covered by two memberships', () => {
    currentProfile = makeProfile('coach', {
      memberships: [
        { role: 'coach', teamId: 't1' },
        { role: 'coach', teamId: 't1' }, // deliberate duplicate
      ],
    });
    currentTeams = [makeTeam('t1')];
    renderHomePage();

    const teamCards = screen.getAllByText('Team t1');
    // Should appear exactly once
    expect(teamCards.length).toBe(1);
  });
});

describe('HomePage — null/undefined profile edge cases', () => {
  it('renders without crashing when profile is null', () => {
    currentProfile = null;
    expect(() => renderHomePage()).not.toThrow();
  });

  it('shows empty teams state when profile is null', () => {
    currentProfile = null;
    renderHomePage();

    // With null profile getMemberships returns [] so no teams are resolved.
    // The empty state for "not coachOrAbove" (hasRole returns false for null)
    // renders the parent/player message.
    expect(screen.getByText('You are not linked to a team yet.')).toBeTruthy();
  });
});
