import { useState, useMemo } from 'react';
import { Send } from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useAuthStore } from '@/store/useAuthStore';
import { formatDate, formatTime } from '@/lib/dateUtils';
import type { ScheduledEvent } from '@/types';

interface RsvpInviteModalProps {
  open: boolean;
  onClose: () => void;
  event: ScheduledEvent;
}

interface RsvpRecipient { playerId: string; name: string; email: string; }

export function RsvpInviteModal({ open, onClose, event }: RsvpInviteModalProps) {
  const allPlayers = usePlayerStore(s => s.players);
  const allTeams = useTeamStore(s => s.teams);
  const profile = useAuthStore(s => s.profile);

  function playerEmails(p: typeof allPlayers[0]): string[] {
    return [p.email, p.parentContact?.parentEmail, p.parentContact2?.parentEmail]
      .filter((e): e is string => !!e?.trim());
  }

  const teamPlayers = useMemo(() => {
    return allPlayers.filter(p =>
      event.teamIds.includes(p.teamId) && playerEmails(p).length > 0
    );
  }, [allPlayers, event.teamIds]);

  const [selected, setSelected] = useState<Set<string>>(new Set(teamPlayers.map(p => p.id)));
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const teamName = allTeams.find(t => event.teamIds.includes(t.id))?.name ?? 'Your Team';
  const senderName = profile?.displayName ?? 'Coach';

  function togglePlayer(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === teamPlayers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(teamPlayers.map(p => p.id)));
    }
  }

  async function handleSend() {
    const recipients: RsvpRecipient[] = [];
    for (const player of teamPlayers) {
      if (!selected.has(player.id)) continue;
      const name = `${player.firstName} ${player.lastName}`;
      const emails = playerEmails(player);
      // Use first available email per player
      if (emails.length > 0) {
        recipients.push({ playerId: player.id, name, email: emails[0] });
      }
    }
    if (!recipients.length) return;

    setStatus('sending');
    try {
      const fn = httpsCallable(getFunctions(), 'sendEventInvite');
      await fn({
        eventId: event.id,
        eventTitle: event.title,
        eventDate: formatDate(event.date),
        eventTime: formatTime(event.startTime),
        ...(event.location ? { eventLocation: event.location } : {}),
        teamName,
        senderName,
        recipients,
      });
      setStatus('success');
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Failed to send invites.');
      setStatus('error');
    }
  }

  function handleClose() {
    setStatus('idle');
    setErrorMsg('');
    onClose();
  }

  const recipientCount = teamPlayers.filter(p => selected.has(p.id)).length;

  if (status === 'success') {
    const names = teamPlayers.filter(p => selected.has(p.id)).map(p => `${p.firstName} ${p.lastName}`);
    return (
      <Modal open={open} onClose={handleClose} title="Invites Sent" size="sm">
        <div className="text-center py-4 space-y-3">
          <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto" style={{ background: '#15803d' }}>
            <Send size={20} className="text-white" />
          </div>
          <p className="text-sm font-semibold text-gray-900">RSVP invites sent to:</p>
          <ul className="text-sm text-gray-600 space-y-0.5 max-h-40 overflow-y-auto">
            {names.map(n => <li key={n}>{n}</li>)}
          </ul>
          <Button onClick={handleClose} className="mt-2 w-full">OK</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title="Send RSVP Invites" size="sm">
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 space-y-0.5">
          <p className="font-semibold">{event.title}</p>
          <p className="text-gray-500">{formatDate(event.date)} at {formatTime(event.startTime)}{event.location ? ` · ${event.location}` : ''}</p>
        </div>

        {teamPlayers.length === 0 ? (
          <p className="text-sm text-gray-500">No players with email contacts found for this event.</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">Select recipients</p>
              <button onClick={toggleAll} className="text-xs text-blue-600 hover:underline">
                {selected.size === teamPlayers.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <ul className="space-y-2 max-h-52 overflow-y-auto">
              {teamPlayers.map(player => {
                const emails = playerEmails(player);
                return (
                  <li key={player.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(player.id)}
                      onChange={() => togglePlayer(player.id)}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">{player.firstName} {player.lastName}</p>
                      <p className="text-xs text-gray-400 truncate">{emails.join(', ')}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {status === 'error' && (
          <p className="text-sm text-red-600">{errorMsg}</p>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={() => void handleSend()}
            disabled={recipientCount === 0 || status === 'sending'}
          >
            {status === 'sending' ? 'Sending…' : `Send to ${recipientCount} player${recipientCount !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
