import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit, Trash2, Plus, Users, Info, ClipboardList, UserCheck, Crown, CalendarDays, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TeamForm } from '@/components/teams/TeamForm';
import { PlayerForm } from '@/components/roster/PlayerForm';
import { RosterTable } from '@/components/roster/RosterTable';
import { PlayerAttendanceHistory } from '@/components/attendance/PlayerAttendanceHistory';
import { EventCard } from '@/components/events/EventCard';
import { EventForm } from '@/components/events/EventForm';
import { EventDetailPanel } from '@/components/events/EventDetailPanel';
import { StandingsTable } from '@/components/standings/StandingsTable';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useTeamStore } from '@/store/useTeamStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useEventStore } from '@/store/useEventStore';
import { useLeagueStore } from '@/store/useLeagueStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { FLAGS } from '@/lib/flags';
import { RoleGuard } from '@/components/auth/RoleGuard';
import { useAuthStore, canEdit } from '@/store/useAuthStore';
import { SPORT_TYPE_LABELS, AGE_GROUP_LABELS } from '@/constants';
import { collection, getDocs, doc, setDoc, updateDoc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { JoinRequest, ScheduledEvent } from '@/types';

type Tab = 'schedule' | 'roster' | 'attendance' | 'standings' | 'info' | 'requests';

export function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const teams = useTeamStore(s => s.teams);
  const { softDeleteTeam, hardDeleteTeam } = useTeamStore();
  const players = usePlayerStore(s => s.players);
  const { deletePlayersForTeam } = usePlayerStore();
  const allEvents = useEventStore(s => s.events);
  const leagues = useLeagueStore(s => s.leagues);
  const kidsMode = FLAGS.KIDS_MODE && useSettingsStore(s => s.settings.kidsSportsMode);
  const profile = useAuthStore(s => s.profile);

  const team = teams.find(t => t.id === id);
  const userCanEdit = canEdit(profile, team ?? null);
  const league = team?.leagueId ? leagues.find(l => l.id === team.leagueId) : null;
  const leagueTeamIds = league ? teams.filter(t => t.leagueId === league.id).map(t => t.id) : null;

  const [tab, setTab] = useState<Tab>('schedule');
  const [editOpen, setEditOpen] = useState(false);
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<ScheduledEvent | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmHardDelete, setConfirmHardDelete] = useState(false);

  // Join requests state
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [processingUids, setProcessingUids] = useState<Set<string>>(new Set());
  const [pendingApprove, setPendingApprove] = useState<JoinRequest | null>(null);
  const [pendingReject, setPendingReject] = useState<JoinRequest | null>(null);

  const canSeeRequests = profile && team && (
    profile.role === 'admin' ||
    team.createdBy === profile.uid ||
    team.coachId === profile.uid
  );

  useEffect(() => {
    if (tab !== 'requests' || !team || !canSeeRequests) return;
    setRequestsLoading(true);
    getDocs(query(collection(db, 'teams', team.id, 'joinRequests'), where('status', '==', 'pending')))
      .then(snap => setJoinRequests(snap.docs.map(d => d.data() as JoinRequest)))
      .finally(() => setRequestsLoading(false));
  }, [tab, team?.id, canSeeRequests]);

  if (!team) return <div className="p-4 sm:p-6 text-gray-500">Team not found.</div>;

  const teamId = team.id;
  const teamPlayers = players.filter(p => p.teamId === teamId);
  const teamEvents = allEvents
    .filter(e => e.teamIds.includes(teamId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  const isAdmin = profile?.role === 'admin';
  const isOwner = !isAdmin && (
    team?.createdBy === profile?.uid || team?.coachId === profile?.uid
  );

  async function handleSoftDelete() {
    await softDeleteTeam(teamId);
    navigate('/teams');
  }

  async function handleHardDelete() {
    await deletePlayersForTeam(teamId);
    await hardDeleteTeam(teamId);
    navigate('/teams');
  }

  async function handleApprove(request: JoinRequest) {
    setProcessingUids(prev => new Set(prev).add(request.uid));
    try {
      await setDoc(doc(db, 'users', request.uid), { teamId }, { merge: true });
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

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'schedule', label: 'Schedule', icon: <CalendarDays size={14} /> },
    { key: 'roster', label: `Roster (${teamPlayers.length})`, icon: <Users size={14} /> },
    { key: 'attendance', label: 'Attendance', icon: <ClipboardList size={14} /> },
    { key: 'standings', label: 'Standings', icon: <Trophy size={14} /> },
    { key: 'info', label: 'Info', icon: <Info size={14} /> },
    ...(canSeeRequests ? [{ key: 'requests' as Tab, label: 'Requests', icon: <UserCheck size={14} /> }] : []),
  ];

  return (
    <div className="p-4 sm:p-6">
      <button onClick={() => navigate('/teams')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft size={14} /> Back to Teams
      </button>

      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg overflow-hidden flex-shrink-0"
          style={team.logoUrl ? { backgroundColor: '#f3f4f6' } : { backgroundColor: team.color }}>
          {team.logoUrl
            ? <img src={team.logoUrl} alt={team.name} className="w-full h-full object-contain" />
            : team.name.charAt(0).toUpperCase()
          }
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-900">{team.name}</h2>
          <p className="text-sm text-gray-500">
            {SPORT_TYPE_LABELS[team.sportType]}
            {kidsMode && team.ageGroup && <span className="ml-2 text-blue-500">· {AGE_GROUP_LABELS[team.ageGroup]}</span>}
            {league && (
              <button
                onClick={() => navigate(`/leagues/${league.id}`)}
                className="ml-2 text-indigo-500 hover:underline"
              >
                · {league.name}
              </button>
            )}
          </p>
        </div>
        {userCanEdit && <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}><Edit size={14} /> Edit</Button>}
        {isOwner && (
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} /> Delete
          </Button>
        )}
        {isAdmin && (
          <Button variant="danger" size="sm" onClick={() => setConfirmHardDelete(true)}>
            <Trash2 size={14} /> Delete
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.key ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Schedule Tab */}
      {tab === 'schedule' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-500">{teamEvents.length} {teamEvents.length === 1 ? 'event' : 'events'}</p>
            <RoleGuard roles={['admin', 'league_manager', 'coach']}>
              <Button size="sm" onClick={() => setEventFormOpen(true)}><Plus size={14} /> Add Event</Button>
            </RoleGuard>
          </div>
          {teamEvents.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
              No events scheduled yet.
            </div>
          ) : (
            <div className="space-y-2">
              {teamEvents.map(e => (
                <EventCard key={e.id} event={e} teams={teams} onClick={() => setSelectedEvent(e)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Roster Tab */}
      {tab === 'roster' && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-medium text-gray-800">Players</h3>
            {userCanEdit && <Button size="sm" onClick={() => setAddPlayerOpen(true)}><Plus size={14} /> Add Player</Button>}
          </div>
          <RosterTable players={teamPlayers} teamId={teamId} />
        </div>
      )}

      {/* Attendance Tab */}
      {tab === 'attendance' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="font-medium text-gray-800">Attendance History</h3>
            <p className="text-xs text-gray-500 mt-0.5">Last 8 events with attendance recorded</p>
          </div>
          <PlayerAttendanceHistory teamId={teamId} />
        </div>
      )}

      {/* Standings Tab */}
      {tab === 'standings' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {league && leagueTeamIds ? (
            <>
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-800">{league.name}</h3>
                  {league.season && <p className="text-xs text-gray-500">{league.season}</p>}
                </div>
                <button
                  onClick={() => navigate(`/leagues/${league.id}`)}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  View League →
                </button>
              </div>
              <StandingsTable teamIds={leagueTeamIds} />
            </>
          ) : (
            <div className="p-8 text-center text-sm text-gray-400">
              This team is not part of a league. Assign it to a league to see standings.
            </div>
          )}
        </div>
      )}

      {/* Info Tab */}
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
          {league && <div><span className="font-medium text-gray-700">League:</span> <span className="text-gray-600 ml-2">{league.name}</span></div>}
        </div>
      )}

      {/* Requests Tab */}
      {tab === 'requests' && canSeeRequests && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="font-medium text-gray-800">Join Requests</h3>
            <p className="text-xs text-gray-500 mt-0.5">Pending requests to join this team</p>
          </div>
          {requestsLoading ? (
            <div className="p-4 sm:p-6 text-center text-sm text-gray-400">Loading requests…</div>
          ) : joinRequests.length === 0 ? (
            <div className="p-4 sm:p-6 text-center text-sm text-gray-400">No pending join requests.</div>
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
                      <Button size="sm" variant="secondary" disabled={isProcessing} onClick={() => setPendingReject(req)}>Reject</Button>
                      <Button size="sm" disabled={isProcessing} onClick={() => setPendingApprove(req)}>Approve</Button>
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
      <EventForm
        open={eventFormOpen}
        onClose={() => setEventFormOpen(false)}
        initial={{ homeTeamId: teamId, teamIds: [teamId] }}
      />
      <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      {/* Owner soft-delete */}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void handleSoftDelete()}
        title="Delete Team"
        message={`"${team.name}" will be hidden and can be restored by an admin if needed. Players will not be affected.`}
        confirmLabel="Delete Team"
      />
      {/* Admin hard-delete */}
      <ConfirmDialog
        open={confirmHardDelete}
        onClose={() => setConfirmHardDelete(false)}
        onConfirm={() => void handleHardDelete()}
        title="Permanently Delete Team"
        message={`Permanently delete "${team.name}" and all its players? This cannot be undone.`}
        confirmLabel="Permanently Delete"
      />
      {/* Approve join request */}
      <ConfirmDialog
        open={!!pendingApprove}
        onClose={() => setPendingApprove(null)}
        onConfirm={() => { if (pendingApprove) void handleApprove(pendingApprove); }}
        title="Approve Join Request"
        message={`Allow ${pendingApprove?.displayName ?? 'this player'} to join this team?`}
        confirmLabel="Approve"
      />
      {/* Reject join request */}
      <ConfirmDialog
        open={!!pendingReject}
        onClose={() => setPendingReject(null)}
        onConfirm={() => { if (pendingReject) void handleReject(pendingReject); }}
        title="Reject Join Request"
        message={`Decline ${pendingReject?.displayName ?? 'this player'}'s request to join?`}
        confirmLabel="Decline"
      />
    </div>
  );
}
