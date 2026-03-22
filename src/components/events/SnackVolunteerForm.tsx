import { useState } from 'react';
import { Cookie, X } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useEventStore } from '@/store/useEventStore';
import type { ScheduledEvent } from '@/types';

interface SnackVolunteerFormProps {
  event: ScheduledEvent;
}

export function SnackVolunteerForm({ event }: SnackVolunteerFormProps) {
  const { updateEvent } = useEventStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(event.snackVolunteer?.name ?? '');
  const [bringing, setBringing] = useState(event.snackVolunteer?.bringing ?? '');

  function handleSave() {
    if (!name.trim()) return;
    updateEvent({ ...event, snackVolunteer: { name: name.trim(), bringing: bringing.trim() }, updatedAt: new Date().toISOString() });
    setEditing(false);
  }

  function handleClear() {
    const updated = { ...event, updatedAt: new Date().toISOString() };
    delete updated.snackVolunteer;
    updateEvent(updated);
    setName('');
    setBringing('');
    setEditing(false);
  }

  return (
    <div className="border border-orange-200 bg-orange-50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-orange-800 flex items-center gap-2">
          <Cookie size={14} /> Snack Volunteer
        </h3>
        {event.snackVolunteer && !editing && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="ghost" size="sm" onClick={handleClear}><X size={13} /></Button>
          </div>
        )}
      </div>

      {!editing && event.snackVolunteer ? (
        <div className="text-sm text-orange-700">
          <span className="font-medium">{event.snackVolunteer.name}</span>
          {event.snackVolunteer.bringing && <span className="text-orange-600"> — {event.snackVolunteer.bringing}</span>}
        </div>
      ) : editing || !event.snackVolunteer ? (
        <div className="space-y-2">
          <Input placeholder="Volunteer name" value={name} onChange={e => setName(e.target.value)} />
          <Input placeholder="What they're bringing (e.g. orange slices, juice boxes)" value={bringing} onChange={e => setBringing(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={!name.trim()}>Save</Button>
            {editing && <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>}
          </div>
        </div>
      ) : null}
    </div>
  );
}
