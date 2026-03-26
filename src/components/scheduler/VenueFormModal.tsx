import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import type { Venue, AvailabilitySlot } from '@/types';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayOptions = DAY_LABELS.map((label, i) => ({ value: String(i), label }));

interface Props {
  open: boolean;
  onClose: () => void;
  leagueId: string;
  createdBy: string;
  editVenue?: Venue;
  onSave: (venue: Venue) => Promise<void>;
}

export function VenueFormModal({ open, onClose, leagueId, createdBy, editVenue, onSave }: Props) {
  const [name, setName] = useState(editVenue?.name ?? '');
  const [address, setAddress] = useState(editVenue?.address ?? '');
  const [capacity, setCapacity] = useState(editVenue?.capacity ?? 1);
  const [slots, setSlots] = useState<AvailabilitySlot[]>(
    editVenue?.availabilitySlots ?? [{ dayOfWeek: 6, startTime: '09:00', endTime: '17:00' }]
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  function addSlot() {
    setSlots(s => [...s, { dayOfWeek: 6, startTime: '09:00', endTime: '17:00' }]);
  }

  function removeSlot(i: number) {
    setSlots(s => s.filter((_, idx) => idx !== i));
  }

  function updateSlot(i: number, patch: Partial<AvailabilitySlot>) {
    setSlots(s => s.map((slot, idx) => idx === i ? { ...slot, ...patch } : slot));
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required';
    if (capacity < 1) e.capacity = 'Capacity must be at least 1';
    if (slots.length === 0) e.slots = 'At least one availability slot is required';
    slots.forEach((slot, i) => {
      if (slot.startTime >= slot.endTime) e[`slot_${i}`] = 'End time must be after start time';
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const venue: Venue = {
      id: editVenue?.id ?? crypto.randomUUID(),
      leagueId,
      name: name.trim(),
      address: address.trim() || undefined,
      capacity,
      availabilitySlots: slots,
      isActive: editVenue?.isActive ?? true,
      createdBy: editVenue?.createdBy ?? createdBy,
      createdAt: editVenue?.createdAt ?? now,
      updatedAt: now,
    };
    await onSave(venue);
    setSaving(false);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={editVenue ? 'Edit Venue' : 'Add Venue'} size="md">
      <div className="space-y-4">
        <Input label="Venue Name" value={name} onChange={e => setName(e.target.value)} error={errors.name} placeholder="e.g. Riverside Sports Complex" />
        <Input label="Address (optional)" value={address} onChange={e => setAddress(e.target.value)} placeholder="e.g. 123 Main St" />
        <Input
          label="Simultaneous Fields / Courts"
          type="number"
          value={String(capacity)}
          onChange={e => setCapacity(Math.max(1, parseInt(e.target.value, 10) || 1))}
          error={errors.capacity}
        />

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">Availability Windows</label>
            <Button size="sm" variant="secondary" onClick={addSlot}><Plus size={14} /> Add Slot</Button>
          </div>
          {errors.slots && <p className="text-xs text-red-600 mb-2">{errors.slots}</p>}
          <div className="space-y-2">
            {slots.map((slot, i) => (
              <div key={i} className="flex items-end gap-2 p-3 bg-gray-50 rounded-lg">
                <div className="flex-1">
                  <Select
                    label="Day"
                    value={String(slot.dayOfWeek)}
                    onChange={e => updateSlot(i, { dayOfWeek: parseInt(e.target.value) as AvailabilitySlot['dayOfWeek'] })}
                    options={dayOptions}
                  />
                </div>
                <div className="w-28">
                  <Input label="Start" type="time" value={slot.startTime} onChange={e => updateSlot(i, { startTime: e.target.value })} />
                </div>
                <div className="w-28">
                  <Input label="End" type="time" value={slot.endTime} onChange={e => updateSlot(i, { endTime: e.target.value })} error={errors[`slot_${i}`]} />
                </div>
                <button
                  type="button"
                  onClick={() => removeSlot(i)}
                  className="mb-0.5 p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                  aria-label="Remove slot"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : editVenue ? 'Save Changes' : 'Add Venue'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
