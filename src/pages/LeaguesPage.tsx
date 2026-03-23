import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trophy, Users, Pencil, Trash2, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { LeagueForm } from '@/components/leagues/LeagueForm';
import { useLeagueStore } from '@/store/useLeagueStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { League, Team } from '@/types';

export function LeaguesPage() {
  const { leagues, addLeague, updateLeague, deleteLeague } = useLeagueStore();
  const { teams, updateTeam } = useTeamStore();
  const profile = useAuthStore(s => s.profile);
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<League | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<League | null>(null);

  const isAdmin = profile?.role === 'admin';

  const visibleLeagues = isAdmin
    ? leagues
    : leagues.filter(l => l.id === profile?.leagueId);

  function openEdit(league: League, e: React.MouseEvent) {
    e.stopPropagation();
    setEditTarget(league);
    setFormOpen(true);
  }

  function openAdd() {
    setEditTarget(null);
    setFormOpen(true);
  }

  async function handleDelete(league: League) {
    const assigned = teams.filter(t => t.leagueId === league.id);
    await Promise.all(assigned.map(t => updateTeam({ ...t, leagueId: undefined })));
    await deleteLeague(league.id);
    setDeleteTarget(null);
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-500">{visibleLeagues.length} {visibleLeagues.length === 1 ? 'league' : 'leagues'}</p>
        {isAdmin && (
          <Button onClick={openAdd}><Plus size={16} /> New League</Button>
        )}
      </div>

      {visibleLeagues.length === 0 ? (
        <EmptyState
          icon={<Trophy size={40} />}
          title="No leagues yet"
          description="Create a league to manage multi-team schedules and standings."
          action={isAdmin ? <Button onClick={openAdd}><Plus size={16} /> New League</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleLeagues.map(league => {
            const leagueTeams = teams.filter(t => t.leagueId === league.id);
            return (
              <LeagueCard
                key={league.id}
                league={league}
                leagueTeams={leagueTeams}
                isAdmin={isAdmin}
                onClick={() => navigate(`/leagues/${league.id}`)}
                onEdit={e => openEdit(league, e)}
                onDelete={e => { e.stopPropagation(); setDeleteTarget(league); }}
              />
            );
          })}
        </div>
      )}

      {formOpen && (
        <LeagueForm
          open={formOpen}
          onClose={() => setFormOpen(false)}
          editLeague={editTarget}
          allTeams={teams}
          onSave={async (leagueData, selectedTeamIds, prevTeamIds) => {
            const added = selectedTeamIds.filter(id => !prevTeamIds.includes(id));
            const removed = prevTeamIds.filter(id => !selectedTeamIds.includes(id));
            const leagueId = editTarget?.id ?? crypto.randomUUID();
            const now = new Date().toISOString();

            if (editTarget) {
              await updateLeague({ ...editTarget, ...leagueData, id: leagueId, updatedAt: now });
            } else {
              await addLeague({ ...leagueData, id: leagueId, createdAt: now, updatedAt: now });
            }

            await Promise.all([
              ...added.map(id => { const t = teams.find(tm => tm.id === id); return t ? updateTeam({ ...t, leagueId }) : Promise.resolve(); }),
              ...removed.map(id => { const t = teams.find(tm => tm.id === id); return t ? updateTeam({ ...t, leagueId: undefined }) : Promise.resolve(); }),
            ]);
            setFormOpen(false);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        title="Delete League"
        message={`Delete "${deleteTarget?.name}"? Teams in this league will be unassigned but not deleted.`}
      />
    </div>
  );
}

// ─── League Card ─────────────────────────────────────────────────────────────

interface LeagueCardProps {
  league: League;
  leagueTeams: Team[];
  isAdmin: boolean;
  onClick: () => void;
  onEdit: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}

function LeagueCard({ league, leagueTeams, isAdmin, onClick, onEdit, onDelete }: LeagueCardProps) {
  return (
    <Card className="p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={onClick}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <Trophy size={18} className="text-indigo-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">{league.name}</h3>
            {league.season && <p className="text-xs text-gray-500">{league.season}</p>}
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {isAdmin && (
            <>
              <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                <Pencil size={14} />
              </button>
              <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                <Trash2 size={14} />
              </button>
            </>
          )}
          <span className="p-1.5 text-gray-300">
            <ChevronRight size={14} />
          </span>
        </div>
      </div>

      {league.description && (
        <p className="text-xs text-gray-500 mb-3">{league.description}</p>
      )}

      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <Users size={12} />
        <span>{leagueTeams.length} {leagueTeams.length === 1 ? 'team' : 'teams'}</span>
      </div>

      {leagueTeams.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {leagueTeams.map(t => (
            <span
              key={t.id}
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: t.color + '22', color: t.color }}
            >
              {t.name}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
