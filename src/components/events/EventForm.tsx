import { useState, useMemo, useRef, useEffect } from 'react';
import { addDays, addWeeks, addMonths, parseISO, format, isAfter } from 'date-fns';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useEventStore } from '@/store/useEventStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useVenueStore } from '@/store/useVenueStore';
import { useOpponentStore } from '@/store/useOpponentStore';
import { useAuthStore } from '@/store/useAuthStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useAvailabilityStore } from '@/store/useAvailabilityStore';
import { todayISO, formatTime } from '@/lib/dateUtils';
import { EVENT_TYPE_LABELS } from '@/constants';
import type { ScheduledEvent, EventType, EventStatus, RecurrenceFrequency } from '@/types';
import { RefreshCw } from 'lucide-react';

/** Convert HH:MM to total minutes for comparison. Returns -1 for unparseable input. */
function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
}

/** Add minutes to a HH:MM time string, wrapping at midnight. */
function addMinutes(time: string, minutes: number): string {
  const total = toMinutes(time) + minutes;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const DEFAULT_DURATION = 90;

/** Returns true if time range A overlaps time range B.
 *  Falls back to DEFAULT_DURATION minutes when endTime is absent. */
function timesOverlap(
  aStart: string, aEnd: string | undefined,
  bStart: string, bEnd: string | undefined
): boolean {
  const aS = toMinutes(aStart);
  const aE = aEnd ? toMinutes(aEnd) : aS + DEFAULT_DURATION;
  const bS = toMinutes(bStart);
  const bE = bEnd ? toMinutes(bEnd) : bS + DEFAULT_DURATION;
  if (aS < 0 || bS < 0) return false; // unparseable — skip
  return aS < bE && bS < aE;
}

interface EventFormProps {
  open: boolean;
  onClose: () => void;
  initial?: Partial<ScheduledEvent>;
  editEvent?: ScheduledEvent;
}

const typeOptions = Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => ({ value, label }));

const frequencyOptions: { value: RecurrenceFrequency; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
];

const MAX_OCCURRENCES = 365;

function generateOccurrences(startDate: string, endDate: string, frequency: RecurrenceFrequency): string[] {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  const dates: string[] = [];
  let current = start;
  while (!isAfter(current, end) && dates.length < MAX_OCCURRENCES) {
    dates.push(format(current, 'yyyy-MM-dd'));
    switch (frequency) {
      case 'daily': current = addDays(current, 1); break;
      case 'weekly': current = addWeeks(current, 1); break;
      case 'biweekly': current = addWeeks(current, 2); break;
      case 'monthly': current = addMonths(current, 1); break;
    }
  }
  return dates;
}

function formatPreviewDate(isoDate: string): string {
  return format(parseISO(isoDate), 'MMM d');
}

const GAME_TYPES = new Set<EventType>(['game', 'match', 'tournament']);

export function EventForm({ open, onClose, initial, editEvent }: EventFormProps) {
  const { addEvent, bulkAddEvents, events } = useEventStore();
  const updateEvent = useEventStore(s => s.updateEvent);
  const allEvents = useEventStore(s => s.events);
  const allTeams = useTeamStore(s => s.teams);
  const { opponents, addOpponent } = useOpponentStore();
  const profile = useAuthStore(s => s.profile);
  const user = useAuthStore(s => s.user);
  const savedVenues = useVenueStore(s => s.venues);

  useEffect(() => {
    return useVenueStore.getState().subscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Teams the user can schedule for
  const myTeams = useMemo(() => {
    if (profile?.role === 'admin' || profile?.role === 'league_manager') return allTeams;
    return allTeams.filter(t => t.createdBy === user?.uid || t.coachId === user?.uid || t.coachIds?.includes(user?.uid ?? ''));
  }, [allTeams, profile, user]);

  // If a team is pre-set from the page context (e.g. TeamDetailPage), lock it
  const lockedTeamId = initial?.homeTeamId ?? '';
  const lockedTeam = lockedTeamId ? allTeams.find(t => t.id === lockedTeamId) : null;

  const [title, setTitle] = useState(editEvent?.title ?? initial?.title ?? '');
  const [type, setType] = useState<EventType>(editEvent?.type ?? initial?.type ?? 'game');
  const [date, setDate] = useState(editEvent?.date ?? initial?.date ?? todayISO());
  const [startTime, setStartTime] = useState(editEvent?.startTime ?? initial?.startTime ?? '09:00');
  const [duration, setDuration] = useState<number>(editEvent?.duration ?? initial?.duration ?? DEFAULT_DURATION);
  const [location, setLocation] = useState(editEvent?.location ?? initial?.location ?? '');
  const [venueId, setVenueId] = useState(editEvent?.venueId ?? initial?.venueId ?? '');
  const [fieldId, setFieldId] = useState(editEvent?.fieldId ?? initial?.fieldId ?? '');
  const [notes, setNotes] = useState(editEvent?.notes ?? initial?.notes ?? '');
  const [isOutdoor, setIsOutdoor] = useState<boolean>(editEvent?.isOutdoor ?? initial?.isOutdoor ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Team + home/away
  const [selectedTeamId, setSelectedTeamId] = useState(
    lockedTeamId || editEvent?.homeTeamId || editEvent?.awayTeamId ||
    initial?.homeTeamId || initial?.awayTeamId || myTeams[0]?.id || ''
  );
  const [isHome, setIsHome] = useState(
    editEvent ? !!editEvent.homeTeamId : initial ? !!initial.homeTeamId : true
  );

  // Opponent
  const [opponentName, setOpponentName] = useState(editEvent?.opponentName ?? initial?.opponentName ?? '');
  const [opponentInputFocused, setOpponentInputFocused] = useState(false);
  const opponentInputRef = useRef<HTMLInputElement>(null);
  const [snackItem, setSnackItem] = useState(editEvent?.snackItem ?? '');

  // Conflict warning dialog state
  const [conflictWarning, setConflictWarning] = useState<{
    conflicts: ScheduledEvent[];
    proceed: () => void;
  } | null>(null);

  // Edit series dialog state (shown when editing a recurring event)
  const [editSeriesOpen, setEditSeriesOpen] = useState(false);
  const [pendingSave, setPendingSave] = useState<((scope: 'this' | 'future') => Promise<void>) | null>(null);

  // Recurrence
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('weekly');
  const [recurrenceEnd, setRecurrenceEnd] = useState('');

  const occurrenceCount = useMemo(() => {
    if (!isRecurring || !date || !recurrenceEnd || recurrenceEnd < date) return 0;
    return generateOccurrences(date, recurrenceEnd, frequency).length;
  }, [isRecurring, date, recurrenceEnd, frequency]);

  const effectiveHomeTeamId = isHome ? selectedTeamId : '';
  const effectiveAwayTeamId = isHome ? '' : selectedTeamId;
  const contextTeamId = selectedTeamId;

  // Player availability conflict hint
  const allPlayers = usePlayerStore(s => s.players);
  const isPlayerAvailable = useAvailabilityStore(s => s.isPlayerAvailable);
  const unavailablePlayers = useMemo(() => {
    if (!date || !selectedTeamId) return [];
    return allPlayers
      .filter(p => p.teamId === selectedTeamId)
      .filter(p => !isPlayerAvailable(p.id, date));
  }, [date, selectedTeamId, allPlayers, isPlayerAvailable]);

  function validate() {
    const e: Record<string, string> = {};
    if (!date) e.date = 'Date is required';
    if (!startTime) e.startTime = 'Start time is required';
    if (!duration || duration < 1) e.duration = 'Duration is required';
    if (!selectedTeamId) e.team = 'Team is required';
    if (!editEvent && isRecurring) {
      if (!recurrenceEnd) e.recurrenceEnd = 'End date is required for recurring events';
      else if (recurrenceEnd <= date) e.recurrenceEnd = 'End date must be after start date';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function checkConflicts(datesToCheck: string[]): ScheduledEvent[] {
    const seen = new Set<string>();
    const conflicts: ScheduledEvent[] = [];
    for (const d of datesToCheck) {
      for (const ev of events) {
        if (seen.has(ev.id)) continue;
        if (ev.id === editEvent?.id) continue;
        if (ev.date !== d) continue;
        if (ev.status === 'cancelled' || ev.status === 'postponed') continue;
        if (!ev.teamIds.includes(selectedTeamId)) continue;
        const computedEnd = addMinutes(startTime, duration);
        if (timesOverlap(startTime, computedEnd, ev.startTime, ev.endTime)) {
          seen.add(ev.id);
          conflicts.push(ev);
        }
      }
    }
    return conflicts;
  }

  async function doSave(scope: 'this' | 'future' = 'this') {
    const now = new Date().toISOString();
    const teamIds = [selectedTeamId].filter(Boolean);
    const resolvedTitle = title.trim() || EVENT_TYPE_LABELS[type];
    const computedEndTime = addMinutes(startTime, duration);

    // Resolve opponent
    let resolvedOpponentId: string | undefined;
    let resolvedOpponentName: string | undefined;
    const trimmedOpponent = opponentName.trim();
    if (GAME_TYPES.has(type) && trimmedOpponent) {
      const existing = opponents.find(
        o => o.teamId === contextTeamId && o.name.toLowerCase() === trimmedOpponent.toLowerCase()
      );
      if (existing) {
        resolvedOpponentId = existing.id;
      } else if (contextTeamId) {
        resolvedOpponentId = crypto.randomUUID();
        await addOpponent({ id: resolvedOpponentId, name: trimmedOpponent, teamId: contextTeamId, createdAt: now });
      }
      resolvedOpponentName = trimmedOpponent;
    }

    const selectedVenue = venueId ? savedVenues.find(v => v.id === venueId) : undefined;
    const selectedField = fieldId && selectedVenue ? selectedVenue.fields.find(f => f.id === fieldId) : undefined;

    const optionals = {
      duration,
      endTime: computedEndTime,
      isOutdoor,
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(venueId ? { venueId } : {}),
      ...(selectedVenue?.lat != null && selectedVenue?.lng != null
        ? { venueLat: selectedVenue.lat, venueLng: selectedVenue.lng }
        : {}),
      ...(selectedField ? { fieldId: selectedField.id, fieldName: selectedField.name } : {}),
      ...(effectiveHomeTeamId ? { homeTeamId: effectiveHomeTeamId } : {}),
      ...(effectiveAwayTeamId ? { awayTeamId: effectiveAwayTeamId } : {}),
      ...(resolvedOpponentId ? { opponentId: resolvedOpponentId } : {}),
      ...(resolvedOpponentName ? { opponentName: resolvedOpponentName } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(snackItem.trim() ? { snackItem: snackItem.trim() } : {}),
    };

    if (editEvent) {
      // Strip stale home/away/opponent fields before spreading so that switching
      // home↔away or clearing the opponent on edit doesn't leave the old value
      // behind (e.g. "Skywalkers vs Skywalkers" when awayTeamId was never cleared).
      // optionals re-adds these only when they have a value.
      const {
        homeTeamId: _ht, awayTeamId: _at,
        opponentId: _oi, opponentName: _on,
        ...editBase
      } = editEvent;

      if (scope === 'future' && editEvent.recurringGroupId) {
        const futureEvents = allEvents.filter(
          e => e.recurringGroupId === editEvent.recurringGroupId && e.date >= editEvent.date
        );
        // Calculate date offset so all future events shift by the same delta
        const originalMs = new Date(editEvent.date).getTime();
        const newMs = new Date(date).getTime();
        const offsetMs = newMs - originalMs;
        await Promise.all(
          futureEvents.map(e => {
            const { homeTeamId: _fht, awayTeamId: _fat, opponentId: _foi, opponentName: _fon, ...eBase } = e;
            const shiftedDate = offsetMs !== 0
              ? new Date(new Date(e.date).getTime() + offsetMs).toISOString().slice(0, 10)
              : e.date;
            return updateEvent({ ...eBase, title: resolvedTitle, type, date: shiftedDate, startTime, teamIds, updatedAt: now, ...optionals });
          })
        );
      } else {
        updateEvent({ ...editBase, title: resolvedTitle, type, date, startTime, teamIds, updatedAt: now, ...optionals });
      }
    } else if (isRecurring && recurrenceEnd) {
      const groupId = crypto.randomUUID();
      const occurrences = generateOccurrences(date, recurrenceEnd, frequency);
      const newEvents: ScheduledEvent[] = occurrences.map(occDate => ({
        id: crypto.randomUUID(),
        title: resolvedTitle,
        type,
        status: 'scheduled' as EventStatus,
        date: occDate,
        startTime,
        teamIds,
        isRecurring: true,
        recurringGroupId: groupId,
        recurrence: frequency,
        recurrenceEnd,
        createdAt: now,
        updatedAt: now,
        ...optionals,
      }));
      bulkAddEvents(newEvents);
    } else {
      addEvent({ id: crypto.randomUUID(), title: resolvedTitle, type, status: 'scheduled' as EventStatus, date, startTime, teamIds, isRecurring: false, createdAt: now, updatedAt: now, ...optionals });
    }
    onClose();
  }

  async function handleSubmit() {
    if (!validate()) return;
    const datesToCheck = isRecurring && recurrenceEnd && recurrenceEnd > date
      ? generateOccurrences(date, recurrenceEnd, frequency)
      : [date];
    const conflicts = checkConflicts(datesToCheck);

    const isEditingRecurring = !!(editEvent?.isRecurring && editEvent?.recurringGroupId);

    if (conflicts.length > 0) {
      setConflictWarning({
        conflicts,
        proceed: () => {
          if (isEditingRecurring) {
            setPendingSave(() => doSave);
            setEditSeriesOpen(true);
          } else {
            void doSave('this');
          }
        },
      });
      return;
    }

    if (isEditingRecurring) {
      setPendingSave(() => doSave);
      setEditSeriesOpen(true);
      return;
    }

    await doSave('this');
  }

  const myTeamOptions = myTeams.map(t => ({ value: t.id, label: t.name }));
  const selectedTeam = allTeams.find(t => t.id === selectedTeamId);

  return (
    <Modal open={open} onClose={onClose} title={editEvent ? 'Edit Event' : 'New Event'} size="md">
      <div className="space-y-4">
        <Input label="Title" name="event-title" autoComplete="off" value={title} onChange={e => setTitle(e.target.value)} error={errors.title} placeholder="e.g. Championship Game" />
        <Select label="Type" value={type} onChange={e => setType(e.target.value as EventType)} options={typeOptions} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} error={errors.date} />
          <Input label="Start Time" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} error={errors.startTime} />
        </div>
        {unavailablePlayers.length > 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {unavailablePlayers.length} {unavailablePlayers.length === 1 ? 'player' : 'players'} unavailable:{' '}
            {unavailablePlayers.map(p => `${p.firstName} ${p.lastName}`).join(', ')}
          </p>
        )}
        <Input
          label="Duration (minutes)"
          type="number"
          name="event-duration"
          autoComplete="off"
          value={String(duration)}
          onChange={e => setDuration(Math.max(1, parseInt(e.target.value, 10) || 0))}
          error={errors.duration}
          placeholder="e.g. 90"
        />
        {savedVenues.length > 0 && (
          <Select
            label="Venue (optional)"
            value={venueId}
            onChange={e => {
              const selected = savedVenues.find(v => v.id === e.target.value);
              setVenueId(e.target.value);
              setFieldId('');
              if (selected) setLocation(selected.name);
            }}
            options={savedVenues.map(v => ({ value: v.id, label: v.name }))}
            placeholder="Select a venue"
          />
        )}
        {venueId && (() => {
          const selectedVenue = savedVenues.find(v => v.id === venueId);
          return selectedVenue && selectedVenue.fields.length > 1 ? (
            <Select
              label="Field (optional)"
              value={fieldId}
              onChange={e => setFieldId(e.target.value)}
              options={selectedVenue.fields.map(f => ({ value: f.id, label: f.name }))}
              placeholder="Select a field"
            />
          ) : null;
        })()}
        <Input label="Location (optional)" name="event-location" autoComplete="off" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. City Park Field 1" />

        {/* Outdoor toggle */}
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <button
            type="button"
            role="switch"
            aria-checked={isOutdoor}
            onClick={() => setIsOutdoor(v => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${isOutdoor ? 'bg-blue-600' : 'bg-gray-300'}`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${isOutdoor ? 'translate-x-4' : 'translate-x-1'}`}
            />
          </button>
          <span className="text-sm font-medium text-gray-700">Outdoor event</span>
          {isOutdoor && (
            <span className="text-xs text-gray-400">Weather alerts enabled</span>
          )}
        </label>

        {/* Team + Home/Away */}
        <div className="space-y-2">
          {lockedTeam ? (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: lockedTeam.color }} />
              <span className="text-sm font-medium text-gray-800">{lockedTeam.name}</span>
            </div>
          ) : (
            <Select
              label="Team"
              value={selectedTeamId}
              onChange={e => setSelectedTeamId(e.target.value)}
              options={myTeamOptions}
              placeholder="Select team"
              error={errors.team}
            />
          )}

          {/* Home / Away toggle */}
          {selectedTeamId && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 mr-1">{selectedTeam?.name ?? lockedTeam?.name} is playing:</span>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium">
                <button
                  type="button"
                  onClick={() => setIsHome(true)}
                  className="px-4 py-1.5 transition-colors"
                  style={isHome ? { backgroundColor: '#1B3A6B', color: 'white' } : { color: '#6b7280' }}
                >
                  Home
                </button>
                <button
                  type="button"
                  onClick={() => setIsHome(false)}
                  className="px-4 py-1.5 border-l border-gray-200 transition-colors"
                  style={!isHome ? { backgroundColor: '#1B3A6B', color: 'white' } : { color: '#6b7280' }}
                >
                  Away
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Opponent */}
        {GAME_TYPES.has(type) && selectedTeamId && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">
              {isHome ? 'Away Team / Opponent' : 'Home Team / Opponent'} <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <div className="relative">
              <input
                ref={opponentInputRef}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Type or select a past opponent…"
                value={opponentName}
                onChange={e => setOpponentName(e.target.value)}
                onFocus={() => setOpponentInputFocused(true)}
                onBlur={() => setTimeout(() => setOpponentInputFocused(false), 150)}
                autoComplete="off"
              />
              {opponentInputFocused && (() => {
                const query = opponentName.trim().toLowerCase();
                const suggestions = opponents
                  .filter(o => o.teamId === contextTeamId)
                  .filter(o => !query || o.name.toLowerCase().includes(query));
                return suggestions.length > 0 ? (
                  <ul className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {suggestions.map(o => (
                      <li
                        key={o.id}
                        className="px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 cursor-pointer"
                        onMouseDown={() => {
                          setOpponentName(o.name);
                          setOpponentInputFocused(false);
                        }}
                      >
                        {o.name}
                      </li>
                    ))}
                  </ul>
                ) : null;
              })()}
            </div>
            {opponentName.trim() && !opponents.some(o => o.name.toLowerCase() === opponentName.trim().toLowerCase()) && (
              <p className="text-xs text-green-600">New opponent — will be saved for future events</p>
            )}
          </div>
        )}

        {/* Snack request — admin/coach/owner */}
        {(profile?.role === 'admin' || profile?.role === 'league_manager' || profile?.role === 'coach' ||
          (selectedTeamId && allTeams.find(t => t.id === selectedTeamId)?.createdBy === user?.uid)) && (
          <Input
            label="Snack Request (optional)"
            name="snack-request"
            autoComplete="off"
            value={snackItem}
            onChange={e => setSnackItem(e.target.value)}
            placeholder="e.g. Orange slices and juice boxes"
          />
        )}


                <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Notes (optional)</label>
          <textarea
            name="event-notes"
            autoComplete="off"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows={3}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Any additional details..."
          />
        </div>

        {/* Recurrence — create only */}
        {!editEvent && (
          <div className="border border-gray-200 rounded-lg p-3 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={e => setIsRecurring(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Repeats</span>
            </label>
            {isRecurring && (
              <div className="space-y-3 pl-6">
                <div className="grid grid-cols-2 gap-3">
                  <Select label="Frequency" value={frequency} onChange={e => setFrequency(e.target.value as RecurrenceFrequency)} options={frequencyOptions} />
                  <Input label="End Date" type="date" value={recurrenceEnd} onChange={e => setRecurrenceEnd(e.target.value)} error={errors.recurrenceEnd} />
                </div>
                {occurrenceCount > 0 && (
                  <p className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1.5">
                    Creates {occurrenceCount} {frequency} event{occurrenceCount !== 1 ? 's' : ''} from {formatPreviewDate(date)} to {formatPreviewDate(recurrenceEnd)}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void handleSubmit()}>{editEvent ? 'Save Changes' : 'Create Event'}</Button>
        </div>
      </div>

      {/* Scheduling conflict warning */}
      {conflictWarning && (
        <Modal
          open={true}
          onClose={() => setConflictWarning(null)}
          title="Scheduling Conflict"
          size="sm"
        >
          <p className="text-sm text-gray-700 mb-3">
            This event overlaps with {conflictWarning.conflicts.length} existing event{conflictWarning.conflicts.length !== 1 ? 's' : ''} for this team:
          </p>
          <ul className="space-y-2 mb-5">
            {conflictWarning.conflicts.slice(0, 5).map(ev => (
              <li key={ev.id} className="text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <span className="font-medium text-gray-900">{ev.title}</span>
                <span className="text-gray-500"> · {ev.date} · {formatTime(ev.startTime)}{ev.endTime ? ` – ${formatTime(ev.endTime)}` : ''}</span>
              </li>
            ))}
            {conflictWarning.conflicts.length > 5 && (
              <li className="text-xs text-gray-500 px-3">…and {conflictWarning.conflicts.length - 5} more</li>
            )}
          </ul>
          <p className="text-sm text-gray-600 mb-5">Do you still want to schedule this event?</p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConflictWarning(null)}>Go Back</Button>
            <Button onClick={() => { conflictWarning.proceed(); setConflictWarning(null); }}>Schedule Anyway</Button>
          </div>
        </Modal>
      )}

      {/* Edit recurring series choice dialog */}
      <Modal open={editSeriesOpen} onClose={() => { setEditSeriesOpen(false); setPendingSave(null); }} title="Edit Recurring Event" size="sm">
        <p className="text-sm text-gray-600 mb-4">
          This is a recurring event. Would you like to edit just this event, or this and all future events in the series?
        </p>
        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setEditSeriesOpen(false);
              void pendingSave?.('this');
              setPendingSave(null);
            }}
          >
            Edit This Event Only
          </Button>
          <Button
            onClick={() => {
              setEditSeriesOpen(false);
              void pendingSave?.('future');
              setPendingSave(null);
            }}
          >
            <RefreshCw size={14} /> Edit This and All Future Events
          </Button>
          <Button variant="ghost" onClick={() => { setEditSeriesOpen(false); setPendingSave(null); }}>
            Cancel
          </Button>
        </div>
      </Modal>
    </Modal>
  );
}
