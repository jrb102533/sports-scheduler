import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit, Trash2, Plus, Users, Info, ClipboardList, UserCheck, Crown } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TeamForm } from '@/components/teams/TeamForm';
import { PlayerForm } from '@/components/roster/PlayerForm';
import { RosterTable } from '@/components/roster/RosterTable';
import { PlayerAttendanceHistory } from '@/components/attendance/PlayerAttendanceHistory';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useTeamStore } from '@/store/useTeamStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { RoleGuard } from '@/components/auth/RoleGuard';
import { useAuthStore, canEdit } from '@/store/useAuthStore';
import { SPORT_TYPE_LABELS, AGE_GROUP_LABELS } from '@/constants';
import { collection, getDocs, doc, setDoc, updateDoc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JoinRequest } from '@/types';

export function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const teams = useTeamStore(s => s.teams);
  const { deleteTeam } = useTeamStore();
  const players = usePlayerStore(s => s.players);
  const { deletePlayersForTeam } = usePlayerStore();
  const kidsMode = useSettingsStore(s => s.settings.kidsSportsMode);
  const profile = useAuthStore(s => s.profile);
  const team = teams.find(t => t.id === id);
  const userCanEdit = canEdit(profile, team ?? null);
  const [tab, setTab] = useState<'roster' | 'attendance' | 'info' | 'requests'>('roster');
  const [editOpen, setEditOpen] = useState(false);
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Join requests state
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [processingUids, setProcessingUids] = useState<Set<string>>(new Set());

  const canSeeRequests = profile && team && (
    profile.role === 'admin' ||
    team.createdBy === profile.uid ||
    team.coachId === profile.uid
  );

  useEffect(() => {
    if (tab !== 'requests' || !team || !canSeeRequests) return;
    setRequestsLoading(true);
    getDocs(query(collection(db, 'teams', team.id, 'joinRequests'), where('status', '==', 'pending')))
      .then(snap => {
        setJoinRequests(snap.docs.map(d => d.data() as JoinRequest));
      })
      .finally(() => setRequestsLoading(false));
  }, [tab, team?.id, canSeeRequests]);

  if (!team) return <div className="p-6 text-gray-500">Team not found.</div>;

  const teamId = team.id;
  const teamPlayers = players.filter(p => p.teamId === teamId);

  function handleDeleteTeam() {
    deletePlayersForTeam(teamId);
    deleteTeam(teamId);
    navigate('/teams');
  }

  async function handleApprove(request: JoinRequest) {
    setProcessingUids(prev => new Set(prev).add(request.uid));
    try {
      // Update user's teamId
      await setDoc(doc(db, 'users', request.uid), { teamId: teamId }, { merge: true });
      // Update request status
      await updateDoc(doc(db, 'teams', teamId, 'joinRequests', request.uid), { status: 'approved' });
      setJoinRequests(prev => prev.filter(r => r.uid !== request.uid));
    } finally {
      setProcessingUids(prev => { const s = new Set(prev); s.delete(request.uid); return s; });
    }
  }

  async function handleReject(request: JoinRequest) {
    setProcessingUids(prev => new Set(prev).add(request.uid));
    try {
      await updateDoc(doc(db, 'teams', teamId, 'joinRequests', request.uid), { status: 'rejected' });
      setJoinRequests(prev => prev.filter(r => r.uid !== request.uid));
    } finally {
      setProcessingUids(prev => { const s = new Set(prev); s.delete(request.uid); return s; });
    }
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
          <p className="text-sm text-gray-500">
            {SPORT_TYPE_LABELS[team.sportType]}
            {kidsMode && team.ageGroup && <span className="ml-2 text-blue-500">· {AGE_GROUP_LABELS[team.ageGroup]}</span>}
          </p>
        </div>
        {userCanEdit && <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}><Edit size={14} /> Edit</Button>}
        <RoleGuard roles={['admin']}><Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /></Button></RoleGuard>
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200">
        <button onClick={() => setTab('roster')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${tab === 'roster' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}>
          <span className="flex items-center gap-1.5"><Users size={14} /> Roster ({teamPlayers.length})</span>
        </button>
        <button onClick={() => setTab('attendance')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${tab === 'attendance' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}>
          <span className="flex items-center gap-1.5"><ClipboardList size={14} /> Attendance</span>
        </button>
        <button onClick={() => setTab('info')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${tab === 'info' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}>
          <span className="flex items-center gap-1.5"><Info size={14} /> Info</span>
        </button>
        {canSeeRequests && (
          <button onClick={() => setTab('requests')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === 'requests' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}>
            <span className="flex items-center gap-1.5"><UserCheck size={14} /> Requests</span>
          </button>
        )}
      </div>

      {tab === 'roster' && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-medium text-gray-800">Players</h3>
            {userCanEdit && <Button size="sm" onClick={() => setAddPlayerOpen(true)}><Plus size={14} /> Add Player</Button>}
          </div>
          <RosterTable players={teamPlayers} teamId={teamId} />
        </div>
      )}

      {tab === 'attendance' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="font-medium text-gray-800">Attendance History</h3>
            <p className="text-xs text-gray-500 mt-0.5">Last 8 events with attendance recorded</p>
          </div>
          <PlayerAttendanceHistory teamId={teamId} />
        </div>
      )}

      {tab === 'info' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-gray-700">Owner:</span>
            <span className="text-gray-600 ml-2 flex items-center gap-1">
              <Crown size={12} className="text-amber-400" /> {team.ownerName}
            </span>
          </div>
          {kidsMode && team.ageGroup && <div><span className="font-medium text-gray-700">Age Group:</span> <span className="text-gray-600 ml-2">{AGE_GROUP_LABELS[team.ageGroup]}</span></div>}
          {team.homeVenue && <div><span className="font-medium text-gray-700">Home Venue:</span> <span className="text-gray-600 ml-2">{team.homeVenue}</span></div>}
          {team.coachName && <div><span className="font-medium text-gray-700">Coach:</span> <span className="text-gray-600 ml-2">{team.coachName}</span></div>}
          {team.coachEmail && <div><span className="font-medium text-gray-700">Email:</span> <span className="text-gray-600 ml-2">{team.coachEmail}</span></div>}
        </div>
      )}

      {tab === 'requests' && canSeeRequests && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="font-medium text-gray-800">Join Requests</h3>
            <p className="text-xs text-gray-500 mt-0.5">Pending requests to join this team</p>
          </div>
          {requestsLoading ? (
            <div className="p-6 text-center text-sm text-gray-400">Loading requests…</div>
          ) : joinRequests.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">No pending join requests.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {joinRequests.map(req => {
                const isProcessing = processingUids.has(req.uid);
                return (
                  <div key={req.uid} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{req.displayName}</p>
                      <p className="text-xs text-gray-500">{req.email}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isProcessing}
                        onClick={() => handleReject(req)}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        disabled={isProcessing}
                        onClick={() => handleApprove(req)}
                      >
                        Approve
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <TeamForm open={editOpen} onClose={() => setEditOpen(false)} editTeam={team} />
      <PlayerForm open={addPlayerOpen} onClose={() => setAddPlayerOpen(false)} teamId={teamId} />
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
