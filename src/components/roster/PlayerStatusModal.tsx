import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { usePlayerStore } from '@/store/usePlayerStore';
import type { Player, PlayerStatus } from '@/types';

interface PlayerStatusModalProps {
  open: boolean;
  onClose: () => void;
  player: Player;
}

const statusOptions: { value: PlayerStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'injured', label: 'Injured' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'inactive', label: 'Inactive' },
];

export function PlayerStatusModal({ open, onClose, player }: PlayerStatusModalProps) {
  const { updatePlayer } = usePlayerStore();

  const [status, setStatus] = useState<PlayerStatus>(player.status);
  const [returnDate, setReturnDate] = useState(player.statusReturnDate ?? '');
  const [note, setNote] = useState(player.statusNote ?? '');
  const [saving, setSaving] = useState(false);

  const showReturnDate = status === 'injured' || status === 'suspended';

  async function handleSave() {
    setSaving(true);
    const now = new Date().toISOString();

    const updated: Player = {
      ...player,
      status,
      statusUpdatedAt: now,
      updatedAt: now,
    };

    if (showReturnDate && returnDate) {
      updated.statusReturnDate = returnDate;
    } else {
      delete updated.statusReturnDate;
    }

    if (note.trim()) {
      updated.statusNote = note.trim();
    } else {
      delete updated.statusNote;
    }

    // Clear status fields when returning to active/inactive
    if (status === 'active' || status === 'inactive') {
      delete updated.statusReturnDate;
      delete updated.statusNote;
      delete updated.statusUpdatedAt;
    }

    await updatePlayer(updated);
    setSaving(false);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Update Status — ${player.firstName} ${player.lastName}`}
      size="sm"
    >
      <div className="space-y-4">
        <Select
          label="Status"
          value={status}
          onChange={e => setStatus(e.target.value as PlayerStatus)}
          options={statusOptions}
        />

        {showReturnDate && (
          <Input
            label="Expected Return Date"
            type="date"
            value={returnDate}
            onChange={e => setReturnDate(e.target.value)}
          />
        )}

        {showReturnDate && (
          <div className="space-y-1">
            <Textarea
              label="Private Notes (coach-only)"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Hamstring strain, cleared by physio before next match"
              rows={3}
            />
            <p className="text-xs text-gray-400">
              These notes are only visible to coaches and admins — not to players or parents.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Status'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
