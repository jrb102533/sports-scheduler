import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

interface DeleteTeamModalProps {
  open: boolean;
  teamName: string;
  /** Admin hard-delete: changes messaging and button label */
  permanent?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteTeamModal({ open, teamName, permanent = false, onClose, onConfirm }: DeleteTeamModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isMatch = confirmText === teamName;

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
    <Modal open={open} onClose={handleClose} title={permanent ? 'Permanently Delete Team' : 'Delete Team'} size="sm">
      <p className="text-sm text-gray-700 mb-3">
        {permanent
          ? 'This will permanently delete the team and all its players. This cannot be undone.'
          : 'This team will be hidden and can be restored by an admin if needed. Players will not be affected.'}
      </p>
      <p className="text-sm text-gray-700 mb-1">
        Type <span className="font-semibold">{teamName}</span> to confirm
      </p>
      <Input
        value={confirmText}
        onChange={e => setConfirmText(e.target.value)}
        placeholder={teamName}
        autoComplete="off"
        className="mb-6"
      />
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={handleClose} disabled={submitting}>Cancel</Button>
        <Button variant="danger" onClick={handleConfirm} disabled={!isMatch || submitting}>
          {submitting ? 'Deleting…' : permanent ? 'Permanently Delete' : 'Delete Team'}
        </Button>
      </div>
    </Modal>
  );
}
