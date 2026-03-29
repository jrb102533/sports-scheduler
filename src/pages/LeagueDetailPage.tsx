import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, CalendarDays, Trophy, Users, Pencil, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { EventCard } from '@/components/events/EventCard';
import { EventForm } from '@/components/events/EventForm';
import { EventDetailPanel } from '@/components/events/EventDetailPanel';
import { StandingsTable } from '@/components/standings/StandingsTable';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LeagueForm } from '@/components/leagues/LeagueForm';
import { ScheduleWizardModal } from '@/components/leagues/ScheduleWizardModal';
import { AvailabilityStatusPanel } from '@/components/leagues/AvailabilityStatusPanel';
import type { CoachInfo } from '@/components/leagues/AvailabilityStatusPanel';
import { useLeagueStore } from '@/store/useLeagueStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useEventStore } from '@/store/useEventStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useCollectionStore } from '@/store/useCollectionStore';
import { RoleGuard } from '@/components/auth/RoleGuard';
import { SPORT_TYPE_LABELS } from '@/constants';
import type { ScheduledEvent } from '@/types';

type Tab = 'schedule' | 'standings' | 'teams';

export function LeagueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const leagues = useLeagueStore(s => s.leagues);
  const { updateLeague, deleteLeague } = useLeagueStore();
  const { teams, updateTeam } = useTeamStore();
  const allEvents = useEventStore(s => s.events);
  const profile = useAuthStore(s => s.profile);

  const league = leagues.find(l => l.id === id);
  const leagueTeams = teams.filter(t => t.leagueId === id);
  const leagueTeamIds = leagueTeams.map(t => t.id);
  const leagueEvents = allEvents
    .filter(e => e.teamIds.some(tid => leagueTeamIds.includes(tid)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  const { activeCollection, responses, loadCollection, loadWizardDraft, wizardDraft } = useCollectionStore();
  const [collectionPanelOpen, setCollectionPanelOpen] = useState(false);

  const [tab, setTab] = useState<Tab>('schedule');
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<ScheduledEvent | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    const unsub1 = loadCollection(id);
    const unsub2 = loadWizardDraft(id);
    return () => { unsub1(); unsub2(); };
  }, [id, loadCollection, loadWizardDraft]);

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

  const isAdmin = profile?.role === 'admin';
  const canManage = isAdmin || (profile?.role === 'league_manager' && profile?.leagueId === id);

  if (!league) return <div className="p-4 sm:p-6 text-gray-500">League not found.</div>;

  async function handleDelete() {
    await Promise.all(leagueTeams.map(t => updateTeam({ ...t, leagueId: undefined })));
    await deleteLeague(league!.id);
    navigate('/leagues');
  }

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
      ...added.map(tid => { const t = teams.find(tm => tm.id === tid); return t ? updateTeam({ ...t, leagueId: id }) : Promise.resolve(); }),
      ...removed.map(tid => { const t = teams.find(tm => tm.id === tid); return t ? updateTeam({ ...t, leagueId: undefined }) : Promise.resolve(); }),
    ]);
    setEditOpen(false);
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'schedule', label: 'Schedule', icon: <CalendarDays size={14} /> },
    { key: 'standings', label: 'Standings', icon: <Trophy size={14} /> },
    { key: 'teams', label: `Teams (${leagueTeams.length})`, icon: <Users size={14} /> },
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
          <h2 className="text-xl font-bold text-gray-900">{league.name}</h2>
          <p className="text-sm text-gray-500">
            {[league.season, league.sportType ? SPORT_TYPE_LABELS[league.sportType] : null].filter(Boolean).join(' · ')}
          </p>
          {league.description && <p className="text-xs text-gray-400 mt-1">{league.description}</p>}
        </div>
        {canManage && (
          <div className="flex gap-2 flex-shrink-0">
            <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}><Pencil size={14} /> Edit</Button>
            {isAdmin && (
              <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /></Button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
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
            <div className="flex flex-col gap-1">
              <p className="text-sm text-gray-500">{leagueEvents.length} {leagueEvents.length === 1 ? 'event' : 'events'}</p>
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
              {canManage && leagueTeams.length >= 2 && (
                <Button size="sm" variant="secondary" onClick={() => setWizardOpen(true)}>
                  <Wand2 size={14} />
                  {wizardDraft ? 'Continue Schedule' : 'Schedule Wizard'}
                  {hasActiveCollection && (
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
          {leagueEvents.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
              No events scheduled yet.
            </div>
          ) : (
            <div className="space-y-2">
              {leagueEvents.map(e => (
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
        <div className="bg-white rounded-xl border border-gray-200">
          {leagueTeams.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">No teams assigned to this league yet.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {leagueTeams.map(team => (
                <button
                  key={team.id}
                  onClick={() => navigate(`/teams/${team.id}`)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style={{ backgroundColor: team.color }}>
                    {team.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{team.name}</p>
                    <p className="text-xs text-gray-500">{SPORT_TYPE_LABELS[team.sportType]}</p>
                  </div>
                  <span className="text-xs text-gray-400">View →</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <EventForm open={eventFormOpen} onClose={() => setEventFormOpen(false)} />
      <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />

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
            onSendReminder={async () => { /* wire to Cloud Function later */ }}
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

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete League"
        message={`Delete "${league.name}"? Teams in this league will be unassigned but not deleted.`}
      />
    </div>
  );
}
