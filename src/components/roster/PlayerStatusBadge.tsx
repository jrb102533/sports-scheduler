import { Ban, Stethoscope } from 'lucide-react';
import type { Player } from '@/types';

interface PlayerStatusBadgeProps {
  player: Player;
  /** When true, also shows the expected return date if present */
  showReturnDate?: boolean;
}

/**
 * Renders a compact badge for injured or suspended players.
 * Returns null for active/inactive players (no badge shown).
 */
export function PlayerStatusBadge({ player, showReturnDate = false }: PlayerStatusBadgeProps) {
  if (player.status === 'injured') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-medium leading-none">
        <Stethoscope size={10} className="shrink-0" />
        Injured
        {showReturnDate && player.statusReturnDate && (
          <span className="text-red-500 font-normal">
            &nbsp;· back {formatReturnDate(player.statusReturnDate)}
          </span>
        )}
      </span>
    );
  }

  if (player.status === 'suspended') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 text-orange-700 px-2 py-0.5 text-xs font-medium leading-none">
        <Ban size={10} className="shrink-0" />
        Suspended
        {showReturnDate && player.statusReturnDate && (
          <span className="text-orange-500 font-normal">
            &nbsp;· back {formatReturnDate(player.statusReturnDate)}
          </span>
        )}
      </span>
    );
  }

  return null;
}

function formatReturnDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00'); // force local midnight parse
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
