import { useState } from 'react';
import { X, MapPin, Clock, Edit, Trash2, CheckCircle, RefreshCw, Send, Copy } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EventStatusBadge } from './EventStatusBadge';
import { EventForm } from './EventForm';
import { SnackVolunteerForm } from './SnackVolunteerForm';
import { RsvpInviteModal } from './RsvpInviteModal';
import { AttendanceTracker } from '@/components/attendance/AttendanceTracker';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { useEventStore } from '@/store/useEventStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useAuthStore } from '@/store/useAuthStore';
import { formatDate, formatTime } from '@/lib/dateUtils';
import { EVENT_TYPE_LABELS, EVENT_TYPE_BADGE_CLASSES } from '@/constants';
import type { ScheduledEvent } from '@/types';

interface EventDetailPanelProps {
  event: ScheduledEvent | null;
  onClose: () => void;
}

export function EventDetailPanel({ event, onClose }: EventDetailPanelProps) {
  const { deleteEvent, recordResult, updateEvent, deleteEventsByGroupId } = useEventStore();
  const teams = useTeamStore(s => s.teams);
  const profile = useAuthStore(s => s.profile);
  const [editOpen, setEditOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [deleteSeriesOpen, setDeleteSeriesOpen] = useState(false);
  const [confirmDeleteThis, setConfirmDeleteThis] = useState(false);
  const [confirmDeleteSeries, setConfirmDeleteSeries] = useState(false);
  const [rsvpOpen, setRsvpOpen] = useState(false);
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [resultNotes, setResultNotes] = useState('');
  const [placement, setPlacement] = useState('');
  const [scoreSaveState, setScoreSaveState] = useState<'idle' | 'saved' | 'error'>('idle');

  const canManage = profile?.role === 'admin' || profile?.role === 'league_manager' || profile?.role === 'coach';
  const isReadOnly = profile?.role === 'player' || profile?.role === 'parent';

  if (!event) return null;

  const currentEvent = event;
  const homeTeam = teams.find(t => t.id === currentEvent.homeTeamId);
  const awayTeam = teams.find(t => t.id === currentEvent.awayTeamId);
  const isGameOrMatch = event.type === 'game' || event.type === 'match';
  const isTournament = event.type === 'tournament';
  const isRecurringEvent = event.isRecurring && !!event.recurringGroupId;

  function handleRecordResult() {
    const h = parseInt(homeScore);
    const a = parseInt(awayScore);
    if (isNaN(h) || isNaN(a)) return;
    try {
      recordResult(currentEvent.id, { homeScore: h, awayScore: a, notes: resultNotes || undefined });
      setHomeScore('');
      setAwayScore('');
      setResultNotes('');
      setScoreSaveState('saved');
      setTimeout(() => setScoreSaveState('idle'), 2000);
    } catch {
      setScoreSaveState('error');
      setTimeout(() => setScoreSaveState('idle'), 3000);
    }
  }

  function handleRecordPlacement() {
    if (!placement.trim()) return;
    try {
      recordResult(currentEvent.id, {
        homeScore: 0,
        awayScore: 0,
        placement: placement.trim(),
        notes: resultNotes || undefined,
      });
      setPlacement('');
      setResultNotes('');
      setScoreSaveState('saved');
      setTimeout(() => setScoreSaveState('idle'), 2000);
    } catch {
      setScoreSaveState('error');
      setTimeout(() => setScoreSaveState('idle'), 3000);
    }
  }

  function handleCancel() {
    updateEvent({ ...currentEvent, status: 'cancelled' as const, updatedAt: new Date().toISOString() });
    onClose();
  }

  function handleDeleteThis() {
    deleteEvent(currentEvent.id);
    onClose();
  }

  function handleDeleteSeries() {
    if (currentEvent.recurringGroupId) {
      deleteEventsByGroupId(currentEvent.recurringGroupId);
    }
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 z-40 flex justify-end">
        <div className="absolute inset-0 bg-black/30" onClick={onClose} />
        <div className="relative w-full sm:w-96 bg-white h-full shadow-xl flex flex-col overflow-y-auto">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="font-semibold text-gray-900 truncate">{event.title}</h2>
              {isRecurringEvent && (
                <Badge className="bg-purple-100 text-purple-700 shrink-0">
                  <RefreshCw size={10} className="mr-1" />
                  Recurring
                </Badge>
              )}
            </div>
            <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-gray-100 text-gray-500 shrink-0 ml-2">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 px-5 py-4 space-y-4">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${EVENT_TYPE_BADGE_CLASSES[event.type] ?? 'bg-gray-100 text-gray-600'}`}>
                {EVENT_TYPE_LABELS[event.type]}
              </span>
              <EventStatusBadge status={event.status} />
            </div>

            {(homeTeam || awayTeam || event.opponentName) && (
              <div className="bg-gray-50 rounded-xl p-4 text-center">
                <div className="flex items-center justify-center gap-4 text-sm font-semibold text-gray-700">
                  <div style={{ color: homeTeam?.color }}>{homeTeam?.name ?? '—'}</div>
                  <span className="text-gray-400 text-xs">vs</span>
                  {awayTeam ? (
                    <div style={{ color: awayTeam.color }}>{awayTeam.name}</div>
                  ) : (
                    <div className="text-gray-700">{event.opponentName ?? '—'}</div>
                  )}
                </div>
                {event.result && (
                  <div className="text-2xl font-bold text-gray-900 mt-2">
                    {event.result.placement
                      ? event.result.placement
                      : `${event.result.homeScore} – ${event.result.awayScore}`}
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

            {/* Snack Volunteer */}
            {event.status !== 'cancelled' && (
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
                  <Input label={awayTeam?.name ?? event.opponentName ?? 'Away'} type="number" min="0" value={awayScore} onChange={e => setAwayScore(e.target.value)} placeholder="0" />
                </div>
                <Input label="Notes (optional)" value={resultNotes} onChange={e => setResultNotes(e.target.value)} />
                <Button size="sm" onClick={handleRecordResult} disabled={!homeScore || !awayScore}>
                  {scoreSaveState === 'saved' ? 'Saved!' : scoreSaveState === 'error' ? 'Error saving' : 'Save Score'}
                </Button>
                {scoreSaveState === 'error' && (
                  <p className="text-xs text-red-600 mt-1">Failed to save score. Please try again.</p>
                )}
              </div>
            )}

            {/* Tournament Placement */}
            {isTournament && event.status !== 'cancelled' && event.status !== 'completed' && (
              <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                  <CheckCircle size={14} className="text-green-500" /> Record Placement
                </h3>
                <Input
                  label="Placement / Finish"
                  value={placement}
                  onChange={e => setPlacement(e.target.value)}
                  placeholder="e.g. 1st place, Runner up, 3rd"
                />
                <Input label="Notes (optional)" value={resultNotes} onChange={e => setResultNotes(e.target.value)} />
                <Button size="sm" onClick={handleRecordPlacement} disabled={!placement.trim()}>
                  {scoreSaveState === 'saved' ? 'Saved!' : scoreSaveState === 'error' ? 'Error saving' : 'Save Placement'}
                </Button>
                {scoreSaveState === 'error' && (
                  <p className="text-xs text-red-600 mt-1">Failed to save placement. Please try again.</p>
                )}
              </div>
            )}

            {/* RSVP Summary */}
            {event.rsvps && event.rsvps.length > 0 && (
              <div className="border border-gray-200 rounded-xl p-4 space-y-2">
                <h3 className="text-sm font-semibold text-gray-800">RSVP Responses</h3>
                <div className="flex gap-3 text-xs font-medium">
                  <span className="text-green-600">{event.rsvps.filter(r => r.response === 'yes').length} Yes</span>
                  <span className="text-red-500">{event.rsvps.filter(r => r.response === 'no').length} No</span>
                  <span className="text-yellow-600">{event.rsvps.filter(r => r.response === 'maybe').length} Maybe</span>
                </div>
                <ul className="space-y-0.5 text-xs text-gray-600 max-h-28 overflow-y-auto">
                  {event.rsvps.map(r => (
                    <li key={r.playerId} className="flex justify-between gap-2">
                      <span className="truncate">{r.name}</span>
                      <span className={r.response === 'yes' ? 'text-green-600' : r.response === 'no' ? 'text-red-500' : 'text-yellow-600'}>
                        {r.response === 'yes' ? 'Yes' : r.response === 'no' ? 'No' : 'Maybe'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Attendance */}
            {event.status !== 'cancelled' && (
              <AttendanceTracker event={currentEvent} />
            )}
          </div>

          {!isReadOnly && (
            <div className="px-5 py-4 border-t border-gray-200 flex gap-2 flex-wrap">
              <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
                <Edit size={14} /> Edit
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setDuplicateOpen(true)}>
                <Copy size={14} /> Duplicate
              </Button>
              {canManage && event.status !== 'cancelled' && (
                <Button variant="secondary" size="sm" onClick={() => setRsvpOpen(true)}>
                  <Send size={14} /> Send RSVP
                </Button>
              )}
              {event.status !== 'cancelled' && (
                <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(true)}>Cancel Event</Button>
              )}
              <Button
                variant="danger"
                size="sm"
                className="ml-auto"
                onClick={() => isRecurringEvent ? setDeleteSeriesOpen(true) : setConfirmDelete(true)}
              >
                <Trash2 size={14} /> Delete
              </Button>
            </div>
          )}
        </div>
      </div>

      <EventForm open={editOpen} onClose={() => setEditOpen(false)} editEvent={event} />
      <EventForm
        open={duplicateOpen}
        onClose={() => setDuplicateOpen(false)}
        initial={{
          title: event.title,
          type: event.type,
          date: event.date,
          startTime: event.startTime,
          endTime: event.endTime,
          location: event.location,
          homeTeamId: event.homeTeamId,
          awayTeamId: event.awayTeamId,
          opponentName: event.opponentName,
          notes: event.notes,
        }}
      />
      {rsvpOpen && <RsvpInviteModal open={rsvpOpen} onClose={() => setRsvpOpen(false)} event={event} />}

      {/* Cancel event confirm */}
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={handleCancel}
        title="Cancel Event"
        message="Cancel this event? This will notify all players."
        confirmLabel="Cancel Event"
      />

      {/* Single event delete confirm */}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => { deleteEvent(event.id); onClose(); }}
        title="Delete Event"
        message={`Are you sure you want to delete "${event.title}"? This cannot be undone.`}
      />

      {/* Recurring: delete this event only confirm */}
      <ConfirmDialog
        open={confirmDeleteThis}
        onClose={() => setConfirmDeleteThis(false)}
        onConfirm={handleDeleteThis}
        title="Delete Event"
        message={`Delete just this occurrence of "${event.title}"? This cannot be undone.`}
        confirmLabel="Delete Event"
      />

      {/* Recurring: delete entire series confirm */}
      <ConfirmDialog
        open={confirmDeleteSeries}
        onClose={() => setConfirmDeleteSeries(false)}
        onConfirm={handleDeleteSeries}
        title="Delete All in Series"
        message={`Delete all events in the "${event.title}" series? This cannot be undone.`}
        confirmLabel="Delete All"
      />

      {/* Recurring delete choice dialog */}
      <Modal open={deleteSeriesOpen} onClose={() => setDeleteSeriesOpen(false)} title="Delete Recurring Event" size="sm">
        <p className="text-sm text-gray-600 mb-4">
          This is a recurring event. Would you like to delete just this event, or all events in this series?
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="secondary" onClick={() => { setDeleteSeriesOpen(false); setConfirmDeleteThis(true); }}>
            Delete This Event Only
          </Button>
          <Button variant="danger" onClick={() => { setDeleteSeriesOpen(false); setConfirmDeleteSeries(true); }}>
            Delete All in Series
          </Button>
          <Button variant="ghost" onClick={() => setDeleteSeriesOpen(false)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </>
  );
}
