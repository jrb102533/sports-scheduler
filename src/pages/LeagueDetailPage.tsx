import { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, CalendarDays, Trophy, Users, Pencil, Trash2, Wand2, Layers, Search, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { EventCard } from '@/components/events/EventCard';
import { EventForm } from '@/components/events/EventForm';
import { EventDetailPanel } from '@/components/events/EventDetailPanel';
import { StandingsTable } from '@/components/standings/StandingsTable';
import { LeagueForm } from '@/components/leagues/LeagueForm';
import { TeamForm } from '@/components/teams/TeamForm';
import { ScheduleWizardModal } from '@/components/leagues/ScheduleWizardModal';
import { DeleteLeagueModal } from '@/components/leagues/DeleteLeagueModal';
import { AssignCoManagerModal } from '@/components/leagues/AssignCoManagerModal';
import { LeagueVenueTab } from '@/components/leagues/LeagueVenueTab';
import { SeasonCreateModal } from '@/components/seasons/SeasonCreateModal';
import { AvailabilityStatusPanel } from '@/components/leagues/AvailabilityStatusPanel';
import type { CoachInfo } from '@/components/leagues/AvailabilityStatusPanel';
import { useLeagueStore } from '@/store/useLeagueStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useEventStore } from '@/store/useEventStore';
import { useAuthStore, hasRole, getMemberships } from '@/store/useAuthStore';
import { useSeasonStore } from '@/store/useSeasonStore';
import { useCollectionStore } from '@/store/useCollectionStore';
import { useLeagueVenueStore } from '@/store/useLeagueVenueStore';
import { RoleGuard } from '@/components/auth/RoleGuard';
import { SPORT_TYPE_LABELS } from '@/constants';
import type { ScheduledEvent } from '@/types';

type Tab = 'schedule' | 'standings' | 'teams' | 'seasons' | 'venues';

export function LeagueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const leagues = useLeagueStore(s => s.leagues);
  const updateLeague = useLeagueStore(s => s.updateLeague);
  const softDeleteLeague = useLeagueStore(s => s.softDeleteLeague);
  const teams = useTeamStore(s => s.teams);
  const addTeamToLeague = useTeamStore(s => s.addTeamToLeague);
  const removeTeamFromLeague = useTeamStore(s => s.removeTeamFromLeague);
  const allEvents = useEventStore(s => s.events);
  const deleteEvent = useEventStore(s => s.deleteEvent);
  const profile = useAuthStore(s => s.profile);

  const league = leagues.find(l => l.id === id);
  const leagueTeams = teams.filter(t => t.leagueIds?.includes(id ?? ''));
  const leagueTeamIds = leagueTeams.map(t => t.id);
  const leagueEvents = allEvents
    .filter(e => e.teamIds.some(tid => leagueTeamIds.includes(tid)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  const draftEvents = leagueEvents.filter(e => e.status === 'draft');

  const seasons = useSeasonStore(s => s.seasons);
  const activeCollection = useCollectionStore(s => s.activeCollection);
  const responses = useCollectionStore(s => s.responses);
  const wizardDraft = useCollectionStore(s => s.wizardDraft);
  const [collectionPanelOpen, setCollectionPanelOpen] = useState(false);

  const [tab, setTab] = useState<Tab>('schedule');
  const [isClearingDraft, setIsClearingDraft] = useState(false);
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<ScheduledEvent | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [softDeleteOpen, setSoftDeleteOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [seasonCreateOpen, setSeasonCreateOpen] = useState(false);
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [teamSearch, setTeamSearch] = useState('');
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [addingTeams, setAddingTeams] = useState(false);
  const [assignCoManagerOpen, setAssignCoManagerOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    return useSeasonStore.getState().fetchSeasons(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const unsub1 = useCollectionStore.getState().loadCollection(id);
    const unsub2 = useCollectionStore.getState().loadWizardDraft(id);
    return () => { unsub1(); unsub2(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id) return;
    return useLeagueVenueStore.getState().subscribe(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const hasActiveCollection = activeCollection?.status === 'open';
  const respondedCount = responses.length;
  const totalCoaches = leagueTeams.filter(t => t.coachId).length;

  const coaches: CoachInfo[] = leagueTeams.map(team => ({
    uid: team.coachId ?? team.id,
    name: team.coachName ?? team.name,
    teamId: team.id,
    teamName: team.name,
    hasAccount: !!team.coachId,
  }));

  const myLeagueMembership = getMemberships(profile ?? null).find(
    m => m.leagueId === id && m.role === 'league_manager'
  );
  const isAdmin = profile?.role === 'admin';
  // Use hasRole + memberships array so multi-role users (e.g. coach who became LM) work correctly
  const isLeagueManager = hasRole(profile ?? null, 'league_manager');
  const managedLeagueIds = new Set([
    ...(profile?.memberships ?? [])
      .filter(m => m.role === 'league_manager' && m.leagueId)
      .map(m => m.leagueId!),
    ...(profile?.leagueId ? [profile.leagueId] : []),
  ]);
  const canManage = isAdmin || (isLeagueManager && (managedLeagueIds.has(id ?? '') || league?.managedBy === profile?.uid));

  const leagueVenueCount = useLeagueVenueStore(s => s.venues.length);

  if (!league) return <div className="p-4 sm:p-6 text-gray-500">League not found.</div>;

  const canSoftDelete = isLeagueManager && (managedLeagueIds.has(league.id) || league.managedBy === profile?.uid);


  async function handleSaveLeague(
    leagueData: Omit<typeof league, 'id' | 'createdAt' | 'updatedAt'>,
    selectedTeamIds: string[],
    prevTeamIds: string[],
  ) {
    const now = new Date().toISOString();
    await updateLeague({ ...league!, ...leagueData, updatedAt: now });
    const added = selectedTeamIds.filter(tid => !prevTeamIds.includes(tid));
    const removed = prevTeamIds.filter(tid => !selectedTeamIds.includes(tid));
    await Promise.all([
      ...added.map(tid => addTeamToLeague(tid, id!)),
      ...removed.map(tid => removeTeamFromLeague(tid, id!)),
    ]);
    setEditOpen(false);
  }

  // For single-season leagues: clicking the Seasons tab navigates directly to that season.
  // For empty leagues: only managers see the Seasons tab.
  function handleSeasonsTab() {
    if (seasons.length === 1) {
      navigate(`/leagues/${id}/seasons/${seasons[0].id}`);
    } else {
      setTab('seasons');
    }
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode; onClick?: () => void }[] = [
    { key: 'schedule', label: 'Schedule', icon: <CalendarDays size={14} /> },
    { key: 'standings', label: 'Standings', icon: <Trophy size={14} /> },
    { key: 'teams', label: `Teams (${leagueTeams.length})`, icon: <Users size={14} /> },
    ...(seasons.length > 0 || canManage
      ? [{ key: 'seasons' as Tab, label: seasons.length === 1 ? seasons[0].name : `Seasons (${seasons.length})`, icon: <Layers size={14} />, onClick: handleSeasonsTab }]
      : []),
    { key: 'venues', label: `Venues (${leagueVenueCount})`, icon: <MapPin size={14} /> },
  ];

  return (
    <div className="p-4 sm:p-6">
      <button onClick={() => navigate('/leagues')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft size={14} /> Back to Leagues
      </button>

      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <Trophy size={22} className="text-indigo-600" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            {league.name}
            {myLeagueMembership && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-medium">
                League Manager
              </span>
            )}
          </h2>
          <p className="text-sm text-gray-500">
            {[league.season, league.sportType ? SPORT_TYPE_LABELS[league.sportType] : null].filter(Boolean).join(' · ')}
          </p>
          {league.description && <p className="text-xs text-gray-400 mt-1">{league.description}</p>}
        </div>
        {canManage && (
          <div className="flex gap-2 flex-shrink-0">
            <Button variant="secondary" size="sm" onClick={() => setAssignCoManagerOpen(true)}><Users size={14} /> Add Co-Manager</Button>
            <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}><Pencil size={14} /> Edit</Button>
            {(isAdmin || canSoftDelete) && (
              <Button variant="danger" size="sm" onClick={() => setSoftDeleteOpen(true)} aria-label="Delete league"><Trash2 size={14} /></Button>
            )}
          </div>
        )}

        <AssignCoManagerModal
          open={assignCoManagerOpen}
          onClose={() => setAssignCoManagerOpen(false)}
          leagueId={league.id}
          leagueName={league.name}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => t.onClick ? t.onClick() : setTab(t.key)}
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
            <div className="flex flex-col gap-1">
              <p className="text-sm text-gray-500">{leagueEvents.filter(e => e.status !== 'draft').length} {leagueEvents.filter(e => e.status !== 'draft').length === 1 ? 'event' : 'events'}</p>
              {hasActiveCollection && canManage && (
                <button
                  onClick={() => setCollectionPanelOpen(true)}
                  className="text-xs text-blue-600 underline text-left"
                >
                  View availability collection →
                </button>
              )}
            </div>
            <div className="flex gap-2">
              {canManage && seasons.length === 0 && draftEvents.length === 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setWizardOpen(true)}
                  disabled={leagueTeams.length < 2}
                  title={leagueTeams.length < 2 ? 'Add at least 2 teams to use the Schedule Wizard' : undefined}
                >
                  <Wand2 size={14} />
                  {wizardDraft ? 'Continue Schedule' : 'Schedule Wizard'}
                  {hasActiveCollection && leagueTeams.length >= 2 && (
                    <span className="ml-1 text-xs bg-blue-100 text-blue-700 rounded-full px-1.5">
                      {respondedCount}/{totalCoaches}
                    </span>
                  )}
                </Button>
              )}
              <RoleGuard roles={['admin', 'league_manager', 'coach']}>
                <Button size="sm" onClick={() => setEventFormOpen(true)}><Plus size={14} /> Add Event</Button>
              </RoleGuard>
            </div>
          </div>
          {/* Draft schedule summary banner */}
          {canManage && draftEvents.length > 0 && (
            <div className="mb-3 bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-yellow-800">
                  {draftEvents.length} draft game{draftEvents.length !== 1 ? 's' : ''} pending review
                </p>
                {(() => {
                  const dates = draftEvents.map(e => e.date).sort();
                  const first = dates[0];
                  const last = dates[dates.length - 1];
                  const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  return (
                    <p className="text-xs text-yellow-700 mt-0.5">
                      {first === last ? fmt(first) : `${fmt(first)} – ${fmt(last)}`}
                      {' · '}Create a season to publish
                    </p>
                  );
                })()}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setWizardOpen(true)}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={isClearingDraft}
                  onClick={async () => {
                    if (!window.confirm(`Delete all ${draftEvents.length} draft games? This cannot be undone.`)) return;
                    setIsClearingDraft(true);
                    try {
                      await Promise.all(draftEvents.map(e => deleteEvent(e.id)));
                      void useCollectionStore.getState().clearWizardDraft(id!);
                    } finally {
                      setIsClearingDraft(false);
                    }
                  }}
                >
                  {isClearingDraft ? 'Discarding…' : 'Discard'}
                </Button>
              </div>
            </div>
          )}

          {leagueEvents.filter(e => e.status !== 'draft').length === 0 && draftEvents.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
              No events scheduled yet.
            </div>
          ) : leagueEvents.filter(e => e.status !== 'draft').length === 0 ? null : (
            <div className="space-y-2">
              {leagueEvents.filter(e => e.status !== 'draft').map(e => (
                <EventCard key={e.id} event={e} teams={leagueTeams} onClick={() => setSelectedEvent(e)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Standings Tab */}
      {tab === 'standings' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {leagueTeams.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">No teams in this league yet.</div>
          ) : (
            <StandingsTable teamIds={leagueTeamIds} />
          )}
        </div>
      )}

      {/* Teams Tab */}
      {tab === 'teams' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-500">{leagueTeams.length} {leagueTeams.length === 1 ? 'team' : 'teams'}</p>
            {canManage && (
              <Button size="sm" onClick={() => setAddTeamOpen(true)}>
                <Plus size={14} /> Add Team
              </Button>
            )}
          </div>
          <div className="bg-white rounded-xl border border-gray-200">
            {leagueTeams.length === 0 ? (
              canManage ? (
                <div className="p-8 text-center space-y-3">
                  <p className="text-sm text-gray-500">No teams in this league yet.</p>
                  <p className="text-xs text-gray-400">Add your first team to get started.</p>
                  <div className="flex justify-center">
                    <Button size="sm" onClick={() => setAddTeamOpen(true)}>
                      <Plus size={14} /> Add Team
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-sm text-gray-400">No teams assigned to this league yet.</div>
              )
            ) : (
              <div className="divide-y divide-gray-100">
                {leagueTeams.map(team => (
                  <div key={team.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                    <button
                      onClick={() => navigate(`/teams/${team.id}`)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style={{ backgroundColor: team.color }}>
                        {team.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">{team.name}</p>
                        <p className="text-xs text-gray-500">{SPORT_TYPE_LABELS[team.sportType]}</p>
                      </div>
                    </button>
                    {canManage && (
                      <button
                        onClick={() => removeTeamFromLeague(team.id, id!)}
                        className="text-xs text-gray-400 hover:text-red-600 transition-colors flex-shrink-0 px-2 py-1 rounded hover:bg-red-50"
                        title="Remove from league"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Seasons Tab */}
      {tab === 'seasons' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-500">{seasons.length} {seasons.length === 1 ? 'season' : 'seasons'}</p>
            {canManage && (
              <Button size="sm" onClick={() => setSeasonCreateOpen(true)}>
                <Plus size={14} /> New Season
              </Button>
            )}
          </div>
          {seasons.length === 0 ? (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
              <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center mx-auto mb-3">
                <Layers size={22} className="text-indigo-500" />
              </div>
              <p className="text-sm font-medium text-gray-700 mb-1">No seasons yet</p>
              <p className="text-xs text-gray-400 mb-4">Create a season to start scheduling games for this league.</p>
              {canManage && (
                <Button size="sm" onClick={() => setSeasonCreateOpen(true)}>
                  <Plus size={14} /> Create First Season
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {seasons.map(season => (
                <button
                  key={season.id}
                  onClick={() => navigate(`/leagues/${id}/seasons/${season.id}`)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <Layers size={15} className="text-indigo-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{season.name}</p>
                    <p className="text-xs text-gray-500">
                      {season.startDate} – {season.endDate} · {season.gamesPerTeam} games/team
                    </p>
                  </div>
                  <span className={`text-xs font-medium rounded-full px-2.5 py-1 flex-shrink-0 ${
                    season.status === 'active' ? 'bg-green-100 text-green-700' :
                    season.status === 'setup' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {season.status === 'active' ? 'Active' : season.status === 'setup' ? 'Setup' : 'Archived'}
                  </span>
                  <span className="text-xs text-gray-400 flex-shrink-0">Manage →</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'venues' && (
        <LeagueVenueTab
          leagueId={league.id}
          canManage={canManage}
          lmUid={profile?.uid ?? ''}
        />
      )}

      <EventForm open={eventFormOpen} onClose={() => setEventFormOpen(false)} />
      <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} leagueId={id} />

      {wizardOpen && (
        <ScheduleWizardModal
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          league={league}
          leagueTeams={leagueTeams}
          currentUserUid={profile?.uid ?? ''}
        />
      )}

      {collectionPanelOpen && (
        <Modal open onClose={() => setCollectionPanelOpen(false)} title="Availability Collection">
          <AvailabilityStatusPanel
            leagueId={id!}
            coaches={coaches}
            onSendReminder={async (_coachUids: string[]) => {
              await httpsCallable<{ leagueId: string; collectionId: string }, { reminded: number }>(
                functions,
                'sendAvailabilityReminder',
              )({ leagueId: id!, collectionId: activeCollection!.id });
            }}
            onClose={() => setCollectionPanelOpen(false)}
          />
        </Modal>
      )}


      {editOpen && (
        <LeagueForm
          open={editOpen}
          onClose={() => setEditOpen(false)}
          editLeague={league}
          allTeams={teams}
          onSave={handleSaveLeague}
        />
      )}

      <SeasonCreateModal
        open={seasonCreateOpen}
        onClose={() => setSeasonCreateOpen(false)}
        leagueId={id ?? ''}
        onCreated={(season) => navigate(`/leagues/${id}/seasons/${season.id}`)}
      />

      {softDeleteOpen && (
        <DeleteLeagueModal
          open={softDeleteOpen}
          league={league}
          onClose={() => setSoftDeleteOpen(false)}
          onConfirm={() => softDeleteLeague(league.id).then(() => navigate('/leagues'))}
        />
      )}

      {/* Add Team to League modal */}
      {addTeamOpen && (() => {
        const availableTeams = teams.filter(t => !leagueTeamIds.includes(t.id));
        const filteredTeams = teamSearch.trim()
          ? availableTeams.filter(t => t.name.toLowerCase().includes(teamSearch.trim().toLowerCase()))
          : availableTeams;

        async function handleAddSelected() {
          setAddingTeams(true);
          try {
            await Promise.all(selectedTeamIds.map(tid => addTeamToLeague(tid, id!)));
          } finally {
            setAddingTeams(false);
            setAddTeamOpen(false);
            setSelectedTeamIds([]);
            setTeamSearch('');
          }
        }

        function toggleTeam(tid: string) {
          setSelectedTeamIds(prev =>
            prev.includes(tid) ? prev.filter(x => x !== tid) : [...prev, tid]
          );
        }

        return (
          <Modal open onClose={() => { setAddTeamOpen(false); setSelectedTeamIds([]); setTeamSearch(''); }} title="Add Team to League">
            <div className="space-y-4">
              {availableTeams.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">
                  All existing teams are already in this league.
                </p>
              ) : (
                <>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search teams…"
                      value={teamSearch}
                      onChange={e => setTeamSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      aria-label="Search teams"
                    />
                  </div>
                  <div className="max-h-60 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-lg">
                    {filteredTeams.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6">No teams match your search.</p>
                    ) : (
                      filteredTeams.map(team => (
                        <label key={team.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedTeamIds.includes(team.id)}
                            onChange={() => toggleTeam(team.id)}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                          />
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: team.color }}>
                            {team.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900">{team.name}</p>
                            <p className="text-xs text-gray-500">{SPORT_TYPE_LABELS[team.sportType]}</p>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                </>
              )}
              <div className="flex justify-end gap-3 pt-1">
                <Button variant="secondary" onClick={() => { setAddTeamOpen(false); setSelectedTeamIds([]); setTeamSearch(''); }}>
                  Cancel
                </Button>
                <Button onClick={() => void handleAddSelected()} disabled={selectedTeamIds.length === 0 || addingTeams}>
                  {addingTeams ? 'Adding…' : `Add Selected${selectedTeamIds.length > 0 ? ` (${selectedTeamIds.length})` : ''}`}
                </Button>
              </div>
              <div className="border-t border-gray-100 pt-3 text-center">
                <button
                  className="text-sm text-blue-600 underline"
                  onClick={() => { setAddTeamOpen(false); setSelectedTeamIds([]); setTeamSearch(''); setCreateTeamOpen(true); }}
                >
                  + Create a new team
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      <TeamForm
        open={createTeamOpen}
        onClose={() => { setCreateTeamOpen(false); setAddTeamOpen(true); }}
      />
    </div>
  );
}
