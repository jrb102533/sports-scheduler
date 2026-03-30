import { PracticeSlotSignupButton } from './PracticeSlotSignupButton';
import { PracticeSlotWaitlistBadge } from './PracticeSlotWaitlistBadge';
import type { PracticeSlotSignup } from '@/types';

interface Props {
  leagueId: string;
  seasonId: string;
  windowId: string;
  windowName: string;
  occurrenceDate: string;
  capacity: number;
  /** All active (non-cancelled) signups for this occurrence. */
  signups: PracticeSlotSignup[];
  /**
   * If the viewer is a coach, their team info for signup actions.
   * Null for LM/read-only view.
   */
  coachTeam: { id: string; name: string } | null;
  /** Whether the viewer can manage (LM/admin). */
  canManage: boolean;
  /** LM action: add blackout for this date. */
  onAddBlackout?: (date: string) => void;
}

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

export function PracticeSlotOccurrenceRow({
  leagueId,
  seasonId,
  windowId,
  windowName: _windowName,
  occurrenceDate,
  capacity,
  signups,
  coachTeam,
  canManage,
  onAddBlackout,
}: Props) {
  const confirmed = signups.filter(s => s.status === 'confirmed');
  const waitlisted = signups.filter(s => s.status === 'waitlisted');
  const spotsLeft = capacity - confirmed.length;
  const isFull = spotsLeft <= 0;

  const mySignup = coachTeam
    ? signups.find(s => s.teamId === coachTeam.id && s.status !== 'cancelled') ?? null
    : null;

  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-gray-100 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800">{formatDate(occurrenceDate)}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {confirmed.map(s => (
            <span key={s.id} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 font-medium">
              {s.teamName}
            </span>
          ))}
          {spotsLeft > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">
              {spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} open
            </span>
          )}
          {waitlisted.length > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-600">
              {waitlisted.length} waitlisted
            </span>
          )}
        </div>
        {mySignup?.status === 'waitlisted' && mySignup.waitlistPosition != null && (
          <div className="mt-1">
            <PracticeSlotWaitlistBadge position={mySignup.waitlistPosition} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {coachTeam && (
          <PracticeSlotSignupButton
            leagueId={leagueId}
            seasonId={seasonId}
            windowId={windowId}
            occurrenceDate={occurrenceDate}
            teamId={coachTeam.id}
            teamName={coachTeam.name}
            existingSignup={mySignup}
            isFull={isFull}
          />
        )}
        {canManage && onAddBlackout && (
          <button
            onClick={() => onAddBlackout(occurrenceDate)}
            className="text-xs text-gray-400 hover:text-red-600 transition-colors"
            title="Block this date"
          >
            Block
          </button>
        )}
      </div>
    </div>
  );
}
