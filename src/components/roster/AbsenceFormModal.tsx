import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { useAbsenceStore } from '@/store/useAbsenceStore';
import { useAuthStore } from '@/store/useAuthStore';
import { todayISO } from '@/lib/dateUtils';
import type { Absence, AbsenceType, Player } from '@/types';

const ABSENCE_TYPE_OPTIONS: { value: AbsenceType; label: string }[] = [
  { value: 'injury', label: 'Injury' },
  { value: 'suspension', label: 'Suspension' },
  { value: 'personal', label: 'Personal' },
];

interface AbsenceFormModalProps {
  open: boolean;
  onClose: () => void;
  player: Player;
  /** If provided, we are editing/extending an existing absence. */
  editAbsence?: Absence;
}

export function AbsenceFormModal({ open, onClose, player, editAbsence }: AbsenceFormModalProps) {
  const profile = useAuthStore(s => s.profile);
  const addAbsence = useAbsenceStore(s => s.addAbsence);
  const updateAbsence = useAbsenceStore(s => s.updateAbsence);

  const today = todayISO();

  const [type, setType] = useState<AbsenceType>(editAbsence?.type ?? 'injury');
  const [startDate, setStartDate] = useState(editAbsence?.startDate ?? today);
  const [endDate, setEndDate] = useState(editAbsence?.endDate ?? '');
  const [note, setNote] = useState(editAbsence?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!startDate) e.startDate = 'Start date is required.';
    if (!endDate) e.endDate = 'Expected return date is required.';
    if (endDate && startDate && endDate < startDate) e.endDate = 'Return date must be on or after start date.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate() || !profile) return;
    setSaving(true);
    try {
      if (editAbsence) {
        await updateAbsence(player.teamId, editAbsence.id, { type, startDate, endDate, note: note || undefined });
      } else {
        const absence: Absence = {
          id: `abs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          teamId: player.teamId,
          playerId: player.id,
          playerName: `${player.firstName} ${player.lastName}`,
          type,
          startDate,
          endDate,
          note: note || undefined,
          status: 'active',
          createdBy: profile.uid,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await addAbsence(absence);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const title = editAbsence
    ? `Edit Absence — ${player.firstName} ${player.lastName}`
    : `Add Absence — ${player.firstName} ${player.lastName}`;

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="space-y-4">
        <Select
          label="Absence Type"
          options={ABSENCE_TYPE_OPTIONS}
          value={type}
          onChange={e => setType(e.target.value as AbsenceType)}
        />
        <Input
          label="Start Date"
          type="date"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
          error={errors.startDate}
        />
        <Input
          label="Expected Return Date"
          type="date"
          value={endDate}
          onChange={e => setEndDate(e.target.value)}
          error={errors.endDate}
        />
        <Textarea
          label="Private Note (coach only)"
          placeholder="Optional — not visible to players or parents"
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={3}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : editAbsence ? 'Save Changes' : 'Add Absence'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
