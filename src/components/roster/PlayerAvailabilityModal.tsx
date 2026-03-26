import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAvailabilityStore, type UnavailableWindow } from '@/store/useAvailabilityStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { Player } from '@/types';

interface PlayerAvailabilityModalProps {
  open: boolean;
  onClose: () => void;
  player: Player;
  teamId: string;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatDisplayDate(iso: string): string {
  // Parse YYYY-MM-DD without timezone shift
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function PlayerAvailabilityModal({ open, onClose, player, teamId }: PlayerAvailabilityModalProps) {
  const { availability, setUnavailable } = useAvailabilityStore();
  const profile = useAuthStore(s => s.profile);

  const existing = availability[player.id]?.windows ?? [];

  // ── Access control ────────────────────────────────────────────────────────
  const isCoachOrAdmin =
    profile?.role === 'admin' ||
    profile?.role === 'league_manager' ||
    profile?.role === 'coach';

  // Players/parents can edit only their own linked record
  const isOwnRecord =
    profile?.uid !== undefined &&
    player.linkedUid === profile.uid;

  const canEdit = isCoachOrAdmin || isOwnRecord;

  // ── Add form state ────────────────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  function resetForm() {
    setStartDate('');
    setEndDate('');
    setReason('');
    setFormError('');
    setShowAddForm(false);
  }

  async function handleAdd() {
    if (!startDate) { setFormError('Start date is required.'); return; }
    if (!endDate) { setFormError('End date is required.'); return; }
    if (endDate < startDate) { setFormError('End date must be on or after start date.'); return; }
    setFormError('');
    setSaving(true);
    try {
      const newWindow: UnavailableWindow = {
        id: generateId(),
        startDate,
        endDate,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      };
      await setUnavailable(teamId, player.id, [...existing, newWindow]);
      resetForm();
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string) {
    setSaving(true);
    try {
      await setUnavailable(teamId, player.id, existing.filter(w => w.id !== id));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Manage Unavailability — ${player.firstName} ${player.lastName}`}
      size="md"
    >
      <div className="space-y-4">
        {/* Existing windows */}
        {existing.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No unavailability windows set.</p>
        ) : (
          <ul className="space-y-2">
            {existing.map(w => (
              <li
                key={w.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
              >
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-gray-800">
                    {formatDisplayDate(w.startDate)}
                    {w.startDate !== w.endDate && (
                      <> &ndash; {formatDisplayDate(w.endDate)}</>
                    )}
                  </span>
                  {w.reason && (
                    <span className="ml-2 text-gray-500">{w.reason}</span>
                  )}
                </div>
                {canEdit && (
                  <button
                    onClick={() => void handleRemove(w.id)}
                    disabled={saving}
                    aria-label="Remove window"
                    className="flex-shrink-0 p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 disabled:opacity-50"
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Add form */}
        {canEdit && (
          <>
            {!showAddForm ? (
              <Button variant="secondary" size="sm" onClick={() => setShowAddForm(true)}>
                <Plus size={13} /> Add Unavailable Period
              </Button>
            ) : (
              <div className="rounded-lg border border-gray-200 p-3 space-y-3">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">New Period</p>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Start Date"
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                  />
                  <Input
                    label="End Date"
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                  />
                </div>
                <Input
                  label="Reason (optional)"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Holiday, Injury, School trip"
                />
                {formError && (
                  <p className="text-xs text-red-600">{formError}</p>
                )}
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={resetForm} disabled={saving}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={() => void handleAdd()} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {!canEdit && (
          <p className="text-xs text-gray-400 text-center">You can only edit your own availability.</p>
        )}
      </div>
    </Modal>
  );
}
