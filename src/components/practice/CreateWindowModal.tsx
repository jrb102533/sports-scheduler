import { useState } from 'react';
import { collection, doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/useAuthStore';
import type { PracticeSlotWindow, Venue } from '@/types';

const DAY_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  leagueId: string;
  seasonId: string;
  seasonStart: string;
  seasonEnd: string;
  savedVenues: Venue[];
}

export function CreateWindowModal({
  open,
  onClose,
  leagueId,
  seasonId,
  seasonStart,
  seasonEnd,
  savedVenues,
}: Props) {
  const uid = useAuthStore(s => s.user?.uid);

  const [name, setName] = useState('');
  const [venueId, setVenueId] = useState('');
  const [fieldId, setFieldId] = useState('');
  const [isOneOff, setIsOneOff] = useState(false);
  const [dayOfWeek, setDayOfWeek] = useState(6); // Saturday default
  const [oneOffDate, setOneOffDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('11:00');
  const [effectiveStart, setEffectiveStart] = useState(seasonStart);
  const [effectiveEnd, setEffectiveEnd] = useState(seasonEnd);
  const [capacity, setCapacity] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selectedVenue = savedVenues.find(v => v.id === venueId);

  function reset() {
    setName('');
    setVenueId('');
    setFieldId('');
    setIsOneOff(false);
    setDayOfWeek(6);
    setOneOffDate('');
    setStartTime('09:00');
    setEndTime('11:00');
    setEffectiveStart(seasonStart);
    setEffectiveEnd(seasonEnd);
    setCapacity('1');
    setBusy(false);
    setError('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleCreate() {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!venueId) { setError('Venue is required'); return; }
    if (isOneOff && !oneOffDate) { setError('Date is required for a one-off slot'); return; }
    if (!startTime || !endTime) { setError('Start and end time are required'); return; }
    if (!uid) { setError('You must be signed in'); return; }

    setBusy(true);
    setError('');

    try {
      const windowId = crypto.randomUUID();
      const now = new Date().toISOString();
      const selectedField = selectedVenue?.fields?.find(f => f.id === fieldId) ?? null;

      const windowDoc: PracticeSlotWindow = {
        id: windowId,
        name: name.trim(),
        venueId,
        venueName: selectedVenue?.name ?? '',
        fieldId: fieldId || null,
        fieldName: selectedField?.name ?? null,
        dayOfWeek: isOneOff ? null : dayOfWeek,
        startTime,
        endTime,
        effectiveStart: isOneOff ? oneOffDate : effectiveStart,
        effectiveEnd: isOneOff ? oneOffDate : effectiveEnd,
        oneOffDate: isOneOff ? oneOffDate : null,
        capacity: Math.max(1, parseInt(capacity) || 1),
        blackoutDates: [],
        status: 'active',
        createdBy: uid,
        createdAt: now,
        updatedAt: now,
      };

      await setDoc(
        doc(collection(db, 'leagues', leagueId, 'seasons', seasonId, 'practiceSlotWindows'), windowId),
        windowDoc,
      );

      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create window');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="New Practice Window">
      <div className="space-y-4" noValidate>
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Tuesday Evening — Field A"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Venue */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Venue</label>
          <select
            value={venueId}
            onChange={e => { setVenueId(e.target.value); setFieldId(''); }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a venue</option>
            {savedVenues.map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>

        {/* Field (optional) */}
        {selectedVenue && selectedVenue.fields.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Field <span className="text-gray-400 font-normal">(optional)</span></label>
            <select
              value={fieldId}
              onChange={e => setFieldId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Whole venue</option>
              {selectedVenue.fields.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Recurrence type */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" checked={!isOneOff} onChange={() => setIsOneOff(false)} />
            Weekly recurring
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" checked={isOneOff} onChange={() => setIsOneOff(true)} />
            One-off date
          </label>
        </div>

        {isOneOff ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              value={oneOffDate}
              min={seasonStart}
              max={seasonEnd}
              onChange={e => setOneOffDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Day of week</label>
              <select
                value={dayOfWeek}
                onChange={e => setDayOfWeek(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {DAY_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Active from</label>
                <input
                  type="date"
                  value={effectiveStart}
                  min={seasonStart}
                  max={seasonEnd}
                  onChange={e => setEffectiveStart(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Until</label>
                <input
                  type="date"
                  value={effectiveEnd}
                  min={seasonStart}
                  max={seasonEnd}
                  onChange={e => setEffectiveEnd(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </>
        )}

        {/* Time range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start time</label>
            <input
              type="time"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End time</label>
            <input
              type="time"
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Capacity */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Team capacity</label>
          <input
            type="number"
            min={1}
            max={20}
            value={capacity}
            onChange={e => setCapacity(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-400 mt-1">Maximum number of teams that can book this slot simultaneously.</p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={handleClose} disabled={busy}>Cancel</Button>
          <Button onClick={handleCreate} disabled={busy}>
            {busy ? 'Creating…' : 'Create Window'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
