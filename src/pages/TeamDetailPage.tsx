import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Edit, Trash2, Plus, Users, Info, ClipboardList, UserCheck, Crown, CalendarDays, Trophy, ClipboardCheck, Copy, Check, Mail, MessageSquare, Loader2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TeamForm } from '@/components/teams/TeamForm';
import { PlayerForm } from '@/components/roster/PlayerForm';
import { RosterTable } from '@/components/roster/RosterTable';
import { PlayerAttendanceHistory } from '@/components/attendance/PlayerAttendanceHistory';
import { EventCard } from '@/components/events/EventCard';
import { EventForm } from '@/components/events/EventForm';
import { EventDetailPanel } from '@/components/events/EventDetailPanel';
import { StandingsTable } from '@/components/standings/StandingsTable';
import { SubscribeToCalendarButton } from '@/components/calendar/SubscribeToCalendarButton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DeleteTeamModal } from '@/components/teams/DeleteTeamModal';
import { AssignCoCoachModal } from '@/components/teams/AssignCoCoachModal';
import { TeamChatPanel } from '@/components/teams/TeamChatPanel';
import { ComposeMessageModal } from '@/components/messaging/ComposeMessageModal';
import { isTeamUnread } from '@/lib/messagingUnread';
import { useTeamStore } from '@/store/useTeamStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useEventStore } from '@/store/useEventStore';
import { usePendingRosterChanges } from '@/hooks/usePendingRosterChanges';
import { useLeagueStore } from '@/store/useLeagueStore';
import { useAvailabilityStore } from '@/store/useAvailabilityStore';
import { RoleGuard } from '@/components/auth/RoleGuard';
import { useAuthStore, canEdit, hasRole, isCoachOfTeam, getMemberships } from '@/store/useAuthStore';
import { SPORT_TYPE_LABELS, AGE_GROUP_LABELS } from '@/constants';
import { collection, getDocs, doc, setDoc, updateDoc, query, where } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import type { JoinRequest, ScheduledEvent } from '@/types';

interface InviteDoc {
  id: string;      // Firestore document ID (composite key: email_teamId_role)
  email: string;   // Actual recipient email address (from document data)
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  role?: string;
  invitedAt: string;
  acceptedAt?: string;
}

const sendInviteFn = httpsCallable<{
  to: string; playerName: string; teamName: string; playerId: string; teamId: string; role?: string;
}>(functions, 'sendInvite');

const revokeInviteFn = httpsCallable<{ inviteId: string }>(functions, 'revokeInvite');

type Tab = 'schedule' | 'roster' | 'attendance' | 'standings' | 'chat' | 'info' | 'requests' | 'invites';

export function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const teams = useTeamStore(s => s.teams);
  const teamsLoading = useTeamStore(s => s.loading);
  const softDeleteTeam = useTeamStore(s => s.softDeleteTeam);
  const hardDeleteTeam = useTeamStore(s => s.hardDeleteTeam);
  const players = usePlayerStore(s => s.players);
  const deletePlayersForTeam = usePlayerStore(s => s.deletePlayersForTeam);
  const pendingRoster = usePendingRosterChanges();
  const allEvents = useEventStore(s => s.events);
  const leagues = useLeagueStore(s => s.leagues);
  const profile = useAuthStore(s => s.profile);

  const team = teams.find(t => t.id === id);
  const userCanEdit = canEdit(profile, team ?? null);
  const league = team?.leagueIds?.length ? leagues.find(l => team.leagueIds!.includes(l.id)) : null;
  const leagueTeamIds = league ? teams.filter(t => t.leagueIds?.includes(league.id)).map(t => t.id) : null;

  const [tab, setTab] = useState<Tab>('schedule');
  const [editOpen, setEditOpen] = useState(false);
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [initialEventType, setInitialEventType] = useState<'game' | 'practice'>('game');
  const [selectedEvent, setSelectedEvent] = useState<ScheduledEvent | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmHardDelete, setConfirmHardDelete] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [rosterCopied, setRosterCopied] = useState(false);
  const [assignCoCoachOpen, setAssignCoCoachOpen] = useState(false);
  const [rosterSaving, setRosterSaving] = useState(false);
  const [rosterSaveError, setRosterSaveError] = useState<string | null>(null);
  const [rosterSaveSuccess, setRosterSaveSuccess] = useState(false);

  // Join requests state
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [processingUids, setProcessingUids] = useState<Set<string>>(new Set());
  const [pendingApprove, setPendingApprove] = useState<JoinRequest | null>(null);
  const [pendingReject, setPendingReject] = useState<JoinRequest | null>(null);

  const canSeeRequests = profile && team && (
    isCoachOfTeam(profile, team.id) ||
    team.createdBy === profile.uid ||
    team.coachId === profile.uid ||
    team.coachIds?.includes(profile.uid)
  );

  // Invites state
  const [invites, setInvites] = useState<InviteDoc[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [resendingEmails, setResendingEmails] = useState<Set<string>>(new Set());
  const [revokingEmails, setRevokingEmails] = useState<Set<string>>(new Set());

  // Load player availability for this team on mount
  const loadAvailability = useAvailabilityStore(s => s.loadAvailability);
  useEffect(() => {
    if (!id) return;
    const unsub = loadAvailability(id);
    return unsub;
  }, [id, loadAvailability]);

  useEffect(() => {
    if (tab !== 'requests' || !team || !canSeeRequests) return;
    setRequestsLoading(true);
    getDocs(query(collection(db, 'teams', team.id, 'joinRequests'), where('status', '==', 'pending')))
      .then(snap => setJoinRequests(snap.docs.map(d => d.data() as JoinRequest)))
      .finally(() => setRequestsLoading(false));
  }, [tab, team?.id, canSeeRequests]);

  useEffect(() => {
    if (tab !== 'invites' || !team || !userCanEdit) return;
    setInvitesLoading(true);
    getDocs(query(collection(db, 'invites'), where('teamId', '==', team.id)))
      .then(snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<InviteDoc, 'id'>) }));
        setInvites(docs);
      })
      .catch(err => console.error('Failed to load invites:', err))
      .finally(() => setInvitesLoading(false));
  }, [tab, team?.id, userCanEdit]);

  // Open event panel when navigating here from a notification with openEventId in state
  useEffect(() => {
    const openEventId = (location.state as { openEventId?: string } | null)?.openEventId;
    if (!openEventId || allEvents.length === 0) return;
    const event = allEvents.find(e => e.id === openEventId);
    if (event) {
      setSelectedEvent(event);
      // Clear state so refresh doesn't re-open
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, allEvents]);

  if (!team) {
    // Avoid the "Team not found." flash before the team store hydrates —
    // both bad UX (briefly visible on real navigations) and a flaky-test
    // hazard for emulator E2E (Playwright reaches the assertion before the
    // subscription has populated). Show a loading state until the store
    // confirms it's done loading.
    if (teamsLoading) {
      return <div className="p-4 sm:p-6 text-gray-500" role="status">Loading team…</div>;
    }
    return <div className="p-4 sm:p-6 text-gray-500">Team not found.</div>;
  }

  const teamId = team.id;
  const teamPlayers = players.filter(p => p.teamId === teamId);
  const teamEvents = allEvents
    .filter(e => e.teamIds.includes(teamId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  const myTeamMembership = getMemberships(profile).find(m => m.teamId === teamId);
  const isAdminUser = hasRole(profile, 'admin');
  const isOwner = !isAdminUser && (
    team?.createdBy === profile?.uid ||
    team?.coachId === profile?.uid ||        // legacy fallback: coachId before memberships backfill
    team?.coachIds?.includes(profile?.uid ?? '') ||
    isCoachOfTeam(profile, team?.id ?? '')
  );

  // Attendance summary: events with attendance recorded
  const eventsWithAttendance = teamEvents.filter(e => e.attendanceRecorded && e.attendance && e.attendance.length > 0);
  const totalPresent = eventsWithAttendance.reduce((sum, e) => sum + (e.attendance?.filter(a => a.status === 'present').length ?? 0), 0);
  const totalRecorded = eventsWithAttendance.reduce((sum, e) => sum + (e.attendance?.length ?? 0), 0);
  const avgAttendancePct = totalRecorded > 0 ? Math.round((totalPresent / totalRecorded) * 100) : null;
  const lastAttendanceEvent = eventsWithAttendance.length > 0 ? eventsWithAttendance[eventsWithAttendance.length - 1] : null;
  const lastPresent = lastAttendanceEvent?.attendance?.filter(a => a.status === 'present').length ?? 0;
  const lastTotal = lastAttendanceEvent?.attendance?.length ?? 0;

  async function handleSaveRoster() {
    setRosterSaveError(null);
    setRosterSaving(true);
    try {
      await usePlayerStore.getState().bulkApplyRosterChanges(teamId, pendingRoster.state.changes);
      pendingRoster.exitMode();
      setRosterSaveSuccess(true);
      setTimeout(() => setRosterSaveSuccess(false), 3000);
    } catch (err: unknown) {
      console.error('[TeamDetailPage] bulk roster save failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setRosterSaveError(`Failed to save roster: ${msg}`);
    } finally {
      setRosterSaving(false);
    }
  }

  function handleDiscardRoster() {
    pendingRoster.exitMode();
    setRosterSaveError(null);
  }

  function handleCopyRoster() {
    const text = teamPlayers.map(p => `${p.firstName} ${p.lastName}`).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setRosterCopied(true);
      setTimeout(() => setRosterCopied(false), 2000);
    });
  }

  async function handleSoftDelete() {
    try {
      await softDeleteTeam(teamId);
      navigate('/teams');
    } catch (err: any) {
      console.error('Delete team failed:', err);
      alert(err?.message ?? 'Failed to delete team. Please try again.');
    }
  }

  async function handleHardDelete() {
    try {
      // hardDeleteTeam callable requires the team to be soft-deleted first
      // (functions/src/index.ts: failed-precondition unless team.isDeleted).
      // Admin only sees this button (isOwner is hardcoded false for admins),
      // so soft-delete here on their behalf before permanent removal.
      if (!team?.isDeleted) {
        await softDeleteTeam(teamId);
      }
      await deletePlayersForTeam(teamId);
      await hardDeleteTeam(teamId);
      navigate('/teams');
    } catch (err: any) {
      console.error('Hard delete team failed:', err);
      alert(err?.message ?? 'Failed to delete team. Please try again.');
    }
  }

  async function handleApprove(request: JoinRequest) {
    setProcessingUids(prev => new Set(prev).add(request.uid));
    try {
      await httpsCallable<{ teamId: string; requestUid: string }, { success: boolean }>(
        functions,
        'approveJoinRequest',
      )({ teamId, requestUid: request.uid });
      // Write in-app notification to approved user
      const notifId = `join-approved-${teamId}-${Date.now()}`;
      await setDoc(doc(db, 'users', request.uid, 'notifications', notifId), {
        id: notifId,
        type: 'info',
        title: 'Join request approved',
        message: `Your request to join ${team!.name} has been approved. Welcome to the team!`,
        isRead: false,
        createdAt: new Date().toISOString(),
      });
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

  async function handleResendInvite(invite: InviteDoc) {
    setResendingEmails(prev => new Set(prev).add(invite.email));
    try {
      await sendInviteFn({
        to: invite.email,
        playerName: invite.playerName,
        teamName: invite.teamName,
        playerId: invite.playerId,
        teamId: invite.teamId,
        ...(invite.role ? { role: invite.role } : {}),
      });
    } finally {
      setResendingEmails(prev => { const s = new Set(prev); s.delete(invite.email); return s; });
    }
  }

  async function handleRevokeInvite(invite: InviteDoc) {
    setRevokingEmails(prev => new Set(prev).add(invite.id));
    try {
      await revokeInviteFn({ inviteId: invite.id });
      setInvites(prev => prev.filter(i => i.id !== invite.id));
    } catch (err: any) {
      alert(err?.message ?? 'Failed to revoke invite. Please try again.');
    } finally {
      setRevokingEmails(prev => { const s = new Set(prev); s.delete(invite.id); return s; });
    }
  }

  // Unread dot on the Chat tab — visible iff the team's denormalized
  // lastMessageAt is newer than the localStorage lastReadAt for this team.
  // The dot clears as soon as TeamChatPanel mounts and calls markTeamRead.
  const chatHasUnread = team ? isTeamUnread(team.id, team.lastMessageAt) : false;

  const tabs: { key: Tab; label: string; icon: React.ReactNode; badge?: boolean }[] = [
    { key: 'schedule', label: 'Schedule', icon: <CalendarDays size={14} /> },
    { key: 'roster', label: `Roster (${teamPlayers.length})`, icon: <Users size={14} /> },
    { key: 'attendance', label: 'Attendance', icon: <ClipboardList size={14} /> },
    { key: 'standings', label: 'Standings', icon: <Trophy size={14} /> },
    { key: 'chat', label: 'Chat', icon: <MessageSquare size={14} />, badge: chatHasUnread },
    { key: 'info', label: 'Info', icon: <Info size={14} /> },
    ...(canSeeRequests ? [{ key: 'requests' as Tab, label: 'Requests', icon: <UserCheck size={14} /> }] : []),
    ...(userCanEdit ? [{ key: 'invites' as Tab, label: 'Invites', icon: <Mail size={14} /> }] : []),
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
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            {team.name}
            {myTeamMembership && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 capitalize font-medium">
                {myTeamMembership.role.replace('_', ' ')}
              </span>
            )}
          </h2>
          <p className="text-sm text-gray-500">
            {SPORT_TYPE_LABELS[team.sportType]}
            {team.ageGroup && (
              <span className="ml-2 text-blue-500">
                · {AGE_GROUP_LABELS[team.ageGroup]}
              </span>
            )}
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
        <RoleGuard roles={['admin', 'league_manager', 'coach']}>
          <Button variant="secondary" size="sm" onClick={() => setComposeOpen(true)}>
            <Mail size={14} /> Email Team
          </Button>
        </RoleGuard>
        {userCanEdit && <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}><Edit size={14} /> Edit</Button>}
        {isOwner && (
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} /> Delete
          </Button>
        )}
        {isAdminUser && (
          <Button variant="danger" size="sm" onClick={() => setConfirmHardDelete(true)}>
            <Trash2 size={14} /> Delete
          </Button>
        )}
      </div>

      {/* Attendance Summary Card */}
      {eventsWithAttendance.length > 0 && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-4 text-sm">
          <ClipboardCheck size={18} className="text-blue-500 flex-shrink-0" />
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            {lastAttendanceEvent && (
              <span className="text-gray-700">
                Last event: <span className="font-semibold text-gray-900">{lastPresent}/{lastTotal} attended</span>
              </span>
            )}
            {avgAttendancePct !== null && (
              <span className="text-gray-700">
                Avg attendance: <span className="font-semibold text-gray-900">{avgAttendancePct}%</span>
                <span className="text-gray-400 ml-1">({eventsWithAttendance.length} events)</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div role="tablist" className="flex gap-1 mb-4 border-b border-gray-200 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.key ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.icon} {t.label}
            {t.badge && (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 ml-0.5"
                aria-label="Unread messages"
              />
            )}
          </button>
        ))}
      </div>

      {/* Schedule Tab */}
      {tab === 'schedule' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-500">{teamEvents.length} {teamEvents.length === 1 ? 'event' : 'events'}</p>
            <div className="flex items-center gap-2">
              <SubscribeToCalendarButton teamId={teamId} />
              {isCoachOfTeam(profile, teamId) && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => { setInitialEventType('practice'); setEventFormOpen(true); }}
                >
                  <Plus size={14} /> Schedule Practice
                </Button>
              )}
              <RoleGuard roles={['admin', 'league_manager', 'coach']}>
                <Button size="sm" onClick={() => { setInitialEventType('game'); setEventFormOpen(true); }}><Plus size={14} /> Add Event</Button>
              </RoleGuard>
            </div>
          </div>
          {teamEvents.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
              No events scheduled yet.
            </div>
          ) : (
            <div className="space-y-2">
              {teamEvents.map(e => {
                // For parents: show attendance badge on past events with recorded attendance
                const isParent = hasRole(profile, 'parent');
                let attendanceBadge: React.ReactNode = null;
                if (isParent && e.attendanceRecorded && e.attendance && e.attendance.length > 0) {
                  // Find the tracked player: prefer profile.playerId, fall back to all players
                  const trackedPlayerId = profile?.playerId;
                  const record = trackedPlayerId
                    ? e.attendance.find(a => a.playerId === trackedPlayerId)
                    : null;
                  // If no direct link, show a summary row instead
                  if (trackedPlayerId && record) {
                    const statusLabel = record.status === 'present' ? 'Present' : record.status === 'excused' ? 'Excused' : 'Absent';
                    const statusClass = record.status === 'present'
                      ? 'bg-green-100 text-green-700'
                      : record.status === 'excused'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-red-100 text-red-600';
                    attendanceBadge = (
                      <div className="-mt-1.5 mx-0.5 px-3 py-1.5 bg-white border border-t-0 border-gray-200 rounded-b-xl flex items-center gap-1.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusClass}`}>
                          {statusLabel}
                        </span>
                        <span className="text-xs text-gray-400">Attendance recorded</span>
                      </div>
                    );
                  } else if (!trackedPlayerId) {
                    // No linked player — show team summary so parent can find their child
                    const presentCount = e.attendance.filter(a => a.status === 'present').length;
                    const totalCount = e.attendance.length;
                    attendanceBadge = (
                      <div className="-mt-1.5 mx-0.5 px-3 py-1.5 bg-white border border-t-0 border-gray-200 rounded-b-xl flex items-center gap-1.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600">
                          {presentCount}/{totalCount} attended
                        </span>
                        <span className="text-xs text-gray-400">Attendance recorded</span>
                      </div>
                    );
                  }
                }
                return (
                  <div key={e.id}>
                    <EventCard event={e} teams={teams} onClick={() => setSelectedEvent(e)} />
                    {attendanceBadge}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Roster Tab */}
      {tab === 'roster' && (
        <div className="bg-white rounded-xl border border-gray-200">
          {/* Roster header — view mode */}
          {!pendingRoster.state.active && (
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h3 className="font-medium text-gray-800">Players</h3>
              <div className="flex items-center gap-2">
                {teamPlayers.length > 0 && (
                  <Button size="sm" variant="secondary" onClick={handleCopyRoster}>
                    {rosterCopied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy Roster</>}
                  </Button>
                )}
                {userCanEdit && (
                  <Button size="sm" variant="secondary" onClick={pendingRoster.enterMode}>
                    <Pencil size={14} /> Modify Roster
                  </Button>
                )}
                {userCanEdit && <Button size="sm" onClick={() => setAddPlayerOpen(true)}><Plus size={14} /> Add Player</Button>}
              </div>
            </div>
          )}

          {/* Roster header — modify mode */}
          {pendingRoster.state.active && (
            <div className="px-4 py-3 border-b border-gray-100 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800">Modify Roster</span>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                    {pendingRoster.pendingCount} pending {pendingRoster.pendingCount === 1 ? 'change' : 'changes'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => setAddPlayerOpen(true)}>
                    <Plus size={14} /> Add Player
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleDiscardRoster}
                    disabled={rosterSaving}
                  >
                    Discard
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleSaveRoster()}
                    disabled={rosterSaving || pendingRoster.pendingCount === 0}
                  >
                    {rosterSaving ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : 'Save Roster'}
                  </Button>
                </div>
              </div>
              {rosterSaveError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{rosterSaveError}</p>
              )}
            </div>
          )}

          {rosterSaveSuccess && !pendingRoster.state.active && (
            <div className="px-4 py-2 bg-green-50 border-b border-green-100">
              <p className="text-sm text-green-700">Roster saved successfully.</p>
            </div>
          )}

          <RosterTable
            players={teamPlayers}
            teamId={teamId}
            modifyMode={pendingRoster.state.active}
            pendingChanges={pendingRoster.state.changes}
            onStageUpdate={pendingRoster.stageUpdate}
            onStageRemove={pendingRoster.stageRemove}
            onUnstageRemove={pendingRoster.unstageRemove}
          />
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

      {/* Chat Tab — lazy-mounted; subscribe only when the user opens it */}
      {tab === 'chat' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden" style={{ height: 'calc(100vh - 320px)', minHeight: 400 }}>
          <TeamChatPanel teamId={team.id} />
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
          {team.ageGroup && (
            <div>
              <span className="font-medium text-gray-700">Age Group:</span>
              <span className="text-gray-600 ml-2">
                {AGE_GROUP_LABELS[team.ageGroup]}
              </span>
            </div>
          )}
          {team.coachName && <div><span className="font-medium text-gray-700">Coach:</span> <span className="text-gray-600 ml-2">{team.coachName}</span></div>}
          {team.coachEmail && <div><span className="font-medium text-gray-700">Email:</span> <span className="text-gray-600 ml-2">{team.coachEmail}</span></div>}
          {league && <div><span className="font-medium text-gray-700">League:</span> <span className="text-gray-600 ml-2">{league.name}</span></div>}
          {(isOwner || isAdminUser) && (
            <div className="pt-2 border-t border-gray-100">
              <Button size="sm" variant="secondary" onClick={() => setAssignCoCoachOpen(true)}>
                <Users size={14} /> Add Co-Coach
              </Button>
            </div>
          )}
        </div>
      )}

      <AssignCoCoachModal
        open={assignCoCoachOpen}
        onClose={() => setAssignCoCoachOpen(false)}
        teamId={teamId}
        teamName={team.name}
      />

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

      {/* Invites Tab */}
      {tab === 'invites' && userCanEdit && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="font-medium text-gray-800">Invites</h3>
            <p className="text-xs text-gray-500 mt-0.5">Players invited to join this team</p>
          </div>
          {invitesLoading ? (
            <div className="p-4 sm:p-6 text-center text-sm text-gray-400">Loading invites…</div>
          ) : invites.length === 0 ? (
            <div className="p-4 sm:p-6 text-center text-sm text-gray-400">No outstanding invites.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {invites.map(invite => {
                const isResending = resendingEmails.has(invite.email);
                const isRevoking = revokingEmails.has(invite.id);
                const isAccepted = !!invite.acceptedAt;
                return (
                  <div key={invite.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{invite.email}</p>
                      {invite.playerName && (
                        <p className="text-xs text-gray-500">For: {invite.playerName}</p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${isAccepted ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {isAccepted ? 'Accepted' : 'Pending'}
                        </span>
                        {invite.role && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 capitalize">
                            {invite.role}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          Sent {new Date(invite.invitedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    {!isAccepted && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" disabled={isResending || isRevoking} onClick={() => void handleResendInvite(invite)}>
                          {isResending ? 'Sending…' : 'Resend'}
                        </Button>
                        <Button size="sm" variant="danger" disabled={isResending || isRevoking} onClick={() => void handleRevokeInvite(invite)}>
                          {isRevoking ? 'Revoking…' : 'Revoke'}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <TeamForm open={editOpen} onClose={() => setEditOpen(false)} editTeam={team} />
      <PlayerForm
        key={addPlayerOpen ? 'open' : 'closed'}
        open={addPlayerOpen}
        onClose={() => setAddPlayerOpen(false)}
        teamId={teamId}
        {...(pendingRoster.state.active ? { onStagedAdd: pendingRoster.stageAdd } : {})}
      />
      <EventForm
        open={eventFormOpen}
        onClose={() => setEventFormOpen(false)}
        initial={{ homeTeamId: teamId, teamIds: [teamId], type: initialEventType }}
      />
      <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      {/* Owner soft-delete */}
      <DeleteTeamModal
        open={confirmDelete}
        teamName={team.name}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleSoftDelete}
      />
      {/* Admin hard-delete */}
      <DeleteTeamModal
        open={confirmHardDelete}
        teamName={team.name}
        permanent
        onClose={() => setConfirmHardDelete(false)}
        onConfirm={handleHardDelete}
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
      {/* Email Team modal */}
      <ComposeMessageModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        defaultTeamId={teamId}
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
