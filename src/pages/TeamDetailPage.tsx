import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit, Trash2, Plus, Users, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TeamForm } from '@/components/teams/TeamForm';
import { PlayerForm } from '@/components/roster/PlayerForm';
import { RosterTable } from '@/components/roster/RosterTable';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useTeamStore } from '@/store/useTeamStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { SPORT_TYPE_LABELS } from '@/constants';

export function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const teams = useTeamStore(s => s.teams);
  const { deleteTeam } = useTeamStore();
  const players = usePlayerStore(s => s.players);
  const { deletePlayersForTeam } = usePlayerStore();
  const [tab, setTab] = useState<'info' | 'roster'>('roster');
  const [editOpen, setEditOpen] = useState(false);
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const team = teams.find(t => t.id === id);
  if (!team) return <div className="p-6 text-gray-500">Team not found.</div>;

  const teamId = team.id;
  const teamPlayers = players.filter(p => p.teamId === teamId);

  function handleDeleteTeam() {
    deletePlayersForTeam(teamId);
    deleteTeam(teamId);
    navigate('/teams');
  }

  return (
    <div className="p-6">
      <button onClick={() => navigate('/teams')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft size={14} /> Back to Teams
      </button>

      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg" style={{ backgroundColor: team.color }}>
          {team.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-900">{team.name}</h2>
          <p className="text-sm text-gray-500">{SPORT_TYPE_LABELS[team.sportType]}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}><Edit size={14} /> Edit</Button>
        <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /></Button>
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {(['roster', 'info'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${tab === t ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}>
            {t === 'roster' ? <span className="flex items-center gap-1.5"><Users size={14} /> Roster ({teamPlayers.length})</span> : <span className="flex items-center gap-1.5"><Info size={14} /> Info</span>}
          </button>
        ))}
      </div>

      {tab === 'roster' && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-medium text-gray-800">Players</h3>
            <Button size="sm" onClick={() => setAddPlayerOpen(true)}><Plus size={14} /> Add Player</Button>
          </div>
          <RosterTable players={teamPlayers} teamId={team.id} />
        </div>
      )}

      {tab === 'info' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3 text-sm">
          {team.homeVenue && <div><span className="font-medium text-gray-700">Home Venue:</span> <span className="text-gray-600 ml-2">{team.homeVenue}</span></div>}
          {team.coachName && <div><span className="font-medium text-gray-700">Coach:</span> <span className="text-gray-600 ml-2">{team.coachName}</span></div>}
          {team.coachEmail && <div><span className="font-medium text-gray-700">Email:</span> <span className="text-gray-600 ml-2">{team.coachEmail}</span></div>}
          {!team.homeVenue && !team.coachName && <p className="text-gray-400">No additional info. Edit the team to add details.</p>}
        </div>
      )}

      <TeamForm open={editOpen} onClose={() => setEditOpen(false)} editTeam={team} />
      <PlayerForm open={addPlayerOpen} onClose={() => setAddPlayerOpen(false)} teamId={team.id} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDeleteTeam}
        title="Delete Team"
        message={`Delete "${team.name}" and all its players? This cannot be undone.`}
      />
    </div>
  );
}
