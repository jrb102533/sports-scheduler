import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { League } from '@/types';

interface DeleteLeagueModalProps {
  open: boolean;
  league: League;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteLeagueModal({ open, league, onClose, onConfirm }: DeleteLeagueModalProps) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Delete League"
      message={`Are you sure you want to delete "${league.name}"? This action cannot be undone.`}
      confirmLabel="Delete League"
    />
  );
}
