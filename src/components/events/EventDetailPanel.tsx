import { useState } from 'react';
import { X, MapPin, Clock, Edit, Trash2, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EventStatusBadge } from './EventStatusBadge';
import { EventForm } from './EventForm';
import { SnackVolunteerForm } from './SnackVolunteerForm';
import { AttendanceTracker } from '@/components/attendance/AttendanceTracker';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useEventStore } from '@/store/useEventStore';
import { useTeamStore } from '@/store/useTeamStore';
import { formatDate, formatTime } from '@/lib/dateUtils';
import { EVENT_TYPE_LABELS } from '@/constants';
import type { ScheduledEvent } from '@/types';

interface EventDetailPanelProps {
  event: ScheduledEvent | null;
  onClose: () => void;
}

export function EventDetailPanel({ event, onClose }: EventDetailPanelProps) {
  const { deleteEvent, recordResult, updateEvent } = useEventStore();
  const teams = useTeamStore(s => s.teams);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [resultNotes, setResultNotes] = useState('');

  if (!event) return null;

  const currentEvent = event;
  const homeTeam = teams.find(t => t.id === currentEvent.homeTeamId);
  const awayTeam = teams.find(t => t.id === currentEvent.awayTeamId);
  const isGameOrMatch = event.type === 'game' || event.type === 'match';

  function handleRecordResult() {
    const h = parseInt(homeScore);
    const a = parseInt(awayScore);
    if (isNaN(h) || isNaN(a)) return;
    recordResult(currentEvent.id, { homeScore: h, awayScore: a, notes: resultNotes || undefined });
    setHomeScore('');
    setAwayScore('');
    setResultNotes('');
  }

  function handleCancel() {
    updateEvent({ ...currentEvent, status: 'cancelled' as const, updatedAt: new Date().toISOString() });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 flex justify-end">
        <div className="absolute inset-0 bg-black/30" onClick={onClose} />
        <div className="relative w-96 bg-white h-full shadow-xl flex flex-col overflow-y-auto">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900 truncate">{event.title}</h2>
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-500">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 px-5 py-4 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">{EVENT_TYPE_LABELS[event.type]}</span>
              <EventStatusBadge status={event.status} />
            </div>

            {(homeTeam || awayTeam) && (
              <div className="bg-gray-50 rounded-xl p-4 text-center">
                <div className="flex items-center justify-center gap-4 text-sm font-semibold text-gray-700">
                  <div style={{ color: homeTeam?.color }}>{homeTeam?.name ?? '—'}</div>
                  <span className="text-gray-400 text-xs">vs</span>
                  <div style={{ color: awayTeam?.color }}>{awayTeam?.name ?? '—'}</div>
                </div>
                {event.result && (
                  <div className="text-2xl font-bold text-gray-900 mt-2">
                    {event.result.homeScore} – {event.result.awayScore}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-gray-400" />
                {formatDate(event.date)} at {formatTime(event.startTime)}
                {event.endTime && ` – ${formatTime(event.endTime)}`}
              </div>
              {event.location && (
                <div className="flex items-center gap-2">
                  <MapPin size={14} className="text-gray-400" />
                  {event.location}
                </div>
              )}
            </div>

            {event.notes && (
              <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">{event.notes}</div>
            )}

            {/* Snack Volunteer — games and matches only */}
            {isGameOrMatch && event.status !== 'cancelled' && (
              <SnackVolunteerForm event={currentEvent} />
            )}

            {/* Record Result */}
            {isGameOrMatch && event.status !== 'cancelled' && event.status !== 'completed' && (
              <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                  <CheckCircle size={14} className="text-green-500" /> Record Score
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <Input label={homeTeam?.name ?? 'Home'} type="number" min="0" value={homeScore} onChange={e => setHomeScore(e.target.value)} placeholder="0" />
                  <Input label={awayTeam?.name ?? 'Away'} type="number" min="0" value={awayScore} onChange={e => setAwayScore(e.target.value)} placeholder="0" />
                </div>
                <Input label="Notes (optional)" value={resultNotes} onChange={e => setResultNotes(e.target.value)} />
                <Button size="sm" onClick={handleRecordResult} disabled={!homeScore || !awayScore}>Save Score</Button>
              </div>
            )}

            {/* Attendance */}
            {event.status !== 'cancelled' && (
              <AttendanceTracker event={currentEvent} />
            )}
          </div>

          <div className="px-5 py-4 border-t border-gray-200 flex gap-2 flex-wrap">
            <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
              <Edit size={14} /> Edit
            </Button>
            {event.status !== 'cancelled' && (
              <Button variant="ghost" size="sm" onClick={handleCancel}>Cancel Event</Button>
            )}
            <Button variant="danger" size="sm" className="ml-auto" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} /> Delete
            </Button>
          </div>
        </div>
      </div>

      <EventForm open={editOpen} onClose={() => setEditOpen(false)} editEvent={event} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => { deleteEvent(event.id); onClose(); }}
        title="Delete Event"
        message={`Are you sure you want to delete "${event.title}"? This cannot be undone.`}
      />
    </>
  );
}
