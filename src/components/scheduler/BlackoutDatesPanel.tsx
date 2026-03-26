import { useEffect, useState } from 'react';
import { Plus, Trash2, BanIcon } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useBlackoutStore } from '@/store/useBlackoutStore';
import { useVenueStore } from '@/store/useVenueStore';
import { useAuthStore } from '@/store/useAuthStore';
import { format, parseISO } from 'date-fns';
import type { LeagueBlackout } from '@/types';

interface Props {
  leagueId: string;
}

export function BlackoutDatesPanel({ leagueId }: Props) {
  const { blackouts, loading, subscribe, addBlackout, deleteBlackout } = useBlackoutStore();
  const venues = useVenueStore(s => s.venues).filter(v => v.leagueId === leagueId && v.isActive);
  const profile = useAuthStore(s => s.profile);
  const uid = useAuthStore(s => s.user?.uid) ?? '';

  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [venueId, setVenueId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribe(leagueId);
    return unsub;
  }, [leagueId, subscribe]);

  const leagueBlackouts = blackouts.filter(b => b.leagueId === leagueId);
  const canManage = profile?.role === 'admin' || profile?.role === 'league_manager';

  function resetForm() {
    setLabel('');
    setStartDate('');
    setEndDate('');
    setVenueId('');
    setErrors({});
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!label.trim()) e.label = 'Label is required';
    if (!startDate) e.startDate = 'Start date is required';
    if (!endDate) e.endDate = 'End date is required';
    if (startDate && endDate && endDate < startDate) e.endDate = 'End date must be on or after start date';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const blackout: LeagueBlackout = {
      id: crypto.randomUUID(),
      leagueId,
      label: label.trim(),
      startDate,
      endDate,
      venueId: venueId || undefined,
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
    };
    await addBlackout(blackout);
    setSaving(false);
    setFormOpen(false);
    resetForm();
  }

  const venueOptions = [
    { value: '', label: 'All Venues' },
    ...venues.map(v => ({ value: v.id, label: v.name })),
  ];

  const confirmDeleteBlackout = leagueBlackouts.find(b => b.id === confirmDeleteId);

  function formatDateRange(b: LeagueBlackout) {
    const start = format(parseISO(b.startDate), 'MMM d, yyyy');
    const end = format(parseISO(b.endDate), 'MMM d, yyyy');
    return start === end ? start : `${start} – ${end}`;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500">{leagueBlackouts.length} blackout{leagueBlackouts.length !== 1 ? 's' : ''}</p>
        {canManage && (
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus size={14} /> Add Blackout
          </Button>
        )}
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">Loading…</div>
      ) : leagueBlackouts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
          No blackout dates set. Add blackouts for holidays or facility closures.
        </div>
      ) : (
        <div className="space-y-2">
          {leagueBlackouts.map(b => {
            const venue = venues.find(v => v.id === b.venueId);
            return (
              <div key={b.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                  <BanIcon size={15} className="text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{b.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {formatDateRange(b)}
                    {venue ? ` · ${venue.name}` : ' · All venues'}
                  </p>
                </div>
                {canManage && (
                  <button
                    onClick={() => setConfirmDeleteId(b.id)}
                    className="p-2 rounded-lg hover:bg-red-50 text-red-400 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal open={formOpen} onClose={() => { setFormOpen(false); resetForm(); }} title="Add Blackout Date" size="sm">
        <div className="space-y-4">
          <Input label="Label" value={label} onChange={e => setLabel(e.target.value)} error={errors.label} placeholder="e.g. Spring Break" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Start Date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} error={errors.startDate} />
            <Input label="End Date" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} error={errors.endDate} />
          </div>
          <Select label="Applies to" value={venueId} onChange={e => setVenueId(e.target.value)} options={venueOptions} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => { setFormOpen(false); resetForm(); }}>Cancel</Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Add Blackout'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={async () => {
          if (confirmDeleteId) await deleteBlackout(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        title="Remove Blackout"
        message={`Remove blackout "${confirmDeleteBlackout?.label}"?`}
      />
    </div>
  );
}
