import { useState, useEffect } from 'react';
import { Plus, MapPin, Pencil, Trash2, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { useVenueStore } from '@/store/useVenueStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { Venue, VenueField, RecurringVenueWindow } from '@/types/venue';

const DAY_OPTIONS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

const DAY_SHORT: Record<number, string> = {
  0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat',
};

// ─── Venue Form ───────────────────────────────────────────────────────────────

interface VenueFormData {
  name: string;
  address: string;
  isOutdoor: boolean;
  fields: VenueField[];
  defaultAvailabilityWindows: RecurringVenueWindow[];
  defaultBlackoutDates: string[];
  notes: string;
}

const EMPTY_FORM: VenueFormData = {
  name: '',
  address: '',
  isOutdoor: true,
  fields: [],
  defaultAvailabilityWindows: [],
  defaultBlackoutDates: [],
  notes: '',
};

function venueToForm(v: Venue): VenueFormData {
  return {
    name: v.name,
    address: v.address,
    isOutdoor: v.isOutdoor,
    fields: v.fields,
    defaultAvailabilityWindows: v.defaultAvailabilityWindows ?? [],
    defaultBlackoutDates: v.defaultBlackoutDates ?? [],
    notes: v.notes ?? '',
  };
}

interface VenueFormModalProps {
  open: boolean;
  onClose: () => void;
  editVenue: Venue | null;
  onSave: (data: VenueFormData) => Promise<void>;
}

function VenueFormModal({ open, onClose, editVenue, onSave }: VenueFormModalProps) {
  const [form, setForm] = useState<VenueFormData>(EMPTY_FORM);
  const [fieldCount, setFieldCount] = useState('');
  const [newBlackout, setNewBlackout] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (open) {
      if (editVenue) {
        const f = venueToForm(editVenue);
        setForm(f);
        setFieldCount(String(f.fields.length));
      } else {
        setForm(EMPTY_FORM);
        setFieldCount('');
      }
      setErrors({});
      setSaveError('');
      setNewBlackout('');
    }
  }, [open, editVenue]);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form.address.trim()) e.address = 'Address is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setSaveError('');
    try {
      await onSave(form);
    } catch (e: unknown) {
      const raw = (e as { message?: string }).message ?? String(e);
      let userMessage: string;
      if (raw.includes('Missing or insufficient permissions')) {
        userMessage = 'Permission denied. Your role may not allow this action — try refreshing and signing in again.';
      } else if (raw === 'Not authenticated') {
        userMessage = 'You are not signed in. Please sign in and try again.';
      } else {
        userMessage = `Save failed: ${raw}`;
      }
      setSaveError(userMessage);
    } finally {
      setSaving(false);
    }
  }

  // Fields
  function handleFieldCountChange(val: string) {
    setFieldCount(val);
    const n = parseInt(val, 10);
    if (!isNaN(n) && n >= 0) {
      const existing = form.fields.slice(0, n);
      const added: VenueField[] = [];
      for (let i = existing.length; i < n; i++) {
        added.push({ id: crypto.randomUUID(), name: `Field ${i + 1}` });
      }
      setForm(f => ({ ...f, fields: [...existing, ...added] }));
    }
  }

  function updateFieldName(id: string, name: string) {
    setForm(f => ({ ...f, fields: f.fields.map(fld => fld.id === id ? { ...fld, name } : fld) }));
  }

  function addField() {
    const idx = form.fields.length + 1;
    setForm(f => ({ ...f, fields: [...f.fields, { id: crypto.randomUUID(), name: `Field ${idx}` }] }));
    setFieldCount(String(form.fields.length + 1));
  }

  function removeField(id: string) {
    setForm(f => ({ ...f, fields: f.fields.filter(fld => fld.id !== id) }));
    setFieldCount(String(form.fields.length - 1));
  }

  // Availability windows
  function addWindow() {
    setForm(f => ({
      ...f,
      defaultAvailabilityWindows: [
        ...f.defaultAvailabilityWindows,
        { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
      ],
    }));
  }

  function updateWindow(idx: number, patch: Partial<RecurringVenueWindow>) {
    setForm(f => ({
      ...f,
      defaultAvailabilityWindows: f.defaultAvailabilityWindows.map((w, i) =>
        i === idx ? { ...w, ...patch } : w
      ),
    }));
  }

  function removeWindow(idx: number) {
    setForm(f => ({
      ...f,
      defaultAvailabilityWindows: f.defaultAvailabilityWindows.filter((_, i) => i !== idx),
    }));
  }

  // Blackout dates
  function addBlackout() {
    if (!newBlackout) return;
    if (form.defaultBlackoutDates.includes(newBlackout)) return;
    setForm(f => ({ ...f, defaultBlackoutDates: [...f.defaultBlackoutDates, newBlackout].sort() }));
    setNewBlackout('');
  }

  function removeBlackout(date: string) {
    setForm(f => ({ ...f, defaultBlackoutDates: f.defaultBlackoutDates.filter(d => d !== date) }));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editVenue ? 'Edit Venue' : 'New Venue'}
      size="lg"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {/* Name */}
        <Input
          label="Name"
          name="venue-name"
          autoComplete="off"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          error={errors.name}
          placeholder="e.g. Riverside Sports Complex"
        />

        {/* Address */}
        <Input
          label="Address"
          name="street-address"
          autoComplete="street-address"
          value={form.address}
          onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
          error={errors.address}
          placeholder="123 Main St, City, State 12345"
        />

        {/* Indoor / Outdoor toggle */}
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Surface Type</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, isOutdoor: true }))}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                form.isOutdoor
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Outdoor
            </button>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, isOutdoor: false }))}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                !form.isOutdoor
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Indoor
            </button>
          </div>
        </div>

        {/* Fields section */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-gray-700">Fields / Courts</span>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              name="field-count"
              autoComplete="off"
              placeholder="Number of fields"
              value={fieldCount}
              onChange={e => handleFieldCountChange(e.target.value)}
              className="w-40"
              min="0"
            />
            <Button type="button" variant="secondary" size="sm" onClick={addField}>
              <Plus size={14} /> Add Field
            </Button>
          </div>
          {form.fields.length > 0 && (
            <div className="space-y-2 mt-1">
              {form.fields.map(fld => (
                <div key={fld.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    name="field-name"
                    autoComplete="off"
                    value={fld.name}
                    onChange={e => updateFieldName(fld.id, e.target.value)}
                    className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => removeField(fld.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Availability windows */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Default Availability Windows</span>
            <Button type="button" variant="secondary" size="sm" onClick={addWindow}>
              <Plus size={14} /> Add Window
            </Button>
          </div>
          {form.defaultAvailabilityWindows.length > 0 && (
            <div className="space-y-2">
              {form.defaultAvailabilityWindows.map((w, idx) => (
                <div key={idx} className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  <select
                    value={String(w.dayOfWeek)}
                    onChange={e => updateWindow(idx, { dayOfWeek: parseInt(e.target.value, 10) })}
                    className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white w-full sm:w-auto"
                  >
                    {DAY_OPTIONS.map(d => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                  <input
                    type="time"
                    value={w.startTime}
                    onChange={e => updateWindow(idx, { startTime: e.target.value })}
                    className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full sm:w-auto"
                  />
                  <span className="text-sm text-gray-500 hidden sm:block">to</span>
                  <input
                    type="time"
                    value={w.endTime}
                    onChange={e => updateWindow(idx, { endTime: e.target.value })}
                    className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full sm:w-auto"
                  />
                  <button
                    type="button"
                    onClick={() => removeWindow(idx)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Blackout dates */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-gray-700">Default Blackout Dates</span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={newBlackout}
              onChange={e => setNewBlackout(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <Button type="button" variant="secondary" size="sm" onClick={addBlackout} disabled={!newBlackout}>
              <Plus size={14} /> Add Date
            </Button>
          </div>
          {form.defaultBlackoutDates.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {form.defaultBlackoutDates.map(d => (
                <span
                  key={d}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-orange-50 text-orange-700 border border-orange-200 rounded-full text-xs font-medium"
                >
                  {d}
                  <button
                    type="button"
                    onClick={() => removeBlackout(d)}
                    className="hover:text-orange-900 ml-0.5"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        <Textarea
          label="Notes (optional)"
          name="venue-notes"
          autoComplete="off"
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          placeholder="Parking instructions, access codes, special rules..."
          rows={3}
        />

        {/* Actions */}
        {saveError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>
        )}
        <div className="flex justify-end gap-3 pt-1 border-t border-gray-100">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : editVenue ? 'Save Changes' : 'Create Venue'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Venue Card ───────────────────────────────────────────────────────────────

interface VenueCardProps {
  venue: Venue;
  onEdit: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}

function VenueCard({ venue, onEdit, onDelete }: VenueCardProps) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <MapPin size={18} className="text-blue-600" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 text-sm truncate">{venue.name}</h3>
            <p className="text-xs text-gray-500 truncate">{venue.address}</p>
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={onEdit}
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
            title="Edit venue"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
            title="Delete venue"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            venue.isOutdoor
              ? 'bg-green-50 text-green-700'
              : 'bg-indigo-50 text-indigo-700'
          }`}
        >
          {venue.isOutdoor ? 'Outdoor' : 'Indoor'}
        </span>
        {venue.fields.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">
            {venue.fields.length} {venue.fields.length === 1 ? 'field' : 'fields'}
          </span>
        )}
        {(venue.defaultAvailabilityWindows?.length ?? 0) > 0 && (
          <span className="text-xs text-gray-400">
            {venue.defaultAvailabilityWindows!.length} availability {venue.defaultAvailabilityWindows!.length === 1 ? 'window' : 'windows'}
          </span>
        )}
      </div>

      {venue.fields.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {venue.fields.map(f => (
            <span key={f.id} className="text-xs px-1.5 py-0.5 bg-gray-50 border border-gray-200 rounded text-gray-600">
              {f.name}
            </span>
          ))}
        </div>
      )}

      {(venue.defaultAvailabilityWindows?.length ?? 0) > 0 && (
        <div className="mt-2 space-y-0.5">
          {venue.defaultAvailabilityWindows!.map((w, i) => (
            <p key={i} className="text-xs text-gray-500">
              {DAY_SHORT[w.dayOfWeek]}: {w.startTime} – {w.endTime}
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function VenuesPage() {
  const { venues, addVenue, updateVenue, softDeleteVenue, subscribe } = useVenueStore();
  const user = useAuthStore(s => s.user);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Venue | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Venue | null>(null);

  useEffect(() => {
    const unsub = subscribe();
    return unsub;
  }, [subscribe]);

  function openAdd() {
    setEditTarget(null);
    setFormOpen(true);
  }

  function openEdit(venue: Venue, e: React.MouseEvent) {
    e.stopPropagation();
    setEditTarget(venue);
    setFormOpen(true);
  }

  async function handleSave(data: VenueFormData) {
    const now = new Date().toISOString();
    const uid = user?.uid ?? '';

    if (editTarget) {
      await updateVenue({
        ...editTarget,
        ...data,
        notes: data.notes || undefined,
        updatedAt: now,
      });
    } else {
      await addVenue({
        id: crypto.randomUUID(),
        ownerUid: uid,
        ...data,
        notes: data.notes || undefined,
        createdAt: now,
        updatedAt: now,
      });
    }

    setFormOpen(false);
  }

  async function handleDelete(venue: Venue) {
    await softDeleteVenue(venue.id);
    setDeleteTarget(null);
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-500">
          {venues.length} {venues.length === 1 ? 'venue' : 'venues'}
        </p>
        <Button onClick={openAdd}>
          <Plus size={16} /> New Venue
        </Button>
      </div>

      {venues.length === 0 ? (
        <EmptyState
          icon={<MapPin size={40} />}
          title="No venues yet"
          description="Create your first venue to reuse it across schedules."
          action={
            <Button onClick={openAdd}>
              <Plus size={16} /> New Venue
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {venues.map(venue => (
            <VenueCard
              key={venue.id}
              venue={venue}
              onEdit={e => openEdit(venue, e)}
              onDelete={e => { e.stopPropagation(); setDeleteTarget(venue); }}
            />
          ))}
        </div>
      )}

      <VenueFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editVenue={editTarget}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && void handleDelete(deleteTarget)}
        title="Remove Venue"
        message={`This venue will be hidden from your venue picker. Existing events are not affected.`}
        confirmLabel="Remove"
      />
    </div>
  );
}
