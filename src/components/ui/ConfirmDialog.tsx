import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  typeToConfirm?: string;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Delete', typeToConfirm }: ConfirmDialogProps) {
  const [confirmValue, setConfirmValue] = useState('');

  useEffect(() => {
    if (!open) setConfirmValue('');
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-gray-600 mb-2">{message}</p>
      {typeToConfirm && (
        <input
          aria-label="Confirm deletion"
          placeholder={`Type "${typeToConfirm}" to confirm`}
          value={confirmValue}
          onChange={e => setConfirmValue(e.target.value)}
          className="w-full mt-2 mb-4 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      )}
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          variant="danger"
          disabled={typeToConfirm ? confirmValue !== typeToConfirm : false}
          onClick={() => { onConfirm(); onClose(); }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
