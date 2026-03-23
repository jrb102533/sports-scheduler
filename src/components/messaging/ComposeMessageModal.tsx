import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { MessageSquare, Mail, Phone, Users, XCircle, AlertCircle, Send } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { useTeamStore } from '@/store/useTeamStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useAuthStore } from '@/store/useAuthStore';
import { functions } from '@/lib/firebase';
import { FEATURE_SMS } from '@/lib/features';
import type { Player } from '@/types';

type Channel = 'sms' | 'email';
type SendState = 'idle' | 'sending' | 'success' | 'error';

const sendSms = httpsCallable<{ to: string[]; message: string }, { sent: number; failed: number; errors: string[] }>(
  functions, 'sendSms'
);
const sendEmailFn = httpsCallable<{
  to: string[];
  subject: string;
  message: string;
  recipients?: { name: string; email: string }[];
  senderName?: string;
  teamName?: string;
}, { sent: number; failed: number; errors: string[] }>(functions, 'sendEmail');

interface ComposeMessageModalProps {
  open: boolean;
  onClose: () => void;
  defaultTeamId?: string;
}

export function ComposeMessageModal({ open, onClose, defaultTeamId }: ComposeMessageModalProps) {
  const allTeams = useTeamStore(s => s.teams);
  const players = usePlayerStore(s => s.players);
  const profile = useAuthStore(s => s.profile);

  const isAdmin = profile?.role === 'admin';
  const accessibleTeams = isAdmin
    ? allTeams
    : allTeams.filter(t => t.createdBy === profile?.uid || t.coachId === profile?.uid || t.id === profile?.teamId);

  const [channel, setChannel] = useState<Channel>(FEATURE_SMS ? 'sms' : 'email');
  const [teamId, setTeamId] = useState(defaultTeamId ?? accessibleTeams[0]?.id ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sendState, setSendState] = useState<SendState>('idle');
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; errors: string[] } | null>(null);
  const [successRecipients, setSuccessRecipients] = useState<string[]>([]);

  const team = accessibleTeams.find(t => t.id === teamId);

  const eligiblePlayers = players.filter(p => {
    if (p.teamId !== teamId) return false;
    return channel === 'sms'
      ? !!(p.parentContact?.parentPhone || p.parentContact2?.parentPhone)
      : !!(p.email || p.parentContact?.parentEmail || p.parentContact2?.parentEmail);
  });

  const allSelected = eligiblePlayers.length > 0 && eligiblePlayers.every(p => selectedIds.has(p.id));

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(eligiblePlayers.map(p => p.id)));
    }
  }

  function togglePlayer(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function switchChannel(ch: Channel) {
    setChannel(ch);
    setSelectedIds(new Set());
    setSendState('idle');
    setSendResult(null);
  }

  function switchTeam(id: string) {
    setTeamId(id);
    setSelectedIds(new Set());
    setSendState('idle');
    setSendResult(null);
  }

  const selectedPlayers: Player[] = players.filter(p => selectedIds.has(p.id));

  const phones = [...new Set(
    selectedPlayers.flatMap(p =>
      [p.parentContact?.parentPhone, p.parentContact2?.parentPhone].filter(Boolean) as string[]
    )
  )];

  const emailAddresses = [...new Set(
    selectedPlayers.flatMap(p =>
      [p.email, p.parentContact?.parentEmail, p.parentContact2?.parentEmail].filter(Boolean) as string[]
    )
  )];

  const canSend = channel === 'sms'
    ? phones.length > 0 && message.trim().length > 0
    : emailAddresses.length > 0 && subject.trim().length > 0 && message.trim().length > 0;

  async function handleSend() {
    if (!canSend || sendState === 'sending') return;
    setSendState('sending');
    setSendResult(null);
    try {
      const recipients = selectedPlayers.flatMap(p =>
        [
          p.email ? { name: `${p.firstName} ${p.lastName}`, email: p.email } : null,
          p.parentContact?.parentEmail ? { name: p.parentContact.parentName || `${p.firstName} ${p.lastName} (Parent)`, email: p.parentContact.parentEmail } : null,
          p.parentContact2?.parentEmail ? { name: p.parentContact2.parentName || `${p.firstName} ${p.lastName} (Parent 2)`, email: p.parentContact2.parentEmail } : null,
        ].filter(Boolean) as { name: string; email: string }[]
      );

      const result = channel === 'sms'
        ? await sendSms({ to: phones, message: message.trim() })
        : await sendEmailFn({
            to: emailAddresses,
            subject: subject.trim(),
            message: message.trim(),
            recipients,
            senderName: profile?.displayName ?? undefined,
            teamName: team?.name ?? undefined,
          });
      setSendResult(result.data);
      if (result.data.failed === 0) {
        setSuccessRecipients(selectedPlayers.map(p => `${p.firstName} ${p.lastName}`));
        setSendState('success');
        setMessage('');
        setSubject('');
        setSelectedIds(new Set());
      } else {
        setSendState('error');
      }
    } catch (e: unknown) {
      const count = channel === 'sms' ? phones.length : emailAddresses.length;
      setSendResult({ sent: 0, failed: count, errors: [(e as Error).message] });
      setSendState('error');
    }
  }

  const teamOptions = accessibleTeams.map(t => ({ value: t.id, label: t.name }));

  if (sendState === 'success') {
    return (
      <Modal open={open} onClose={onClose} title="Message Sent">
        <div className="flex flex-col items-center text-center py-4 gap-4">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
            <Send size={26} className="text-green-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-base mb-1">Message successfully sent</p>
            <p className="text-sm text-gray-500">
              Delivered to {successRecipients.length} {successRecipients.length === 1 ? 'recipient' : 'recipients'}:
            </p>
            <p className="text-sm text-gray-700 mt-1">{successRecipients.join(', ')}</p>
          </div>
          <Button className="w-full" onClick={onClose}>OK</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="New Message" size="lg">
      <div className="space-y-4">
        {/* Channel tabs */}
        {FEATURE_SMS && (
          <div className="flex gap-1 border-b border-gray-200 -mt-1">
            {(['sms', 'email'] as Channel[]).map(ch => (
              <button
                key={ch}
                onClick={() => switchChannel(ch)}
                className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${channel === ch ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}
              >
                {ch === 'sms' ? <><MessageSquare size={13} /> SMS</> : <><Mail size={13} /> Email</>}
              </button>
            ))}
          </div>
        )}

        {/* Team selector */}
        {accessibleTeams.length > 1 && (
          <Select
            label="Team"
            value={teamId}
            onChange={e => switchTeam(e.target.value)}
            options={teamOptions}
          />
        )}
        {accessibleTeams.length === 1 && team && (
          <div className="flex items-center gap-2 text-sm">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: team.color }} />
            <span className="font-medium text-gray-700">{team.name}</span>
          </div>
        )}

        {/* Recipients */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Users size={14} /> Recipients</label>
            {eligiblePlayers.length > 0 && (
              <button onClick={toggleSelectAll} className="text-xs text-blue-600 hover:underline">
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            )}
          </div>

          {eligiblePlayers.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 bg-gray-50 rounded-lg px-3 py-3">
              <AlertCircle size={15} />
              {channel === 'sms'
                ? 'No players with phone numbers on this team.'
                : 'No players with email addresses on this team.'}
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-44 overflow-y-auto">
              {eligiblePlayers.map(player => (
                <label key={player.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(player.id)}
                    onChange={() => togglePlayer(player.id)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">{player.firstName} {player.lastName}</p>
                    <p className="text-xs text-gray-400 flex items-center gap-1 truncate">
                      {channel === 'sms'
                        ? <><Phone size={10} /> {[player.parentContact?.parentPhone, player.parentContact2?.parentPhone].filter(Boolean).join(' · ')}</>
                        : <><Mail size={10} /> {[player.email, player.parentContact?.parentEmail, player.parentContact2?.parentEmail].filter(Boolean).join(', ')}</>
                      }
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Subject — email only */}
        {channel === 'email' && (
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Subject</label>
            <input
              type="text"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Practice cancelled Saturday"
              value={subject}
              onChange={e => { setSubject(e.target.value); setSendState('idle'); }}
            />
          </div>
        )}

        {/* Message */}
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Message</label>
          <textarea
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows={4}
            placeholder="Type your message here..."
            value={message}
            onChange={e => { setMessage(e.target.value); setSendState('idle'); }}
          />
          {channel === 'sms' && (
            <p className="text-xs text-gray-400 mt-1 text-right">{message.length}/160</p>
          )}
        </div>

        {/* Error feedback */}
        {sendState === 'error' && sendResult && (
          <div className="flex items-start gap-2 text-sm rounded-lg px-3 py-2 bg-red-50 text-red-700">
            <XCircle size={15} className="mt-0.5 shrink-0" />
            <p>{sendResult.sent} sent, {sendResult.failed} failed{sendResult.errors.length > 0 ? `: ${sendResult.errors[0]}` : ''}</p>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void handleSend()} disabled={!canSend || sendState === 'sending'}>
            {channel === 'sms' ? <MessageSquare size={15} /> : <Mail size={15} />}
            {sendState === 'sending' ? 'Sending…' : `Send${selectedPlayers.length > 0 ? ` to ${selectedPlayers.length}` : ''}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
