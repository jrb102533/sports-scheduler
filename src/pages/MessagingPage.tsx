import { useState } from 'react';
import { MessageSquare, Phone, Users, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTeamStore } from '@/store/useTeamStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import type { Player } from '@/types';

export function MessagingPage() {
  const teams = useTeamStore(s => s.teams);
  const players = usePlayerStore(s => s.players);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');

  const playersWithPhone = players.filter(p => p.parentContact?.parentPhone);

  function togglePlayer(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectTeam(teamId: string) {
    const teamPlayerIds = playersWithPhone.filter(p => p.teamId === teamId).map(p => p.id);
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

  const selectedPlayers: Player[] = players.filter(p => selectedIds.has(p.id) && p.parentContact?.parentPhone);
  const phones = selectedPlayers.map(p => p.parentContact!.parentPhone).join(',');
  const smsUri = `sms:${phones}${message.trim() ? `?body=${encodeURIComponent(message.trim())}` : ''}`;
  const canSend = selectedPlayers.length > 0;

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recipient Selection */}
        <div>
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Users size={16} className="text-blue-500" /> Recipients
          </h2>

          {playersWithPhone.length === 0 ? (
            <Card className="p-6 text-center">
              <AlertCircle size={28} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-600">No contacts yet</p>
              <p className="text-xs text-gray-400 mt-1">Add parent phone numbers to players in their roster to enable messaging.</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {teams.map(team => {
                const teamPlayers = playersWithPhone.filter(p => p.teamId === team.id);
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
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                              <Phone size={10} /> {player.parentContact?.parentName} · {player.parentContact?.parentPhone}
                            </p>
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
            <MessageSquare size={16} className="text-green-500" /> Message
          </h2>
          <Card className="p-4 space-y-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">
                {selectedPlayers.length === 0 ? 'No recipients selected' : `${selectedPlayers.length} recipient${selectedPlayers.length !== 1 ? 's' : ''} selected`}
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

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Message</label>
              <textarea
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={6}
                placeholder="Type your message here..."
                value={message}
                onChange={e => setMessage(e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1 text-right">{message.length} chars</p>
            </div>

            <div className="space-y-2">
              {canSend ? (
                <a href={smsUri} className="block">
                  <Button className="w-full" disabled={!canSend}>
                    <MessageSquare size={15} /> Open in Messages App
                  </Button>
                </a>
              ) : (
                <Button className="w-full" disabled>
                  <MessageSquare size={15} /> Select recipients to send
                </Button>
              )}
              <p className="text-xs text-gray-400 text-center">
                Opens your device's native SMS app. No account required.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
