import { ClipboardList } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { useEventStore } from '@/store/useEventStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import type { ScheduledEvent, AttendanceStatus } from '@/types';

interface AttendanceTrackerProps {
  event: ScheduledEvent;
}

const statuses: { value: AttendanceStatus; label: string; color: string }[] = [
  { value: 'present', label: 'Present', color: 'bg-green-500 text-white' },
  { value: 'absent', label: 'Absent', color: 'bg-red-500 text-white' },
  { value: 'excused', label: 'Excused', color: 'bg-yellow-500 text-white' },
];

export function AttendanceTracker({ event }: AttendanceTrackerProps) {
  const { updateEvent } = useEventStore();
  const players = usePlayerStore(s => s.players);

  const teamPlayers = players.filter(p => event.teamIds.includes(p.teamId) && p.status !== 'inactive');

  if (teamPlayers.length === 0) return null;

  function getStatus(playerId: string): AttendanceStatus | undefined {
    return event.attendance?.find(a => a.playerId === playerId)?.status;
  }

  function setStatus(playerId: string, status: AttendanceStatus) {
    const existing = event.attendance?.filter(a => a.playerId !== playerId) ?? [];
    const attendance = [...existing, { playerId, status }];
    updateEvent({ ...event, attendance, attendanceRecorded: true, updatedAt: new Date().toISOString() });
  }

  const recorded = event.attendance?.length ?? 0;
  const hasNoAttendance = recorded === 0;
  const allRsvps = event.rsvps ?? [];
  const canPrefill = hasNoAttendance && allRsvps.length > 0;

  function handlePrefillFromRsvps() {
    const attendance = allRsvps.map(r => ({
      playerId: r.playerId,
      status: (r.response === 'yes' ? 'present' : r.response === 'no' ? 'absent' : 'excused') as AttendanceStatus,
    }));
    updateEvent({ ...event, attendance, attendanceRecorded: true, updatedAt: new Date().toISOString() });
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <ClipboardList size={14} className="text-blue-500" /> Attendance
        </h3>
        <div className="flex items-center gap-2">
          {canPrefill && (
            <Button variant="secondary" size="sm" onClick={handlePrefillFromRsvps}>
              Pre-fill from RSVPs
            </Button>
          )}
          <span className="text-xs text-gray-500">{recorded}/{teamPlayers.length} recorded</span>
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {teamPlayers.map(player => {
          const current = getStatus(player.id);
          return (
            <div key={player.id} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm text-gray-800">
                {player.jerseyNumber != null && <span className="text-gray-400 mr-1.5">#{player.jerseyNumber}</span>}
                {player.firstName} {player.lastName}
              </span>
              <div className="flex gap-1">
                {statuses.map(s => (
                  <button
                    key={s.value}
                    onClick={() => setStatus(player.id, s.value)}
                    className={clsx(
                      'text-xs px-2 py-1 rounded-full font-medium transition-colors',
                      current === s.value ? s.color : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
