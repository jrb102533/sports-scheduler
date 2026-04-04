import { useState } from 'react';
import { X } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { functions } from '@/lib/firebase';
import type { Player } from '@/types';

const sendInviteFn = httpsCallable<{
  to: string; playerName: string; teamName: string; playerId: string; teamId: string; role?: string;
}>(functions, 'sendInvite');

interface InvitePlayerSheetProps {
  open: boolean;
  player: Player;
  teamName: string;
  onClose: () => void;
  onSuccess: (playerId: string) => void;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function InvitePlayerSheet({ open, player, teamName, onClose, onSuccess }: InvitePlayerSheetProps) {
  const [parentEmail, setParentEmail] = useState('');
  const [playerEmail, setPlayerEmail] = useState('');
  const [sameEmailError, setSameEmailError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const playerName = `${player.firstName} ${player.lastName}`;

  const parentEmailTrimmed = parentEmail.trim();
  const playerEmailTrimmed = playerEmail.trim();

  const parentValid = parentEmailTrimmed !== '' && isValidEmail(parentEmailTrimmed);
  const playerValid = playerEmailTrimmed !== '' && isValidEmail(playerEmailTrimmed);
  const atLeastOne = parentValid || playerValid;

  function validate(): boolean {
    if (
      parentEmailTrimmed !== '' &&
      playerEmailTrimmed !== '' &&
      parentEmailTrimmed.toLowerCase() === playerEmailTrimmed.toLowerCase()
    ) {
      setSameEmailError('Parent and player email addresses must be different.');
      return false;
    }
    setSameEmailError('');
    return true;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const invites: Array<{ to: string; role: string }> = [];
      if (parentValid) invites.push({ to: parentEmailTrimmed, role: 'parent' });
      if (playerValid) invites.push({ to: playerEmailTrimmed, role: 'player' });
      for (const invite of invites) {
        await sendInviteFn({
          to: invite.to,
          playerName,
          teamName,
          playerId: player.id,
          teamId: player.teamId,
          role: invite.role,
        });
      }
      onSuccess(player.id);
      onClose();
    } catch (err) {
      console.error('Invite send failed:', err);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-sheet-title"
        className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-xl max-h-[90dvh] overflow-y-auto"
      >
        <div className="px-5 pt-5 pb-8 space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 id="invite-sheet-title" className="text-base font-semibold text-gray-900">
              Invite {playerName}
            </h2>
            <button
              onClick={onClose}
              aria-label="Close invite sheet"
              className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300"
            >
              <X size={18} />
            </button>
          </div>

          {/* Email fields */}
          <div className="space-y-4">
            <Input
              label="Parent Email (optional)"
              type="email"
              name="invite-parent-email"
              autoComplete="off"
              value={parentEmail}
              onChange={e => { setParentEmail(e.target.value); setSameEmailError(''); }}
              placeholder="parent@example.com"
            />
            <Input
              label="Player Email (optional)"
              type="email"
              name="invite-player-email"
              autoComplete="off"
              value={playerEmail}
              onChange={e => { setPlayerEmail(e.target.value); setSameEmailError(''); }}
              placeholder="player@example.com"
            />
            {sameEmailError && (
              <p className="text-xs text-red-600">{sameEmailError}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => void handleSubmit()}
              disabled={!atLeastOne || submitting}
            >
              {submitting ? 'Sending…' : 'Send Invite(s)'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
