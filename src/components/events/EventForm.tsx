import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useEventStore } from '@/store/useEventStore';
import { useTeamStore } from '@/store/useTeamStore';
import { todayISO } from '@/lib/dateUtils';
import { EVENT_TYPE_LABELS } from '@/constants';
import type { ScheduledEvent, EventType, EventStatus } from '@/types';

interface EventFormProps {
  open: boolean;
  onClose: () => void;
  initial?: Partial<ScheduledEvent>;
  editEvent?: ScheduledEvent;
}

const typeOptions = Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => ({ value, label }));

export function EventForm({ open, onClose, initial, editEvent }: EventFormProps) {
  const { addEvent, updateEvent } = useEventStore();
  const teams = useTeamStore(s => s.teams);
  const teamOptions = teams.map(t => ({ value: t.id, label: t.name }));

  const [title, setTitle] = useState(editEvent?.title ?? '');
  const [type, setType] = useState<EventType>(editEvent?.type ?? initial?.type ?? 'game');
  const [date, setDate] = useState(editEvent?.date ?? initial?.date ?? todayISO());
  const [startTime, setStartTime] = useState(editEvent?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(editEvent?.endTime ?? '');
  const [location, setLocation] = useState(editEvent?.location ?? '');
  const [homeTeamId, setHomeTeamId] = useState(editEvent?.homeTeamId ?? '');
  const [awayTeamId, setAwayTeamId] = useState(editEvent?.awayTeamId ?? '');
  const [notes, setNotes] = useState(editEvent?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = 'Title is required';
    if (!date) e.date = 'Date is required';
    if (!startTime) e.startTime = 'Start time is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;
    const now = new Date().toISOString();
    const teamIds = [...new Set([homeTeamId, awayTeamId].filter(Boolean))];

    if (editEvent) {
      updateEvent({
        ...editEvent,
        title: title.trim(),
        type,
        date,
        startTime,
        endTime: endTime || undefined,
        location: location.trim() || undefined,
        homeTeamId: homeTeamId || undefined,
        awayTeamId: awayTeamId || undefined,
        teamIds,
        notes: notes.trim() || undefined,
        updatedAt: now,
      });
    } else {
      addEvent({
        id: crypto.randomUUID(),
        title: title.trim(),
        type,
        status: 'scheduled' as EventStatus,
        date,
        startTime,
        endTime: endTime || undefined,
        location: location.trim() || undefined,
        homeTeamId: homeTeamId || undefined,
        awayTeamId: awayTeamId || undefined,
        teamIds,
        notes: notes.trim() || undefined,
        isRecurring: false,
        createdAt: now,
        updatedAt: now,
      });
    }
    onClose();
  }

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
        {teamOptions.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <Select label="Home Team" value={homeTeamId} onChange={e => setHomeTeamId(e.target.value)} options={teamOptions} placeholder="Select team" />
            <Select label="Away Team" value={awayTeamId} onChange={e => setAwayTeamId(e.target.value)} options={teamOptions} placeholder="Select team" />
          </div>
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
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>{editEvent ? 'Save Changes' : 'Create Event'}</Button>
        </div>
      </div>
    </Modal>
  );
}
