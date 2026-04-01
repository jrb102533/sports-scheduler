import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { usePlayerStore } from '@/store/usePlayerStore';
import type { Player, PlayerAbsence } from '@/types';

interface MarkAbsenceModalProps {
  open: boolean;
  onClose: () => void;
  player: Player;
  teamId: string;
}

const ABSENCE_TYPE_OPTIONS = [
  { value: 'injured', label: 'Injured' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'other', label: 'Other' },
];

const ABSENCE_TYPE_LABELS: Record<string, string> = {
  injured: 'Injured',
  suspended: 'Suspended',
  other: 'Unavailable',
};

function formatReturnDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function MarkAbsenceModal({ open, onClose, player }: MarkAbsenceModalProps) {
  const updatePlayer = usePlayerStore(s => s.updatePlayer);

  const existing = player.absence ?? null;

  const [absenceType, setAbsenceType] = useState<'injured' | 'suspended' | 'other'>(
    existing?.type ?? 'injured'
  );
  const [returnDate, setReturnDate] = useState(existing?.returnDate ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const absence: PlayerAbsence = {
        type: absenceType,
        ...(returnDate ? { returnDate } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      const updated: Player = {
        ...player,
        absence,
        updatedAt: new Date().toISOString(),
      };
      await updateDoc(doc(db, 'players', player.id), { absence, updatedAt: updated.updatedAt });
      await updatePlayer(updated);
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    setError('');
    try {
      const updated: Player = {
        ...player,
        absence: null,
        updatedAt: new Date().toISOString(),
      };
      await updateDoc(doc(db, 'players', player.id), { absence: null, updatedAt: updated.updatedAt });
      await updatePlayer(updated);
      onClose();
    } catch {
      setError('Failed to clear absence. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Absence \u2014 ${player.firstName} ${player.lastName}`}
      size="sm"
    >
      <div className="space-y-4">
        {/* Current status summary */}
        {existing && (
          <div className="flex items-center justify-between rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5">
            <div className="text-sm text-gray-700">
              <span className="font-medium">Current:</span>{' '}
              {ABSENCE_TYPE_LABELS[existing.type]}
              {existing.returnDate && (
                <span className="text-gray-500"> &middot; returns {formatReturnDate(existing.returnDate)}</span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleClear()}
              disabled={saving}
              className="text-red-500 hover:text-red-600 hover:bg-red-50 shrink-0"
            >
              Clear Absence
            </Button>
          </div>
        )}

        {/* Type */}
        <Select
          label="Type"
          value={absenceType}
          onChange={e => setAbsenceType(e.target.value as 'injured' | 'suspended' | 'other')}
          options={ABSENCE_TYPE_OPTIONS}
        />

        {/* Return date */}
        <Input
          label="Expected Return Date (optional)"
          type="date"
          value={returnDate}
          onChange={e => setReturnDate(e.target.value)}
        />

        {/* Note */}
        <Textarea
          label="Private Note (optional)"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Visible to coaches only"
          rows={3}
        />

        {error && (
          <p className="text-xs text-red-600">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving\u2026' : existing ? 'Update Absence' : 'Mark Absent'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
