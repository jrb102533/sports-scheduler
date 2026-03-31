import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { League } from '@/types';

interface DeleteLeagueModalProps {
  open: boolean;
  league: League;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteLeagueModal({ open, league, onClose, onConfirm }: DeleteLeagueModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isMatch = confirmText === league.name;

  async function handleConfirm() {
    if (!isMatch) return;
    setSubmitting(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setConfirmText('');
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Delete League" size="sm">
      <p className="text-sm text-gray-700 mb-3">
        Deleting this league will permanently hide all seasons, schedules, fixtures, and standings.
        Teams will remain intact but the league will no longer be visible to anyone.
      </p>
      <p className="text-sm text-gray-700 mb-1">
        Type <span className="font-semibold">{league.name}</span> to confirm
      </p>
      <Input
        value={confirmText}
        onChange={e => setConfirmText(e.target.value)}
        placeholder={league.name}
        autoComplete="off"
        className="mb-6"
      />
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={handleClose} disabled={submitting}>Cancel</Button>
        <Button variant="danger" onClick={handleConfirm} disabled={!isMatch || submitting}>
          {submitting ? 'Deleting…' : 'Delete League'}
        </Button>
      </div>
    </Modal>
  );
}
