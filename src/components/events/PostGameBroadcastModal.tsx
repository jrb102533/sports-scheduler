import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import type { ScheduledEvent } from '@/types/event';
import type { Player } from '@/types/player';

interface PostGameBroadcastModalProps {
  open: boolean;
  onClose: () => void;
  event: ScheduledEvent;
  teamPlayers: Player[];
}

interface SendPostGameBroadcastData {
  eventId: string;
  teamId: string;
  message?: string;
  manOfTheMatchPlayerId?: string;
}

interface SendPostGameBroadcastResult {
  sent: number;
}

const sendPostGameBroadcastFn = httpsCallable<
  SendPostGameBroadcastData,
  SendPostGameBroadcastResult
>(functions, 'sendPostGameBroadcast');

export function PostGameBroadcastModal({
  open,
  onClose,
  event,
  teamPlayers,
}: PostGameBroadcastModalProps) {
  const [message, setMessage] = useState('');
  const [manOfTheMatchPlayerId, setManOfTheMatchPlayerId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const result = event.result;

  // Build the result summary line
  let resultSummary: string;
  if (result?.placement) {
    resultSummary = result.placement;
  } else if (result) {
    resultSummary = `${result.homeScore} \u2013 ${result.awayScore}`;
  } else {
    resultSummary = 'Result recorded';
  }

  const teamId = event.teamIds[0] ?? '';

  const playerOptions = teamPlayers.map(p => ({
    value: p.id,
    label: `${p.firstName} ${p.lastName}${p.jerseyNumber != null ? ` (#${p.jerseyNumber})` : ''}`,
  }));

  async function handleSend() {
    if (!teamId) return;
    setSending(true);
    setError(null);
    try {
      await sendPostGameBroadcastFn({
        eventId: event.id,
        teamId,
        message: message.trim() || undefined,
        manOfTheMatchPlayerId: manOfTheMatchPlayerId || undefined,
      });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send broadcast. Please try again.';
      setError(msg);
    } finally {
      setSending(false);
    }
  }

  function handleClose() {
    setMessage('');
    setManOfTheMatchPlayerId('');
    setError(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Broadcast Result to Team" size="sm">
      <div className="space-y-4">
        {/* Result summary */}
        <div className="bg-gray-50 rounded-xl p-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
            {event.title}
          </p>
          <p className="text-2xl font-bold text-gray-900">{resultSummary}</p>
        </div>

        {/* Optional post-game message */}
        <Textarea
          label="Post-game message (optional)"
          placeholder="Add a message to your team\u2026 (optional)"
          rows={3}
          value={message}
          onChange={e => setMessage(e.target.value)}
          disabled={sending}
        />

        {/* Player of the Match */}
        {teamPlayers.length > 0 && (
          <Select
            label="Player of the Match (optional)"
            options={playerOptions}
            placeholder="Select a player (optional)"
            value={manOfTheMatchPlayerId}
            onChange={e => setManOfTheMatchPlayerId(e.target.value)}
            disabled={sending}
          />
        )}

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            variant="primary"
            className="flex-1"
            onClick={handleSend}
            disabled={sending || !teamId}
          >
            {sending ? 'Sending\u2026' : 'Send Broadcast'}
          </Button>
          <Button variant="ghost" onClick={handleClose} disabled={sending}>
            Skip
          </Button>
        </div>
      </div>
    </Modal>
  );
}
