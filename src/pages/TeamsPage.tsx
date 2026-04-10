import { useState, useEffect } from 'react';
import { Plus, Users, ChevronDown, ChevronRight, RotateCcw, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TeamCard } from '@/components/teams/TeamCard';
import { TeamForm } from '@/components/teams/TeamForm';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { useTeamStore } from '@/store/useTeamStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Team, Player, UserProfile } from '@/types';
import type { User } from 'firebase/auth';

export function TeamsPage() {
  const teams = useTeamStore(s => s.teams);
  const deletedTeams = useTeamStore(s => s.deletedTeams);
  const { restoreTeam, hardDeleteTeam } = useTeamStore();
  const players = usePlayerStore(s => s.players);
  const profile = useAuthStore(s => s.profile);
  const user = useAuthStore(s => s.user);
  const [becomeCoachOpen, setBecomeCoachOpen] = useState(false);
  const [findTeamOpen, setFindTeamOpen] = useState(false);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<Team | null>(null);
  // Map of teamId -> 'pending' | 'approved' | 'rejected' | null
  const [requestStatuses, setRequestStatuses] = useState<Record<string, string | null>>({});
  const [requestingIds, setRequestingIds] = useState<Set<string>>(new Set());
  const navigate = useNavigate();

  const isAdmin = profile?.role === 'admin';
  const isCoachOrAdmin = isAdmin || profile?.role === 'coach' || profile?.role === 'league_manager';

  // Pending join request counts per team — only loaded for coaches/admins
  const [pendingCounts, setPendingCounts] = useState<Record<string, number>>({});

  // Determine the user's own teams
  const myTeams: Team[] = isAdmin
    ? teams
    : teams.filter(t =>
        t.createdBy === profile?.uid ||
        t.coachId === profile?.uid ||
        t.coachIds?.includes(profile?.uid ?? '') ||
        t.id === profile?.teamId
      );

  const otherTeams: Team[] = isAdmin
    ? []
    : teams.filter(t => !myTeams.find(m => m.id === t.id));

  // Load existing join request statuses for other teams when user is logged in (non-admin)
  useEffect(() => {
    if (!user || isAdmin || otherTeams.length === 0) return;
    const uid = user.uid;
    Promise.all(
      otherTeams.map(async t => {
        const snap = await getDoc(doc(db, 'teams', t.id, 'joinRequests', uid));
        return { teamId: t.id, status: snap.exists() ? (snap.data().status as string) : null };
      })
    ).then(results => {
      const map: Record<string, string | null> = {};
      results.forEach(r => { map[r.teamId] = r.status; });
      setRequestStatuses(map);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, isAdmin, teams.length]);

  // Load pending join request counts for coaches/admins
  useEffect(() => {
    if (!isCoachOrAdmin || myTeams.length === 0) return;
    Promise.all(
      myTeams.map(async t => {
        const snap = await getDocs(query(collection(db, 'teams', t.id, 'joinRequests'), where('status', '==', 'pending')));
        return { teamId: t.id, count: snap.size };
      })
    ).then(results => {
      const map: Record<string, number> = {};
      results.forEach(r => { map[r.teamId] = r.count; });
      setPendingCounts(map);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCoachOrAdmin, myTeams.length]);

  async function requestToJoin(team: Team) {
    if (!user || !profile) return;
    setRequestingIds(prev => new Set(prev).add(team.id));
    try {
      await setDoc(doc(db, 'teams', team.id, 'joinRequests', user.uid), {
        uid: user.uid,
        displayName: profile.displayName,
        email: profile.email,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      setRequestStatuses(prev => ({ ...prev, [team.id]: 'pending' }));
    } finally {
      setRequestingIds(prev => { const s = new Set(prev); s.delete(team.id); return s; });
    }
  }

  const hasMyTeams = myTeams.length > 0;

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-500">
          {isAdmin
            ? `${teams.length} ${teams.length === 1 ? 'team' : 'teams'}`
            : `${myTeams.length} ${myTeams.length === 1 ? 'team' : 'teams'}`}
        </p>
        {user && (
          <Button onClick={() => setBecomeCoachOpen(true)}>
            <Plus size={16} /> New Team
          </Button>
        )}
      </div>

      {/* Non-admin with no teams, but teams exist to browse */}
      {!isAdmin && !hasMyTeams && otherTeams.length === 0 && (
        <EmptyState
          icon={<Users size={40} />}
          title="No teams yet"
          description="Create your first team to start managing rosters and scheduling events."
          action={
            user ? <Button onClick={() => setBecomeCoachOpen(true)}><Plus size={16} /> Create Team</Button> : undefined
          }
        />
      )}

      {!isAdmin && !hasMyTeams && otherTeams.length > 0 && (
        <FindTeamSection
          teams={otherTeams}
          players={players}
          requestStatuses={requestStatuses}
          requestingIds={requestingIds}
          onRequestJoin={requestToJoin}
          onNavigate={t => navigate(`/teams/${t.id}`)}
          user={user}
          profile={profile}
          defaultOpen
        />
      )}

      {(isAdmin || hasMyTeams) && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {myTeams.map(team => (
              <TeamCard
                key={team.id}
                team={team}
                playerCount={players.filter(p => p.teamId === team.id).length}
                pendingRequestCount={isCoachOrAdmin ? (pendingCounts[team.id] ?? 0) : undefined}
                onClick={() => navigate(`/teams/${team.id}`)}
              />
            ))}
          </div>

          {!isAdmin && otherTeams.length > 0 && (
            <FindTeamSection
              teams={otherTeams}
              players={players}
              requestStatuses={requestStatuses}
              requestingIds={requestingIds}
              onRequestJoin={requestToJoin}
              onNavigate={t => navigate(`/teams/${t.id}`)}
              user={user}
              profile={profile}
              defaultOpen={findTeamOpen}
              onToggle={() => setFindTeamOpen(o => !o)}
              collapsible
            />
          )}
        </>
      )}

      {/* Deleted teams — admin only */}
      {isAdmin && deletedTeams.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setDeletedOpen(o => !o)}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors mb-3"
          >
            {deletedOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            Deleted Teams ({deletedTeams.length})
          </button>
          {deletedOpen && (
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {deletedTeams.map(team => (
                <div key={team.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0 opacity-50" style={{ backgroundColor: team.color }}>
                    {team.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-500">{team.name}</p>
                    {team.deletedAt && (
                      <p className="text-xs text-gray-400">Deleted {new Date(team.deletedAt).toLocaleDateString()}</p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Button size="sm" variant="secondary" onClick={() => void restoreTeam(team.id)}>
                      <RotateCcw size={13} /> Restore
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setHardDeleteTarget(team)}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <TeamForm open={becomeCoachOpen} onClose={() => setBecomeCoachOpen(false)} />

      <ConfirmDialog
        open={!!hardDeleteTarget}
        onClose={() => setHardDeleteTarget(null)}
        onConfirm={() => hardDeleteTarget && void hardDeleteTeam(hardDeleteTarget.id)}
        title="Permanently Delete Team"
        message={`Permanently delete "${hardDeleteTarget?.name}"? This cannot be undone. All team data, roster, and events will be lost.`}
        confirmLabel="Permanently Delete"
        typeToConfirm={hardDeleteTarget?.name}
      />
    </div>
  );
}

interface FindTeamSectionProps {
  teams: Team[];
  players: Player[];
  requestStatuses: Record<string, string | null>;
  requestingIds: Set<string>;
  onRequestJoin: (team: Team) => void;
  onNavigate: (team: Team) => void;
  user: User | null;
  profile: UserProfile | null;
  defaultOpen?: boolean;
  collapsible?: boolean;
  onToggle?: () => void;
}

function FindTeamSection({
  teams, players, requestStatuses, requestingIds, onRequestJoin, onNavigate,
  user, profile, defaultOpen = false, collapsible = false, onToggle,
}: FindTeamSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  function toggle() {
    setOpen(o => !o);
    onToggle?.();
  }

  return (
    <div>
      <div
        onClick={collapsible ? toggle : undefined}
        className={`flex items-center gap-2 mb-4 ${collapsible ? 'cursor-pointer' : ''}`}
      >
        {collapsible && (open ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />)}
        <span className="font-semibold text-gray-900">Find a Team</span>
        <span className="text-sm text-gray-500">({teams.length})</span>
      </div>

      {(!collapsible || open) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {teams.map(team => {
            const status = requestStatuses[team.id];
            const isRequesting = requestingIds.has(team.id);
            const isOnTeam = profile?.teamId === team.id;
            const showRequestBtn = user && !isOnTeam && profile?.role !== 'admin';

            return (
              <div key={team.id} className="flex flex-col">
                <TeamCard
                  team={team}
                  playerCount={players.filter(p => p.teamId === team.id).length}
                  onClick={() => onNavigate(team)}
                />
                {showRequestBtn && (
                  <div className="px-1 pt-2">
                    {status === 'pending' ? (
                      <span className="text-xs text-yellow-600 font-medium">Request pending</span>
                    ) : status === 'approved' ? (
                      <span className="text-xs text-green-600 font-medium">Joined</span>
                    ) : status === 'rejected' ? (
                      <span className="text-xs text-red-500 font-medium">Request declined</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-full"
                        disabled={isRequesting}
                        onClick={e => { e.stopPropagation(); onRequestJoin(team); }}
                      >
                        {isRequesting ? 'Requesting…' : 'Request to Join'}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
