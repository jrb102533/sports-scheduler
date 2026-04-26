import { useState } from 'react';
import { MapPin, Plus, Pencil, Trash2, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { RequiresPro } from '@/components/subscription/RequiresPro';
import { useLeagueVenueStore } from '@/store/useLeagueVenueStore';
import { useVenueStore } from '@/store/useVenueStore';
import type { LeagueVenue, Venue, VenueField } from '@/types';

// ─── League Venue Form Modal ──────────────────────────────────────────────────

interface VenueFormData {
  name: string;
  address: string;
  isOutdoor: boolean;
  fields: VenueField[];
  notes: string;
}

function leagueVenueToForm(v: LeagueVenue): VenueFormData {
  return {
    name: v.name,
    address: v.address,
    isOutdoor: v.isOutdoor,
    fields: v.fields,
    notes: v.notes ?? '',
  };
}

interface LeagueVenueFormModalProps {
  open: boolean;
  onClose: () => void;
  editVenue: LeagueVenue;
  onSave: (data: VenueFormData) => Promise<void>;
}

function LeagueVenueFormModal({ open, onClose, editVenue, onSave }: LeagueVenueFormModalProps) {
  const [form, setForm] = useState<VenueFormData>(() => leagueVenueToForm(editVenue));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof VenueFormData, string>>>({});

  function addField() {
    const idx = form.fields.length + 1;
    setForm(f => ({
      ...f,
      fields: [...f.fields, { id: crypto.randomUUID(), name: `Field ${idx}` }],
    }));
  }

  function updateFieldName(id: string, name: string) {
    setForm(f => ({ ...f, fields: f.fields.map(fld => fld.id === id ? { ...fld, name } : fld) }));
  }

  function removeField(id: string) {
    setForm(f => ({ ...f, fields: f.fields.filter(fld => fld.id !== id) }));
  }

  async function handleSave() {
    const errs: typeof errors = {};
    if (!form.name.trim()) errs.name = 'Name is required';
    if (!form.address.trim()) errs.address = 'Address is required';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit Venue" size="md">
      <div className="space-y-4">
        <Input
          label="Name"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          error={errors.name}
          placeholder="e.g. Riverside Sports Complex"
        />
        <Input
          label="Address"
          value={form.address}
          onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
          error={errors.address}
          placeholder="123 Main St, City, State 12345"
        />

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Surface Type</span>
          <div className="flex gap-2">
            {[true, false].map(outdoor => (
              <button
                key={String(outdoor)}
                type="button"
                onClick={() => setForm(f => ({ ...f, isOutdoor: outdoor }))}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  form.isOutdoor === outdoor
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {outdoor ? 'Outdoor' : 'Indoor'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Fields / Courts</span>
            <Button type="button" variant="secondary" size="sm" onClick={addField}>
              <Plus size={14} /> Add Field
            </Button>
          </div>
          {form.fields.length > 0 && (
            <div className="space-y-2">
              {form.fields.map(fld => (
                <div key={fld.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={fld.name}
                    onChange={e => updateFieldName(fld.id, e.target.value)}
                    className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => removeField(fld.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Textarea
          label="Notes"
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          placeholder="Parking info, access instructions, etc."
          rows={3}
        />

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Import Venue Modal ───────────────────────────────────────────────────────

interface ImportVenueModalProps {
  open: boolean;
  onClose: () => void;
  personalVenues: Venue[];
  alreadyImportedIds: Set<string>;
  onImport: (venue: Venue) => Promise<void>;
}

function ImportVenueModal({ open, onClose, personalVenues, alreadyImportedIds, onImport }: ImportVenueModalProps) {
  const [importing, setImporting] = useState<string | null>(null);

  const available = personalVenues.filter(v => !alreadyImportedIds.has(v.id));

  async function handleImport(venue: Venue) {
    setImporting(venue.id);
    try {
      await onImport(venue);
    } finally {
      setImporting(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Venue to League" size="md">
      <p className="text-sm text-gray-600 mb-4">
        Select one of your personal venues to add to this league's pool. A copy will be created
        so you can adjust it independently.
      </p>

      {available.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-500">
          {personalVenues.length === 0
            ? 'You have no personal venues yet. Create one on the Venues page first.'
            : 'All your venues have already been added to this league.'}
        </div>
      ) : (
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 overflow-hidden">
          {available.map(v => (
            <div key={v.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{v.name}</p>
                <p className="text-xs text-gray-500 truncate">{v.address}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                    v.isOutdoor ? 'bg-green-50 text-green-700' : 'bg-indigo-50 text-indigo-700'
                  }`}>
                    {v.isOutdoor ? 'Outdoor' : 'Indoor'}
                  </span>
                  {v.fields.length > 0 && (
                    <span className="text-xs text-gray-400">
                      {v.fields.length} {v.fields.length === 1 ? 'field' : 'fields'}
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={importing === v.id}
                onClick={() => handleImport(v)}
              >
                {importing === v.id ? 'Adding…' : 'Add'}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ─── League Venue Card ────────────────────────────────────────────────────────

interface LeagueVenueCardProps {
  venue: LeagueVenue;
  canManage: boolean;
  onEdit: () => void;
  onRemove: () => void;
}

function LeagueVenueCard({ venue, canManage, onEdit, onRemove }: LeagueVenueCardProps) {
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
        {canManage && (
          <div className="flex gap-1 flex-shrink-0">
            <RequiresPro>
              <button
                onClick={onEdit}
                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                title="Edit venue"
              >
                <Pencil size={14} />
              </button>
            </RequiresPro>
            <RequiresPro>
              <button
                onClick={onRemove}
                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                title="Remove from league"
              >
                <Trash2 size={14} />
              </button>
            </RequiresPro>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap mt-2">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          venue.isOutdoor ? 'bg-green-50 text-green-700' : 'bg-indigo-50 text-indigo-700'
        }`}>
          {venue.isOutdoor ? 'Outdoor' : 'Indoor'}
        </span>
        {venue.fields.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">
            {venue.fields.length} {venue.fields.length === 1 ? 'field' : 'fields'}
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

      {venue.notes && (
        <p className="text-xs text-gray-500 mt-2 line-clamp-2">{venue.notes}</p>
      )}
    </Card>
  );
}

// ─── League Venue Tab ─────────────────────────────────────────────────────────

interface LeagueVenueTabProps {
  leagueId: string;
  canManage: boolean;
  lmUid: string;
}

export function LeagueVenueTab({ leagueId, canManage, lmUid }: LeagueVenueTabProps) {
  const leagueVenues = useLeagueVenueStore(s => s.venues);
  const updateLeagueVenue = useLeagueVenueStore(s => s.updateLeagueVenue);
  const removeLeagueVenue = useLeagueVenueStore(s => s.removeLeagueVenue);
  const importVenue = useLeagueVenueStore(s => s.importVenue);
  const personalVenues = useVenueStore(s => s.venues);

  const [editTarget, setEditTarget] = useState<LeagueVenue | null>(null);
  const [removeTarget, setRemoveTarget] = useState<LeagueVenue | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const alreadyImportedIds = new Set(leagueVenues.map(lv => lv.sourceVenueId));

  async function handleSaveEdit(data: VenueFormData) {
    if (!editTarget) return;
    await updateLeagueVenue(leagueId, {
      ...editTarget,
      ...data,
      updatedAt: new Date().toISOString(),
    });
  }

  async function handleRemove() {
    if (!removeTarget) return;
    await removeLeagueVenue(leagueId, removeTarget.id);
    setRemoveTarget(null);
  }

  async function handleImport(venue: Venue) {
    await importVenue(leagueId, venue, lmUid);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">
          {leagueVenues.length} {leagueVenues.length === 1 ? 'venue' : 'venues'}
        </p>
        {canManage && (
          <RequiresPro>
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <Plus size={14} /> Add Venue
            </Button>
          </RequiresPro>
        )}
      </div>

      {leagueVenues.length === 0 ? (
        <EmptyState
          icon={<MapPin size={40} />}
          title="No venues yet"
          description="Add venues from your personal library to use them in league schedules."
          action={canManage ? (
            <RequiresPro><Button onClick={() => setImportOpen(true)}><Plus size={16} /> Add Venue</Button></RequiresPro>
          ) : undefined}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {leagueVenues.map(v => (
            <LeagueVenueCard
              key={v.id}
              venue={v}
              canManage={canManage}
              onEdit={() => setEditTarget(v)}
              onRemove={() => setRemoveTarget(v)}
            />
          ))}
        </div>
      )}

      {editTarget && (
        <LeagueVenueFormModal
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          editVenue={editTarget}
          onSave={handleSaveEdit}
        />
      )}

      <ConfirmDialog
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
        title="Remove Venue"
        message={`Remove "${removeTarget?.name}" from this league? Events already using this venue will not be affected.`}
      />

      <ImportVenueModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        personalVenues={personalVenues}
        alreadyImportedIds={alreadyImportedIds}
        onImport={handleImport}
      />
    </div>
  );
}

