import { useEffect, useState } from 'react';
import { Plus, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PracticeSlotWindowCard } from './PracticeSlotWindowCard';
import { CreateWindowModal } from './CreateWindowModal';
import { BlackoutDatePicker } from './BlackoutDatePicker';
import { usePracticeSlotStore } from '@/store/usePracticeSlotStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { Venue } from '@/types';

interface Props {
  leagueId: string;
  seasonId: string;
  seasonStart: string;
  seasonEnd: string;
  /** True when the viewer is an LM or admin for this league. */
  canManage: boolean;
  /** The coach's team, if the viewer is a coach. Null for LM/admin/read-only. */
  coachTeam: { id: string; name: string } | null;
  savedVenues: Venue[];
}

export function PracticeSlotTab({
  leagueId,
  seasonId,
  seasonStart,
  seasonEnd,
  canManage,
  coachTeam,
  savedVenues,
}: Props) {
  const { windows, signups, loading, subscribeWindows, subscribeSignups, subscribeTeamSignups } =
    usePracticeSlotStore();
  const uid = useAuthStore(s => s.user?.uid);

  const [createOpen, setCreateOpen] = useState(false);
  const [blackout, setBlackout] = useState<{ windowId: string; windowName: string; date?: string } | null>(null);

  useEffect(() => {
    const unsubWindows = subscribeWindows(leagueId, seasonId);
    const unsubSignups = coachTeam
      ? subscribeTeamSignups(leagueId, seasonId, coachTeam.id)
      : subscribeSignups(leagueId, seasonId);
    return () => {
      unsubWindows();
      unsubSignups();
    };
  }, [leagueId, seasonId, coachTeam?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleWindows = canManage
    ? windows
    : windows.filter(w => w.status === 'active');

  // My bookings (coach view) — confirmed + waitlisted, upcoming only
  const today = new Date().toISOString().slice(0, 10);
  const myUpcoming = coachTeam
    ? signups
        .filter(s => s.teamId === coachTeam.id && s.status !== 'cancelled' && s.occurrenceDate >= today)
        .sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate))
    : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        <CalendarClock size={20} className="animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* LM toolbar */}
      {canManage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={14} /> New Practice Window
          </Button>
        </div>
      )}

      {/* My upcoming bookings (coach view) */}
      {coachTeam && myUpcoming.length > 0 && (
        <div className="border border-blue-200 rounded-lg bg-blue-50 p-4">
          <p className="text-sm font-semibold text-blue-800 mb-2">My upcoming bookings</p>
          <ul className="space-y-1">
            {myUpcoming.map(s => {
              const win = windows.find(w => w.id === s.windowId);
              const date = new Date(s.occurrenceDate + 'T00:00:00').toLocaleDateString(undefined, {
                weekday: 'short', month: 'short', day: 'numeric',
              });
              return (
                <li key={s.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">{win?.name ?? s.windowId} — {date}</span>
                  {s.status === 'waitlisted' && s.waitlistPosition != null && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700 font-medium">
                      Waitlist #{s.waitlistPosition}
                    </span>
                  )}
                  {s.status === 'confirmed' && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 font-medium">
                      Confirmed
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Window list */}
      {visibleWindows.length === 0 ? (
        <div className="text-center py-12">
          <CalendarClock size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">
            {canManage
              ? 'No practice windows yet. Create one to let coaches sign up.'
              : 'No practice windows available for this season.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleWindows.map(w => (
            <PracticeSlotWindowCard
              key={w.id}
              window={w}
              signups={signups.filter(s => s.windowId === w.id)}
              leagueId={leagueId}
              seasonId={seasonId}
              coachTeam={coachTeam}
              canManage={canManage}
              onAddBlackout={canManage ? (wId, date) => {
                const win = windows.find(x => x.id === wId);
                setBlackout({ windowId: wId, windowName: win?.name ?? wId, date });
              } : undefined}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {uid && createOpen && (
        <CreateWindowModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          leagueId={leagueId}
          seasonId={seasonId}
          seasonStart={seasonStart}
          seasonEnd={seasonEnd}
          savedVenues={savedVenues}
        />
      )}

      {blackout && (
        <BlackoutDatePicker
          open={true}
          onClose={() => setBlackout(null)}
          leagueId={leagueId}
          seasonId={seasonId}
          windowId={blackout.windowId}
          windowName={blackout.windowName}
        />
      )}
    </div>
  );
}
