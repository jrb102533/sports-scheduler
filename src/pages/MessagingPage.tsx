import { useState } from 'react';
import { MessageSquare, Phone, Users, AlertCircle, Mail, CheckCircle, XCircle } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTeamStore } from '@/store/useTeamStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useAuthStore } from '@/store/useAuthStore';
import { functions } from '@/lib/firebase';
import { FEATURE_SMS } from '@/lib/features';
import type { Player, Team } from '@/types';


type Channel = 'sms' | 'email';
type SendState = 'idle' | 'sending' | 'success' | 'error';

const sendSms = httpsCallable<{ to: string[]; message: string }, { sent: number; failed: number; errors: string[] }>(
  functions, 'sendSms'
);

const sendEmailFn = httpsCallable<{ to: string[]; subject: string; message: string }, { sent: number; failed: number; errors: string[] }>(functions, 'sendEmail');

export function MessagingPage() {
  const allTeams = useTeamStore(s => s.teams);
  const players = usePlayerStore(s => s.players);
  const profile = useAuthStore(s => s.profile);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [channel, setChannel] = useState<Channel>(FEATURE_SMS ? 'sms' : 'email');
  const [sendState, setSendState] = useState<SendState>('idle');
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; errors: string[] } | null>(null);

  const isAdmin = profile?.role === 'admin';
  const teams: Team[] = isAdmin
    ? allTeams
    : allTeams.filter(t =>
        t.createdBy === profile?.uid ||
        t.coachId === profile?.uid ||
        t.id === profile?.teamId
      );

  const playersForChannel = (ch: Channel) =>
    players.filter(p =>
      teams.some(t => t.id === p.teamId) &&
      (ch === 'sms'
        ? !!p.parentContact?.parentPhone
        : !!(p.email || p.parentContact?.parentEmail))
    );

  const eligiblePlayers = playersForChannel(channel);

  function togglePlayer(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectTeam(teamId: string) {
    const teamPlayerIds = eligiblePlayers.filter(p => p.teamId === teamId).map(p => p.id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allSelected = teamPlayerIds.every(id => next.has(id));
      if (allSelected) {
        teamPlayerIds.forEach(id => next.delete(id));
      } else {
        teamPlayerIds.forEach(id => next.add(id));
      }
      return next;
    });
  }

  function switchChannel(ch: Channel) {
    setChannel(ch);
    setSendState('idle');
    setSendResult(null);
    setSubject('');
    setSelectedIds(prev => {
      const eligible = new Set(playersForChannel(ch).map(p => p.id));
      return new Set([...prev].filter(id => eligible.has(id)));
    });
  }

  const selectedPlayers: Player[] = players.filter(p => selectedIds.has(p.id));

  const phones = selectedPlayers
    .map(p => p.parentContact?.parentPhone)
    .filter(Boolean) as string[];

  const emailAddresses = [
    ...new Set(
      selectedPlayers.flatMap(p =>
        [p.email, p.parentContact?.parentEmail].filter(Boolean) as string[]
      )
    ),
  ];

  const canSend = channel === 'sms'
    ? phones.length > 0 && message.trim().length > 0
    : emailAddresses.length > 0 && subject.trim().length > 0 && message.trim().length > 0;

  async function handleSendEmail() {
    if (!canSend || sendState === 'sending') return;
    setSendState('sending');
    setSendResult(null);
    try {
      const result = await sendEmailFn({ to: emailAddresses, subject: subject.trim(), message: message.trim() });
      setSendResult(result.data);
      setSendState(result.data.failed === 0 ? 'success' : 'error');
      if (result.data.failed === 0) {
        setMessage('');
        setSubject('');
        setSelectedIds(new Set());
      }
    } catch (e: unknown) {
      setSendResult({ sent: 0, failed: emailAddresses.length, errors: [(e as Error).message] });
      setSendState('error');
    }
  }

  async function handleSendSms() {
    if (!canSend || sendState === 'sending') return;
    setSendState('sending');
    setSendResult(null);
    try {
      const result = await sendSms({ to: phones, message: message.trim() });
      setSendResult(result.data);
      setSendState(result.data.failed === 0 ? 'success' : 'error');
      if (result.data.failed === 0) {
        setMessage('');
        setSelectedIds(new Set());
      }
    } catch (e: unknown) {
      setSendResult({ sent: 0, failed: phones.length, errors: [(e as Error).message] });
      setSendState('error');
    }
  }

  return (
    <div className="p-6">
      {/* Channel tabs — SMS only shown when FEATURE_SMS is enabled */}
      {FEATURE_SMS && (
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          <button
            onClick={() => switchChannel('sms')}
            className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${channel === 'sms' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}
          >
            <MessageSquare size={14} /> SMS
          </button>
          <button
            onClick={() => switchChannel('email')}
            className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${channel === 'email' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}
          >
            <Mail size={14} /> Email
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recipient Selection */}
        <div>
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Users size={16} className="text-blue-500" /> Recipients
          </h2>

          {eligiblePlayers.length === 0 ? (
            <Card className="p-6 text-center">
              <AlertCircle size={28} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-600">No contacts yet</p>
              <p className="text-xs text-gray-400 mt-1">
                {channel === 'sms'
                  ? 'Add parent phone numbers to players in their roster to enable SMS.'
                  : 'Add player or parent email addresses to enable email messaging.'}
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {teams.map(team => {
                const teamPlayers = eligiblePlayers.filter(p => p.teamId === team.id);
                if (teamPlayers.length === 0) return null;
                const allSelected = teamPlayers.every(p => selectedIds.has(p.id));
                return (
                  <Card key={team.id} className="overflow-hidden">
                    <div
                      className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 cursor-pointer hover:bg-gray-50"
                      onClick={() => selectTeam(team.id)}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: team.color }} />
                        <span className="text-sm font-semibold text-gray-800">{team.name}</span>
                        <span className="text-xs text-gray-400">({teamPlayers.length})</span>
                      </div>
                      <span className="text-xs text-blue-500">{allSelected ? 'Deselect all' : 'Select all'}</span>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {teamPlayers.map(player => (
                        <label key={player.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(player.id)}
                            onChange={() => togglePlayer(player.id)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-900">{player.firstName} {player.lastName}</p>
                            {channel === 'sms' ? (
                              <p className="text-xs text-gray-500 flex items-center gap-1">
                                <Phone size={10} /> {player.parentContact?.parentName} · {player.parentContact?.parentPhone}
                              </p>
                            ) : (
                              <p className="text-xs text-gray-500 flex items-center gap-1 truncate">
                                <Mail size={10} />
                                {[player.email, player.parentContact?.parentEmail].filter(Boolean).join(', ')}
                              </p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Message Composer */}
        <div>
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            {channel === 'sms'
              ? <><MessageSquare size={16} className="text-green-500" /> Message</>
              : <><Mail size={16} className="text-blue-500" /> Message</>}
          </h2>
          <Card className="p-4 space-y-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">
                {selectedPlayers.length === 0
                  ? 'No recipients selected'
                  : channel === 'sms'
                    ? `${phones.length} recipient${phones.length !== 1 ? 's' : ''} selected`
                    : `${emailAddresses.length} email address${emailAddresses.length !== 1 ? 'es' : ''} (${selectedPlayers.length} player${selectedPlayers.length !== 1 ? 's' : ''})`}
              </p>
              {selectedPlayers.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {selectedPlayers.map(p => (
                    <span key={p.id} className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                      {p.parentContact?.parentName || `${p.firstName} ${p.lastName}`}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {channel === 'email' && (
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Subject</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Practice cancelled Saturday"
                  value={subject}
                  onChange={e => { setSubject(e.target.value); if (sendState !== 'idle') setSendState('idle'); }}
                />
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Message</label>
              <textarea
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={6}
                placeholder="Type your message here..."
                value={message}
                onChange={e => { setMessage(e.target.value); if (sendState !== 'idle') setSendState('idle'); }}
              />
              {channel === 'sms' && (
                <p className="text-xs text-gray-400 mt-1 text-right">{message.length}/160 chars</p>
              )}
            </div>

            {/* Send result feedback */}
            {sendResult && (
              <div className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${sendState === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {sendState === 'success'
                  ? <CheckCircle size={16} className="mt-0.5 shrink-0" />
                  : <XCircle size={16} className="mt-0.5 shrink-0" />}
                <div>
                  <p className="font-medium">
                    {sendState === 'success'
                      ? `Sent to ${sendResult.sent} recipient${sendResult.sent !== 1 ? 's' : ''}`
                      : `${sendResult.sent} sent, ${sendResult.failed} failed`}
                  </p>
                  {sendResult.errors.length > 0 && (
                    <ul className="mt-1 text-xs space-y-0.5">
                      {sendResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {channel === 'sms' ? (
                <Button
                  className="w-full"
                  disabled={!canSend || sendState === 'sending'}
                  onClick={handleSendSms}
                >
                  <MessageSquare size={15} />
                  {sendState === 'sending' ? 'Sending…' : `Send SMS${phones.length > 0 ? ` to ${phones.length}` : ''}`}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  disabled={!canSend || sendState === 'sending'}
                  onClick={handleSendEmail}
                >
                  <Mail size={15} />
                  {sendState === 'sending' ? 'Sending…' : canSend ? `Send Email to ${emailAddresses.length} recipient${emailAddresses.length !== 1 ? 's' : ''}` : 'Select recipients to send'}
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
