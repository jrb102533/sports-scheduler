import { useState } from 'react';
import { Plus, Trophy, Users, Pencil, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { useLeagueStore } from '@/store/useLeagueStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { League, Team } from '@/types';
import { SPORT_TYPE_LABELS } from '@/constants';

export function LeaguesPage() {
  const { leagues, addLeague, updateLeague, deleteLeague } = useLeagueStore();
  const { teams, updateTeam } = useTeamStore();
  const profile = useAuthStore(s => s.profile);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<League | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<League | null>(null);

  const isAdmin = profile?.role === 'admin';

  // League managers see only their own league
  const visibleLeagues = isAdmin
    ? leagues
    : leagues.filter(l => l.id === profile?.leagueId);

  function openEdit(league: League) {
    setEditTarget(league);
    setFormOpen(true);
  }

  function openAdd() {
    setEditTarget(null);
    setFormOpen(true);
  }

  async function handleDelete(league: League) {
    // Clear leagueId from all assigned teams
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
          description="Create a league to manage multi-team schedules and game results."
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
                onEdit={() => openEdit(league)}
                onDelete={() => setDeleteTarget(league)}
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
            // Teams added to this league
            const added = selectedTeamIds.filter(id => !prevTeamIds.includes(id));
            // Teams removed from this league
            const removed = prevTeamIds.filter(id => !selectedTeamIds.includes(id));

            const leagueId = editTarget?.id ?? crypto.randomUUID();
            const now = new Date().toISOString();

            if (editTarget) {
              await updateLeague({ ...editTarget, ...leagueData, id: leagueId, updatedAt: now });
            } else {
              await addLeague({ ...leagueData, id: leagueId, createdAt: now, updatedAt: now });
            }

            await Promise.all([
              ...added.map(id => {
                const t = teams.find(tm => tm.id === id);
                return t ? updateTeam({ ...t, leagueId }) : Promise.resolve();
              }),
              ...removed.map(id => {
                const t = teams.find(tm => tm.id === id);
                return t ? updateTeam({ ...t, leagueId: undefined }) : Promise.resolve();
              }),
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
  onEdit: () => void;
  onDelete: () => void;
}

function LeagueCard({ league, leagueTeams, isAdmin, onEdit, onDelete }: LeagueCardProps) {
  return (
    <Card className="p-4">
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
        {isAdmin && (
          <div className="flex gap-1 flex-shrink-0">
            <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
              <Pencil size={14} />
            </button>
            <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
              <Trash2 size={14} />
            </button>
          </div>
        )}
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

// ─── League Form ─────────────────────────────────────────────────────────────

interface LeagueFormProps {
  open: boolean;
  onClose: () => void;
  editLeague: League | null;
  allTeams: Team[];
  onSave: (
    data: Omit<League, 'id' | 'createdAt' | 'updatedAt'>,
    selectedTeamIds: string[],
    prevTeamIds: string[],
  ) => Promise<void>;
}

const sportOptions = [
  { value: '', label: 'Any sport' },
  ...Object.entries(SPORT_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l })),
];

function LeagueForm({ open, onClose, editLeague, allTeams, onSave }: LeagueFormProps) {
  const [name, setName] = useState(editLeague?.name ?? '');
  const [season, setSeason] = useState(editLeague?.season ?? '');
  const [description, setDescription] = useState(editLeague?.description ?? '');
  const [sportType, setSportType] = useState(editLeague?.sportType ?? '');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState('');

  const prevTeamIds = allTeams.filter(t => t.leagueId === editLeague?.id).map(t => t.id);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(new Set(prevTeamIds));

  // Only show teams that are unassigned or already in this league
  const eligibleTeams = allTeams.filter(t =>
    !t.leagueId || t.leagueId === editLeague?.id
  );

  // If a sport filter is active, further filter teams
  const displayedTeams = sportType
    ? eligibleTeams.filter(t => t.sportType === sportType)
    : eligibleTeams;

  function toggleTeam(id: string) {
    setSelectedTeamIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (!name.trim()) { setNameError('League name is required'); return; }
    setNameError('');
    setSaving(true);
    try {
      await onSave(
        {
          name: name.trim(),
          ...(season.trim() ? { season: season.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(sportType ? { sportType: sportType as League['sportType'] } : {}),
          ...(editLeague?.managedBy ? { managedBy: editLeague.managedBy } : {}),
        } as Omit<League, 'id' | 'createdAt' | 'updatedAt'>,
        [...selectedTeamIds],
        prevTeamIds,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editLeague ? 'Edit League' : 'New League'}>
      <div className="space-y-4">
        <Input
          label="League Name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Metro Youth Soccer League"
          error={nameError}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Season"
            value={season}
            onChange={e => setSeason(e.target.value)}
            placeholder="e.g. Spring 2025"
          />
          <Select
            label="Sport"
            value={sportType}
            onChange={e => setSportType(e.target.value)}
            options={sportOptions}
          />
        </div>
        <Input
          label="Description"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Optional notes about this league"
        />

        {/* Team assignment */}
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Assign Teams</p>
          {displayedTeams.length === 0 ? (
            <p className="text-xs text-gray-400 italic">
              {allTeams.length === 0
                ? 'No teams exist yet.'
                : 'All teams are already assigned to other leagues.'}
            </p>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden max-h-52 overflow-y-auto">
              {displayedTeams.map(team => (
                <label key={team.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-0">
                  <input
                    type="checkbox"
                    checked={selectedTeamIds.has(team.id)}
                    onChange={() => toggleTeam(team.id)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: team.color }} />
                  <span className="text-sm text-gray-800">{team.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : editLeague ? 'Save Changes' : 'Create League'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
