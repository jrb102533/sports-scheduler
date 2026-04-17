/**
 * PlayerStatusBadge — rendering tests
 *
 * Behaviours under test:
 *   A) Injured player shows "Injured" badge
 *   B) Suspended player shows "Suspended" badge
 *   C) Active player renders nothing (returns null)
 *   D) Inactive player renders nothing (returns null)
 *   E) showReturnDate=true with statusReturnDate shows formatted return date
 *   F) showReturnDate=false never shows return date
 *   G) showReturnDate=true but no statusReturnDate shows no return date
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Player } from '@/types';
import { PlayerStatusBadge } from './PlayerStatusBadge';

function makePlayer(overrides: Partial<Player>): Player {
  return {
    id: 'player-1',
    firstName: 'Alice',
    lastName: 'Smith',
    teamId: 'team-1',
    status: 'active',
    jerseyNumber: '7',
    position: 'Forward',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as Player;
}

// ── A. Injured player ─────────────────────────────────────────────────────────

describe('PlayerStatusBadge — injured', () => {
  it('shows "Injured" label for an injured player', () => {
    const { container } = render(
      <PlayerStatusBadge player={makePlayer({ status: 'injured' })} />
    );
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText('Injured')).toBeInTheDocument();
  });

  it('does not show "Suspended" text for an injured player', () => {
    render(<PlayerStatusBadge player={makePlayer({ status: 'injured' })} />);
    expect(screen.queryByText('Suspended')).not.toBeInTheDocument();
  });
});

// ── B. Suspended player ───────────────────────────────────────────────────────

describe('PlayerStatusBadge — suspended', () => {
  it('shows "Suspended" label for a suspended player', () => {
    render(<PlayerStatusBadge player={makePlayer({ status: 'suspended' })} />);
    expect(screen.getByText('Suspended')).toBeInTheDocument();
  });

  it('does not show "Injured" text for a suspended player', () => {
    render(<PlayerStatusBadge player={makePlayer({ status: 'suspended' })} />);
    expect(screen.queryByText('Injured')).not.toBeInTheDocument();
  });
});

// ── C. Active player renders null ─────────────────────────────────────────────

describe('PlayerStatusBadge — active', () => {
  it('renders nothing for an active player', () => {
    const { container } = render(
      <PlayerStatusBadge player={makePlayer({ status: 'active' })} />
    );
    expect(container.firstChild).toBeNull();
  });
});

// ── D. Inactive player renders null ───────────────────────────────────────────

describe('PlayerStatusBadge — inactive', () => {
  it('renders nothing for an inactive player', () => {
    const { container } = render(
      <PlayerStatusBadge player={makePlayer({ status: 'inactive' })} />
    );
    expect(container.firstChild).toBeNull();
  });
});

// ── E. showReturnDate with a statusReturnDate ─────────────────────────────────

describe('PlayerStatusBadge — showReturnDate=true with a return date', () => {
  it('shows the return date when showReturnDate=true and statusReturnDate is set', () => {
    render(
      <PlayerStatusBadge
        player={makePlayer({ status: 'injured', statusReturnDate: '2026-06-15' })}
        showReturnDate
      />
    );
    // Should contain "back" followed by the formatted date
    expect(screen.getByText(/back/i)).toBeInTheDocument();
  });

  it('includes the return date for a suspended player too', () => {
    render(
      <PlayerStatusBadge
        player={makePlayer({ status: 'suspended', statusReturnDate: '2026-07-01' })}
        showReturnDate
      />
    );
    expect(screen.getByText(/back/i)).toBeInTheDocument();
  });
});

// ── F. showReturnDate=false never shows return date ──────────────────────────

describe('PlayerStatusBadge — showReturnDate=false (default)', () => {
  it('does not show return date when showReturnDate is false (default)', () => {
    render(
      <PlayerStatusBadge
        player={makePlayer({ status: 'injured', statusReturnDate: '2026-06-15' })}
      />
    );
    expect(screen.queryByText(/back/i)).not.toBeInTheDocument();
  });

  it('does not show return date when showReturnDate is explicitly false', () => {
    render(
      <PlayerStatusBadge
        player={makePlayer({ status: 'suspended', statusReturnDate: '2026-07-01' })}
        showReturnDate={false}
      />
    );
    expect(screen.queryByText(/back/i)).not.toBeInTheDocument();
  });
});

// ── G. showReturnDate=true but no statusReturnDate ────────────────────────────

describe('PlayerStatusBadge — showReturnDate=true with no return date', () => {
  it('does not show return date text when showReturnDate=true but statusReturnDate is absent', () => {
    render(
      <PlayerStatusBadge
        player={makePlayer({ status: 'injured', statusReturnDate: undefined })}
        showReturnDate
      />
    );
    expect(screen.queryByText(/back/i)).not.toBeInTheDocument();
    // But the badge itself should still render
    expect(screen.getByText('Injured')).toBeInTheDocument();
  });
});
