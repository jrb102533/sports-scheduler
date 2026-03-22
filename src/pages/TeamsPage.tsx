import { useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { TeamCard } from '@/components/teams/TeamCard';
import { TeamForm } from '@/components/teams/TeamForm';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { useTeamStore } from '@/store/useTeamStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useNavigate } from 'react-router-dom';

export function TeamsPage() {
  const teams = useTeamStore(s => s.teams);
  const players = usePlayerStore(s => s.players);
  const [formOpen, setFormOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-500">{teams.length} {teams.length === 1 ? 'team' : 'teams'}</p>
        <Button onClick={() => setFormOpen(true)}>
          <Plus size={16} /> New Team
        </Button>
      </div>

      {teams.length === 0 ? (
        <EmptyState
          icon={<Users size={40} />}
          title="No teams yet"
          description="Create your first team to start managing rosters and scheduling events."
          action={<Button onClick={() => setFormOpen(true)}><Plus size={16} /> Create Team</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {teams.map(team => (
            <TeamCard
              key={team.id}
              team={team}
              playerCount={players.filter(p => p.teamId === team.id).length}
              onClick={() => navigate(`/teams/${team.id}`)}
            />
          ))}
        </div>
      )}

      <TeamForm open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  );
}
