import { useState, useMemo } from 'react';
import { addDays, addWeeks, addMonths, parseISO, format, isAfter } from 'date-fns';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useEventStore } from '@/store/useEventStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useOpponentStore } from '@/store/useOpponentStore';
import { useAuthStore } from '@/store/useAuthStore';
import { todayISO } from '@/lib/dateUtils';
import { EVENT_TYPE_LABELS } from '@/constants';
import type { ScheduledEvent, EventType, EventStatus, RecurrenceFrequency } from '@/types';

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

function generateOccurrences(startDate: string, endDate: string, frequency: RecurrenceFrequency): string[] {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  const dates: string[] = [];
  let current = start;
  while (!isAfter(current, end)) {
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
  const { addEvent, bulkAddEvents } = useEventStore();
  const updateEvent = useEventStore(s => s.updateEvent);
  const allTeams = useTeamStore(s => s.teams);
  const { opponents, addOpponent } = useOpponentStore();
  const profile = useAuthStore(s => s.profile);
  const user = useAuthStore(s => s.user);

  // Teams the user can schedule for
  const myTeams = useMemo(() => {
    if (profile?.role === 'admin' || profile?.role === 'league_manager') return allTeams;
    return allTeams.filter(t => t.createdBy === user?.uid || t.coachId === user?.uid);
  }, [allTeams, profile, user]);

  // If a team is pre-set from the page context (e.g. TeamDetailPage), lock it
  const lockedTeamId = initial?.homeTeamId ?? '';
  const lockedTeam = lockedTeamId ? allTeams.find(t => t.id === lockedTeamId) : null;

  const [title, setTitle] = useState(editEvent?.title ?? '');
  const [type, setType] = useState<EventType>(editEvent?.type ?? initial?.type ?? 'game');
  const [date, setDate] = useState(editEvent?.date ?? initial?.date ?? todayISO());
  const [startTime, setStartTime] = useState(editEvent?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(editEvent?.endTime ?? '');
  const [location, setLocation] = useState(editEvent?.location ?? '');
  const [notes, setNotes] = useState(editEvent?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Team + home/away
  const [selectedTeamId, setSelectedTeamId] = useState(
    lockedTeamId || editEvent?.homeTeamId || editEvent?.awayTeamId || myTeams[0]?.id || ''
  );
  const [isHome, setIsHome] = useState(
    editEvent ? !!editEvent.homeTeamId : true
  );

  // Opponent
  const [opponentName, setOpponentName] = useState(editEvent?.opponentName ?? '');
  const [snackItem, setSnackItem] = useState(editEvent?.snackItem ?? '');

  // Recurrence
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('weekly');
  const [recurrenceEnd, setRecurrenceEnd] = useState('');

  const occurrenceCount = useMemo(() => {
    if (!isRecurring || !date || !recurrenceEnd || recurrenceEnd <= date) return 0;
    return generateOccurrences(date, recurrenceEnd, frequency).length;
  }, [isRecurring, date, recurrenceEnd, frequency]);

  const effectiveHomeTeamId = isHome ? selectedTeamId : '';
  const effectiveAwayTeamId = isHome ? '' : selectedTeamId;
  const contextTeamId = selectedTeamId;

  function validate() {
    const e: Record<string, string> = {};
    if (!date) e.date = 'Date is required';
    if (!startTime) e.startTime = 'Start time is required';
    if (!selectedTeamId) e.team = 'Team is required';
    if (!editEvent && isRecurring) {
      if (!recurrenceEnd) e.recurrenceEnd = 'End date is required for recurring events';
      else if (recurrenceEnd <= date) e.recurrenceEnd = 'End date must be after start date';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    const now = new Date().toISOString();
    const teamIds = [selectedTeamId].filter(Boolean);
    const resolvedTitle = title.trim() || EVENT_TYPE_LABELS[type];

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

    const optionals = {
      ...(endTime ? { endTime } : {}),
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(effectiveHomeTeamId ? { homeTeamId: effectiveHomeTeamId } : {}),
      ...(effectiveAwayTeamId ? { awayTeamId: effectiveAwayTeamId } : {}),
      ...(resolvedOpponentId ? { opponentId: resolvedOpponentId } : {}),
      ...(resolvedOpponentName ? { opponentName: resolvedOpponentName } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(snackItem.trim() ? { snackItem: snackItem.trim() } : {}),
    };

    if (editEvent) {
      updateEvent({ ...editEvent, title: resolvedTitle, type, date, startTime, teamIds, updatedAt: now, ...optionals });
    } else if (isRecurring && recurrenceEnd) {
      const groupId = crypto.randomUUID();
      const occurrences = generateOccurrences(date, recurrenceEnd, frequency);
      const events: ScheduledEvent[] = occurrences.map(occDate => ({
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
      bulkAddEvents(events);
    } else {
      addEvent({ id: crypto.randomUUID(), title: resolvedTitle, type, status: 'scheduled' as EventStatus, date, startTime, teamIds, isRecurring: false, createdAt: now, updatedAt: now, ...optionals });
    }
    onClose();
  }

  const myTeamOptions = myTeams.map(t => ({ value: t.id, label: t.name }));
  const selectedTeam = allTeams.find(t => t.id === selectedTeamId);

  return (
    <Modal open={open} onClose={onClose} title={editEvent ? 'Edit Event' : 'New Event'} size="md">
      <div className="space-y-4">
        <Input label="Title" value={title} onChange={e => setTitle(e.target.value)} error={errors.title} placeholder="e.g. Championship Game" />
        <Select label="Type" value={type} onChange={e => setType(e.target.value as EventType)} options={typeOptions} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} error={errors.date} />
          <Input label="Start Time" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} error={errors.startTime} />
        </div>
        <Input label="End Time (optional)" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
        <Input label="Location (optional)" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. City Park Field 1" />

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
            <input
              list="opponent-suggestions"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Type or select a past opponent…"
              value={opponentName}
              onChange={e => setOpponentName(e.target.value)}
            />
            <datalist id="opponent-suggestions">
              {opponents
                .filter(o => o.teamId === contextTeamId)
                .map(o => <option key={o.id} value={o.name} />)}
            </datalist>
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
            value={snackItem}
            onChange={e => setSnackItem(e.target.value)}
            placeholder="e.g. Orange slices and juice boxes"
          />
        )}

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Notes (optional)</label>
          <textarea
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
    </Modal>
  );
}
