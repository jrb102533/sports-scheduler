import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { updateDoc, doc, collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import {
  ArrowLeft, MapPin, Users, Wand2, Plus, CheckCircle2,
  AlertTriangle, AlertCircle, Clock, ChevronRight, Settings,
  Send, Loader2, ChevronDown, ChevronUp, Trash2, Layers, Dumbbell,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ScheduleWizardModal } from '@/components/leagues/ScheduleWizardModal';
import { DivisionScheduleSetupCard } from '@/components/leagues/DivisionScheduleSetupCard';
import { StandingsTable } from '@/components/standings/StandingsTable';
import { db } from '@/lib/firebase';
import { useSeasonStore } from '@/store/useSeasonStore';
import { useDivisionStore } from '@/store/useDivisionStore';
import { useLeagueStore } from '@/store/useLeagueStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useEventStore } from '@/store/useEventStore';
import { useVenueStore } from '@/store/useVenueStore';
import { useAuthStore, isManagerOfLeague } from '@/store/useAuthStore';
import { useCollectionStore } from '@/store/useCollectionStore';
import { RequiresPro } from '@/components/subscription/RequiresPro';
import type { Division, Season, Team, ScheduledEvent, WizardMode } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateRange(start: string, end: string): string {
  const fmt = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

function countWeeksInRange(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return Math.max(1, Math.floor((e - s) / (7 * 24 * 60 * 60 * 1000)));
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function SeasonStatusBadge({ status }: { status: Season['status'] }) {
  const config: Record<Season['status'], { label: string; className: string }> = {
    setup: { label: 'Setup', className: 'bg-yellow-100 text-yellow-700' },
    active: { label: 'Active', className: 'bg-green-100 text-green-700' },
    archived: { label: 'Archived', className: 'bg-gray-100 text-gray-600' },
  };
  const { label, className } = config[status];
  return <Badge className={className}>{label}</Badge>;
}

// ─── Division Status Badge ─────────────────────────────────────────────────────

function DivisionStatusBadge({ status }: { status: Division['scheduleStatus'] }) {
  const config: Record<Division['scheduleStatus'], { label: string; className: string }> = {
    none: { label: 'No schedule', className: 'bg-gray-100 text-gray-600' },
    draft: { label: 'Draft', className: 'bg-yellow-100 text-yellow-700' },
    published: { label: 'Published', className: 'bg-green-100 text-green-700' },
  };
  const { label, className } = config[status];
  return <Badge className={className}>{label}</Badge>;
}

// ─── Feasibility Panel ────────────────────────────────────────────────────────

interface FeasibilityPanelProps {
  season: Season;
  teamCount: number;
  venueCount: number;
  availableSlots: number;
}

function FeasibilityPanel({ season, teamCount, venueCount, availableSlots }: FeasibilityPanelProps) {
  const requiredSlots = Math.ceil((season.gamesPerTeam * teamCount) / 2);
  const hasData = teamCount > 0 && venueCount > 0;

  if (!hasData) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500 flex items-center gap-2">
        <AlertCircle size={15} className="text-gray-400 flex-shrink-0" />
        Add venues and teams to see feasibility.
      </div>
    );
  }

  const ratio = availableSlots / Math.max(1, requiredSlots);
  const isFeasible = ratio >= 1;
  const isWarning = ratio >= 0.75 && ratio < 1;
  const isCritical = ratio < 0.75;

  if (isFeasible) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 flex items-start gap-2">
        <CheckCircle2 size={15} className="text-green-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Enough slots available for the schedule.</p>
          <p className="text-green-700 mt-0.5">
            {availableSlots} available slots — {requiredSlots} required.
          </p>
        </div>
      </div>
    );
  }

  if (isWarning) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex items-start gap-2">
        <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Slot availability is tight — consider adding more venue time.</p>
          <p className="text-amber-700 mt-0.5">
            {availableSlots} available slots — {requiredSlots} required.
          </p>
        </div>
      </div>
    );
  }

  if (isCritical) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-start gap-2">
        <AlertCircle size={15} className="text-red-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Not enough venue slots to generate a valid schedule.</p>
          <p className="text-red-700 mt-0.5">
            {availableSlots} available slots — {requiredSlots} required. Add more venues or reduce games per team.
          </p>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Add Division Modal ───────────────────────────────────────────────────────

interface AddDivisionModalProps {
  open: boolean;
  onClose: () => void;
  leagueId: string;
  seasonId: string;
  leagueTeams: Team[];
  existingDivisions: Division[];
}

function AddDivisionModal({ open, onClose, leagueId, seasonId, leagueTeams, existingDivisions }: AddDivisionModalProps) {
  const createDivision = useDivisionStore(s => s.createDivision);
  const assignedTeamIds = new Set(existingDivisions.flatMap(d => d.teamIds));
  const [name, setName] = useState('');
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(new Set());
  const [nameError, setNameError] = useState('');
  const [saving, setSaving] = useState(false);

  function toggleTeam(id: string) {
    setSelectedTeamIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  async function handleSubmit() {
    if (!name.trim()) { setNameError('Division name is required.'); return; }
    setNameError('');
    setSaving(true);
    try {
      await createDivision(leagueId, seasonId, {
        name: name.trim(),
        teamIds: [...selectedTeamIds],
      });
      setName('');
      setSelectedTeamIds(new Set());
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    setName('');
    setSelectedTeamIds(new Set());
    setNameError('');
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add Division" size="sm">
      <div className="space-y-4">
        <Input
          label="Division Name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. U10 Division A"
          error={nameError}
          autoFocus
        />

        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Assign Teams</p>
          {leagueTeams.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No teams in this league yet.</p>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
              {leagueTeams.map(team => {
                const taken = assignedTeamIds.has(team.id);
                return (
                  <label
                    key={team.id}
                    className={`flex items-center gap-3 px-3 py-2.5 border-b border-gray-100 last:border-0 ${taken ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTeamIds.has(team.id)}
                      onChange={() => !taken && toggleTeam(team.id)}
                      disabled={taken}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: team.color }} />
                    <span className="text-sm text-gray-800">{team.name}</span>
                    {taken && <span className="ml-auto text-xs text-gray-400">In another division</span>}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={handleClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Creating…' : 'Create Division'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Edit Division Modal ──────────────────────────────────────────────────────

interface EditDivisionModalProps {
  open: boolean;
  onClose: () => void;
  leagueId: string;
  division: Division;
  leagueTeams: Team[];
  otherDivisions: Division[];
}

function EditDivisionModal({ open, onClose, leagueId, division, leagueTeams, otherDivisions }: EditDivisionModalProps) {
  const updateDivision = useDivisionStore(s => s.updateDivision);
  const takenByOthers = new Set(otherDivisions.flatMap(d => d.teamIds));
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(new Set(division.teamIds));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelectedTeamIds(new Set(division.teamIds));
  }, [division.id, open]);

  function toggleTeam(id: string) {
    setSelectedTeamIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateDivision(leagueId, division.id, { teamIds: [...selectedTeamIds] });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Edit Division — ${division.name}`} size="sm">
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Assign Teams</p>
          {leagueTeams.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No teams in this league yet.</p>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
              {leagueTeams.map(team => {
                const taken = takenByOthers.has(team.id);
                return (
                  <label
                    key={team.id}
                    className={`flex items-center gap-3 px-3 py-2.5 border-b border-gray-100 last:border-0 ${taken ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTeamIds.has(team.id)}
                      onChange={() => !taken && toggleTeam(team.id)}
                      disabled={taken}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: team.color }} />
                    <span className="text-sm text-gray-800">{team.name}</span>
                    {taken && <span className="ml-auto text-xs text-gray-400">In another division</span>}
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Task Cards ───────────────────────────────────────────────────────────────

interface TaskCardProps {
  icon: React.ReactNode;
  title: string;
  status: string;
  statusVariant: 'ok' | 'warning' | 'neutral';
  description?: string;
  children?: React.ReactNode;
  secondary?: boolean;
}

function TaskCard({ icon, title, status, statusVariant, description, children, secondary }: TaskCardProps) {
  const statusColors: Record<string, string> = {
    ok: 'text-green-700 bg-green-100',
    warning: 'text-amber-700 bg-amber-100',
    neutral: 'text-gray-600 bg-gray-100',
  };

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${secondary ? 'border-gray-200 bg-gray-50/60 opacity-80' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 flex-shrink-0">
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
              {secondary && (
                <span className="text-xs font-medium text-gray-500 bg-gray-200 rounded-full px-2 py-0.5">Optional</span>
              )}
            </div>
            {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
          </div>
        </div>
        <span className={`text-xs font-medium rounded-full px-2.5 py-1 whitespace-nowrap flex-shrink-0 ${statusColors[statusVariant]}`}>
          {status}
        </span>
      </div>
      {children && <div>{children}</div>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SeasonDashboard() {
  const { leagueId, seasonId } = useParams<{ leagueId: string; seasonId: string }>();
  const navigate = useNavigate();

  const leagues = useLeagueStore(s => s.leagues);
  const seasons = useSeasonStore(s => s.seasons);
  const seasonsLoading = useSeasonStore(s => s.loading);
  const divisions = useDivisionStore(s => s.divisions);
  const teams = useTeamStore(s => s.teams);
  const venues = useVenueStore(s => s.venues);
  const profile = useAuthStore(s => s.profile);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardResumeAtPreview, setWizardResumeAtPreview] = useState(false);
  const [wizardInitialMode, setWizardInitialMode] = useState<WizardMode | undefined>(undefined);
  const [addDivisionOpen, setAddDivisionOpen] = useState(false);
  const [editingDivision, setEditingDivision] = useState<Division | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [draftListOpen, setDraftListOpen] = useState(false);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const allEvents = useEventStore(s => s.events);

  const league = leagues.find(l => l.id === leagueId);
  const season = seasons.find(s => s.id === seasonId);
  const leagueTeams = teams.filter(t => t.leagueIds?.includes(leagueId ?? ''));

  // Estimated available venue slots across the season range
  const availableSlots = (() => {
    if (!season || venues.length === 0) return 0;
    const weeks = countWeeksInRange(season.startDate, season.endDate);
    let total = 0;
    for (const venue of venues) {
      const windows = venue.defaultAvailabilityWindows ?? [];
      if (windows.length === 0) {
        // Rough estimate: assume 2 slots/day, 2 available days/week
        total += 2 * 2 * weeks;
      } else {
        for (const w of windows) {
          const startMins = parseInt(w.startTime.split(':')[0]) * 60 + parseInt(w.startTime.split(':')[1]);
          const endMins = parseInt(w.endTime.split(':')[0]) * 60 + parseInt(w.endTime.split(':')[1]);
          const slotDuration = 90; // assume 90-min match slots
          const slotsPerDay = Math.floor((endMins - startMins) / slotDuration);
          const fields = venue.fields?.length ?? 1;
          total += slotsPerDay * fields * weeks;
        }
      }
    }
    return total;
  })();

  const requiredSlots = season ? Math.ceil((season.gamesPerTeam * leagueTeams.length) / 2) : 0;
  const feasibilityCritical = season && leagueTeams.length > 0 && venues.length > 0
    && availableSlots < requiredSlots * 0.75;

  const canGenerate = venues.length > 0 && !feasibilityCritical;

  useEffect(() => {
    if (!leagueId) return;
    return useSeasonStore.getState().fetchSeasons(leagueId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  useEffect(() => {
    if (!leagueId || !seasonId) return;
    return useDivisionStore.getState().fetchDivisions(leagueId, seasonId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, seasonId]);

  useEffect(() => {
    return useVenueStore.getState().subscribe();
  }, []);

  useEffect(() => {
    if (!leagueId || !seasonId) return;
    return useCollectionStore.getState().loadWizardDraft(leagueId, seasonId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, seasonId]);

  const isAdmin = profile?.role === 'admin';
  // CVR-2026-008: use membership-aware helper so co-managers added via
  // assignScopedRole (memberships[] only, no legacy scalar leagueId) also get access.
  // Also check league.managerIds directly — covers users who created the league but
  // don't have a matching league_manager membership entry yet (multi-role gap, TD-501).
  const canManage = isAdmin
    || isManagerOfLeague(profile ?? null, leagueId ?? '')
    || (profile?.uid != null && (league?.managerIds ?? []).includes(profile.uid));
  const hasPublishedDivision = divisions.some(d => d.scheduleStatus === 'published');

  // Local draft event subscription — the global event store intentionally excludes
  // drafts (Firestore rules block non-managers from listing them). Managers get a
  // separate targeted query here so the draft review list actually populates.
  const [localDraftEvents, setLocalDraftEvents] = useState<ScheduledEvent[]>([]);
  useEffect(() => {
    if (!canManage || !seasonId) { setLocalDraftEvents([]); return; }
    const q = query(
      collection(db, 'events'),
      where('seasonId', '==', seasonId),
      where('status', '==', 'draft'),
      orderBy('date'),
      orderBy('startTime'),
    );
    return onSnapshot(q, snap => {
      setLocalDraftEvents(snap.docs.map(d => ({ ...d.data(), id: d.id }) as ScheduledEvent));
    }, err => console.error('[SeasonDashboard] draft events error:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, seasonId]);

  // Draft/published schedule detection
  // For division-based seasons: use division.scheduleStatus
  // For undivided seasons: fall back to local draft event count
  const seasonScheduledEvents = allEvents.filter(e => e.seasonId === seasonId && e.status === 'scheduled');
  const hasDraftDivision = divisions.some(d => d.scheduleStatus === 'draft');
  const hasDraftSchedule = hasDraftDivision || (divisions.length === 0 && localDraftEvents.length > 0);
  const hasFullyPublished = divisions.length > 0
    ? divisions.every(d => d.scheduleStatus === 'published')
    : seasonScheduledEvents.length > 0;

  const draftDivisions = divisions.filter(d => d.scheduleStatus === 'draft');
  const totalUnscheduled = draftDivisions.reduce((sum, d) => sum + (d.unscheduledCount ?? 0), 0);

  // localDraftEvents is already ordered by date/startTime from the Firestore query
  const sortedDraftEvents = localDraftEvents;

  async function handlePublishDraft(divId?: string) {
    if (!leagueId || !seasonId) return;
    setPublishing(true);
    setPublishError('');
    try {
      const publishFn = httpsCallable<
        { leagueId: string; seasonId: string; divisionId?: string },
        { publishedCount: number }
      >(getFunctions(), 'publishSchedule');
      if (divId) {
        await publishFn({ leagueId, seasonId, divisionId: divId });
      } else if (draftDivisions.length > 0) {
        // Division-based season: publish every draft division so scheduleStatus
        // is updated to 'published' for each — required for hasFullyPublished to flip.
        await Promise.all(
          draftDivisions.map(d => publishFn({ leagueId, seasonId, divisionId: d.id }))
        );
      } else {
        await publishFn({ leagueId, seasonId });
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? 'Publish failed.';
      setPublishError(msg);
    } finally {
      setPublishing(false);
    }
  }

  async function handleDeleteSelected() {
    setDeleting(true);
    try {
      await Promise.all(
        [...selectedDraftIds].map(id => useEventStore.getState().deleteEvent(id))
      );
      setSelectedDraftIds(new Set());
      setConfirmDeleteSelected(false);
    } finally {
      setDeleting(false);
    }
  }

  async function handleClearAllDraft() {
    if (!leagueId) return;
    setDeleting(true);
    try {
      await Promise.all(sortedDraftEvents.map(e => useEventStore.getState().deleteEvent(e.id)));
      // Reset every draft division back to 'none'
      await Promise.all(
        draftDivisions.map(d =>
          updateDoc(doc(db, 'leagues', leagueId, 'divisions', d.id), {
            scheduleStatus: 'none',
            unscheduledCount: 0,
            updatedAt: new Date().toISOString(),
          })
        )
      );
      setSelectedDraftIds(new Set());
      setDraftListOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  if (!leagueId || !seasonId) return null;
  if (!league) return <div className="p-4 sm:p-6 text-gray-500">League not found.</div>;
  if (!season && seasonsLoading) return <div className="p-4 sm:p-6 text-gray-400">Loading…</div>;
  if (!season) return <div className="p-4 sm:p-6 text-gray-500">Season not found.</div>;

  return (
    <div className="p-4 sm:p-6 max-w-3xl">
      {/* Back nav */}
      <button
        onClick={() => navigate(`/leagues/${leagueId}`)}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4"
      >
        <ArrowLeft size={14} /> Back to {league.name}
      </button>

      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Season</p>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">{season.name}</h1>
            <SeasonStatusBadge status={season.status} />
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {formatDateRange(season.startDate, season.endDate)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {season.gamesPerTeam} games per team · {leagueTeams.length} team{leagueTeams.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canManage && (
          <Link
            to={`/leagues/${leagueId}/seasons/${seasonId}/settings`}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
          >
            <Settings size={14} /> Settings
          </Link>
        )}
      </div>

      {/* ── Regular Season ── */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-800 mb-3">Regular Season</h2>

        {!hasFullyPublished && (
          <div className="space-y-3">
            {/* Step 1: Configure Venues */}
            <TaskCard
              icon={<MapPin size={16} />}
              title="1. Configure Venues"
              status={
                venues.length === 0
                  ? 'Warning: no venues'
                  : `${venues.length} venue${venues.length !== 1 ? 's' : ''} configured`
              }
              statusVariant={venues.length === 0 ? 'warning' : 'ok'}
              description="Venues are required before the schedule can be generated."
            >
              <Link
                to="/venues"
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                {venues.length === 0 ? 'Set up venues' : 'Manage venues'}
                <ChevronRight size={13} />
              </Link>
            </TaskCard>

            {/* Step 2: Add Teams */}
            <TaskCard
              icon={<Users size={16} />}
              title="2. Add Teams"
              status={
                leagueTeams.length < 2
                  ? `${leagueTeams.length} team${leagueTeams.length !== 1 ? 's' : ''} — need at least 2`
                  : `${leagueTeams.length} team${leagueTeams.length !== 1 ? 's' : ''}`
              }
              statusVariant={leagueTeams.length < 2 ? 'warning' : 'ok'}
              description="At least 2 teams are needed to generate a schedule."
            >
              <Link
                to={`/leagues/${leagueId}`}
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                Go to league teams
                <ChevronRight size={13} />
              </Link>
            </TaskCard>

            {/* Step 3: Assign Teams to Divisions (only when divisions exist) */}
            {divisions.length > 0 && (() => {
              const divisionsWithFewTeams = divisions.filter(d => d.teamIds.length < 2);
              const allDivisionsHaveTeams = divisionsWithFewTeams.length === 0;
              const totalAssigned = divisions.reduce((s, d) => s + d.teamIds.length, 0);
              return (
                <TaskCard
                  icon={<Layers size={16} />}
                  title="3. Assign Teams to Divisions"
                  status={
                    allDivisionsHaveTeams
                      ? `${totalAssigned} team${totalAssigned !== 1 ? 's' : ''} assigned`
                      : `${divisionsWithFewTeams.length} division${divisionsWithFewTeams.length !== 1 ? 's' : ''} need teams`
                  }
                  statusVariant={allDivisionsHaveTeams ? 'ok' : 'warning'}
                  description="Each division needs at least 2 teams to generate its schedule."
                />
              );
            })()}
          </div>
        )}

        {/* Feasibility Advisory Panel */}
        <div className="mt-4">
          <FeasibilityPanel
            season={season}
            teamCount={leagueTeams.length}
            venueCount={venues.length}
            availableSlots={availableSlots}
          />
        </div>

        {/* Card 4: Schedule CTA — adapts based on draft / published state */}
        {/* Draft banner is manager-only: hasDraftSchedule uses localDraftEvents which is manager-gated,
            but hasDraftDivision reads division.scheduleStatus which coaches can see — wrap in canManage (SEC-84) */}
        {hasFullyPublished ? (
          <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-green-600" />
                  Schedule Published
                </h3>
                <p className="text-xs text-gray-600 mt-1">
                  All games are live and visible to coaches and players.
                </p>
              </div>
              {canManage && (
                <div className="flex gap-2 flex-wrap">
                  <RequiresPro>
                    <Button variant="secondary" size="sm" onClick={() => { setWizardInitialMode(undefined); setWizardResumeAtPreview(false); setWizardOpen(true); }}>
                      <Wand2 size={14} /> Regenerate
                    </Button>
                  </RequiresPro>
                  <RequiresPro>
                    <Button variant="secondary" size="sm" onClick={() => { setWizardInitialMode('practice'); setWizardResumeAtPreview(false); setWizardOpen(true); }}>
                      <Dumbbell size={14} /> Schedule Practices
                    </Button>
                  </RequiresPro>
                </div>
              )}
            </div>
          </div>
        ) : canManage && hasDraftSchedule ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-600" />
                  Draft Schedule Ready
                </h3>
                <p className="text-xs text-gray-600 mt-1">
                  {draftDivisions.length > 0
                    ? `${draftDivisions.length} division${draftDivisions.length !== 1 ? 's' : ''} have a draft schedule waiting to be published.`
                    : `${localDraftEvents.length} draft event${localDraftEvents.length !== 1 ? 's' : ''} waiting to be published.`}
                </p>
                {totalUnscheduled > 0 && (
                  <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                    <AlertTriangle size={12} className="flex-shrink-0" />
                    {totalUnscheduled} game{totalUnscheduled !== 1 ? 's' : ''} couldn't be auto-scheduled — add manually or edit the wizard to fix.
                  </p>
                )}
                {publishError && (
                  <p className="text-xs text-red-600 mt-1">{publishError}</p>
                )}
              </div>
              {canManage && (
                <div className="flex gap-2 flex-wrap">
                  <RequiresPro>
                    <Button variant="secondary" size="sm" onClick={() => { setWizardInitialMode(undefined); setWizardResumeAtPreview(true); setWizardOpen(true); }}>
                      <Wand2 size={14} /> Edit Schedule
                    </Button>
                  </RequiresPro>
                  <RequiresPro>
                    <Button variant="secondary" size="sm" onClick={() => { setWizardInitialMode('practice'); setWizardResumeAtPreview(false); setWizardOpen(true); }}>
                      <Dumbbell size={14} /> Schedule Practices
                    </Button>
                  </RequiresPro>
                  <RequiresPro>
                    <Button variant="danger" size="sm" onClick={() => setConfirmClearAll(true)} disabled={deleting}>
                      <Trash2 size={14} /> Clear Draft
                    </Button>
                  </RequiresPro>
                  <RequiresPro>
                    <Button
                      size="sm"
                      onClick={() => void handlePublishDraft()}
                      disabled={publishing}
                    >
                      {publishing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      {publishing ? 'Publishing…' : 'Publish Now'}
                    </Button>
                  </RequiresPro>
                </div>
              )}
            </div>

            {/* Collapsible draft game list */}
            {sortedDraftEvents.length > 0 && (
              <div className="mt-3 border-t border-amber-200 pt-3">
                <button
                  onClick={() => { setDraftListOpen(v => !v); setSelectedDraftIds(new Set()); setConfirmDeleteSelected(false); }}
                  className="flex items-center gap-1.5 text-xs font-medium text-amber-800 hover:text-amber-900"
                >
                  {draftListOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {draftListOpen ? 'Hide' : 'View'} {sortedDraftEvents.length} draft event{sortedDraftEvents.length !== 1 ? 's' : ''}
                </button>

                {draftListOpen && (
                  <div className="mt-2 space-y-1">
                    {/* Select-all row — managers only */}
                    {canManage && (
                      <div className="flex items-center gap-2 px-3 py-1.5">
                        <input
                          type="checkbox"
                          aria-label="Select all draft events"
                          checked={selectedDraftIds.size === sortedDraftEvents.length}
                          onChange={e =>
                            setSelectedDraftIds(
                              e.target.checked ? new Set(sortedDraftEvents.map(ev => ev.id)) : new Set()
                            )
                          }
                          className="h-3.5 w-3.5 rounded border-gray-300 accent-amber-600"
                        />
                        <span className="text-xs text-gray-500">
                          {selectedDraftIds.size > 0
                            ? `${selectedDraftIds.size} of ${sortedDraftEvents.length} selected`
                            : `Select all ${sortedDraftEvents.length} events`}
                        </span>
                      </div>
                    )}

                    {/* Game rows */}
                    {sortedDraftEvents.map(e => {
                      const isPractice = e.type === 'practice';
                      const homeTeam = leagueTeams.find(t => e.teamIds[0] === t.id);
                      const awayTeam = !isPractice ? leagueTeams.find(t => e.teamIds[1] === t.id) : null;
                      const dateLabel = new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', {
                        weekday: 'short', month: 'short', day: 'numeric',
                      });
                      const checked = selectedDraftIds.has(e.id);
                      return (
                        <label
                          key={e.id}
                          className={`flex items-center gap-2.5 text-xs rounded-lg px-3 py-2 border cursor-pointer transition-colors ${
                            checked ? 'bg-amber-50 border-amber-300' : 'bg-white border-amber-100 hover:bg-amber-50'
                          }`}
                        >
                          {canManage && (
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={ev => {
                                const next = new Set(selectedDraftIds);
                                ev.target.checked ? next.add(e.id) : next.delete(e.id);
                                setSelectedDraftIds(next);
                                setConfirmDeleteSelected(false);
                              }}
                              className="h-3.5 w-3.5 flex-shrink-0 rounded border-gray-300 accent-amber-600"
                            />
                          )}
                          <span className="font-medium text-gray-800 flex-1 min-w-0">
                            <span className="block">
                              {isPractice
                                ? `${homeTeam?.name ?? 'Team'} — Practice`
                                : `${homeTeam?.name ?? 'TBD'} vs ${awayTeam?.name ?? 'TBD'}`}
                            </span>
                            {(e.location || e.fieldName) && (
                              <span className="block text-xs font-normal text-gray-400 truncate">
                                {[e.location, e.fieldName].filter(Boolean).join(' · ')}
                              </span>
                            )}
                          </span>
                          <span className="text-gray-500 tabular-nums flex-shrink-0">
                            {dateLabel} · {e.startTime}
                          </span>
                        </label>
                      );
                    })}

                    {/* Action bar */}
                    {selectedDraftIds.size > 0 && (
                      <div className="mt-2 rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 flex items-center justify-between gap-3">
                        <span className="text-xs font-medium text-amber-900">
                          {selectedDraftIds.size} game{selectedDraftIds.size !== 1 ? 's' : ''} selected
                        </span>
                        {confirmDeleteSelected ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-amber-900">Delete {selectedDraftIds.size} game{selectedDraftIds.size !== 1 ? 's' : ''}?</span>
                            <Button variant="danger" size="sm" onClick={() => void handleDeleteSelected()} disabled={deleting}>
                              {deleting ? <Loader2 size={12} className="animate-spin" /> : null}
                              Yes, delete
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => setConfirmDeleteSelected(false)}>Cancel</Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Button variant="danger" size="sm" onClick={() => setConfirmDeleteSelected(true)}>
                              <Trash2 size={12} /> Delete selected
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => { setSelectedDraftIds(new Set()); }}>
                              Deselect all
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <Wand2 size={16} className="text-indigo-600" />
                  Generate Schedule
                </h3>
                <p className="text-xs text-gray-600 mt-1">
                  {!canGenerate && venues.length === 0
                    ? 'Configure at least one venue before generating.'
                    : !canGenerate && feasibilityCritical
                    ? 'Not enough venue slots — add more venue time or reduce games per team.'
                    : `Ready to schedule ${leagueTeams.length} team${leagueTeams.length !== 1 ? 's' : ''} across ${season.gamesPerTeam} games each.`}
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <RequiresPro>
                  <Button
                    onClick={() => { setWizardInitialMode(undefined); setWizardResumeAtPreview(false); setWizardOpen(true); }}
                    disabled={!canGenerate || leagueTeams.length < 2}
                  >
                    <Wand2 size={14} /> Generate Schedule
                  </Button>
                </RequiresPro>
                <RequiresPro>
                  <Button
                    variant="secondary"
                    onClick={() => { setWizardInitialMode('practice'); setWizardResumeAtPreview(false); setWizardOpen(true); }}
                    disabled={leagueTeams.length < 1}
                  >
                    <Dumbbell size={14} /> Schedule Practices
                  </Button>
                </RequiresPro>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Divisions ── */}
      {(divisions.length > 0 || canManage) && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-800">Divisions</h2>
            {canManage && (
              <RequiresPro>
                <Button variant="secondary" size="sm" onClick={() => setAddDivisionOpen(true)}>
                  <Plus size={14} /> Add Division
                </Button>
              </RequiresPro>
            )}
          </div>

          {divisions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
              No divisions yet. Divisions let you organise teams into sub-groups with separate schedules.
            </div>
          ) : (
            <div className="space-y-3">
              {/* Status pills row */}
              <div className="flex flex-wrap gap-2">
                {divisions.map(div => (
                  <div
                    key={div.id}
                    className={`flex items-center gap-2 border bg-white rounded-lg px-3 py-2 ${canManage ? 'cursor-pointer border-gray-200 hover:border-blue-300' : 'border-gray-200'}`}
                    onClick={() => canManage && setEditingDivision(div)}
                  >
                    <span className="text-sm font-medium text-gray-800">{div.name}</span>
                    <DivisionStatusBadge status={div.scheduleStatus} />
                    {canManage && div.scheduleStatus === 'draft' && (
                      <button
                        className="text-xs text-amber-700 hover:text-amber-900 font-medium underline ml-1"
                        onClick={e => { e.stopPropagation(); void handlePublishDraft(div.id); }}
                        disabled={publishing}
                      >
                        Publish
                      </button>
                    )}
                    {canManage && div.scheduleStatus === 'none' && (
                      <button
                        className="text-gray-300 hover:text-red-500 transition-colors ml-1"
                        onClick={e => { e.stopPropagation(); void useDivisionStore.getState().deleteDivision(leagueId ?? '', div.id); }}
                        title="Delete division"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Per-division schedule configuration (managers only) */}
              {canManage && (
                <div className="space-y-3 pt-1">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Schedule Configuration</p>
                  {divisions.map(div => (
                    <DivisionScheduleSetupCard
                      key={div.id}
                      division={div}
                      leagueId={leagueId}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Standings ── */}
      {hasPublishedDivision && (
        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-800 mb-3">Standings</h2>
          {divisions.filter(d => d.scheduleStatus === 'published').map(div => (
            <div key={div.id} className="mb-4 last:mb-0">
              {divisions.length > 1 && (
                <h3 className="text-sm font-medium text-gray-600 px-1 mb-1">{div.name}</h3>
              )}
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <StandingsTable leagueId={leagueId} seasonId={seasonId} teamIds={div.teamIds} />
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ── Post-Season ── */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-800 mb-3">Post-Season</h2>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
          <Clock size={24} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">Coming soon — playoffs and knockout brackets.</p>
        </div>
      </section>

      {/* ── Season Admin ── */}
      {canManage && (
        <section>
          <h2 className="text-base font-semibold text-gray-800 mb-3">Season Admin</h2>
          <div className="flex gap-3 flex-wrap">
            <Link
              to={`/leagues/${leagueId}/seasons/${seasonId}/settings`}
              className="flex items-center gap-2 text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors"
            >
              <Settings size={14} /> Season Settings
            </Link>
          </div>
        </section>
      )}

      {/* Modals */}
      {wizardOpen && (
        <ScheduleWizardModal
          open={wizardOpen}
          onClose={() => { setWizardOpen(false); setWizardInitialMode(undefined); }}
          league={league}
          leagueTeams={leagueTeams}
          season={season}
          currentUserUid={profile?.uid ?? ''}
          divisionId={divisions.length === 1 ? divisions[0].id : undefined}
          divisions={divisions.length > 0 ? divisions : undefined}
          resumeAtPreview={wizardResumeAtPreview}
          initialMode={wizardInitialMode}
        />
      )}

      <AddDivisionModal
        open={addDivisionOpen}
        onClose={() => setAddDivisionOpen(false)}
        leagueId={leagueId}
        seasonId={seasonId}
        leagueTeams={leagueTeams}
        existingDivisions={divisions}
      />

      {editingDivision && (
        <EditDivisionModal
          open={editingDivision !== null}
          onClose={() => setEditingDivision(null)}
          leagueId={leagueId}
          division={editingDivision}
          leagueTeams={leagueTeams}
          otherDivisions={divisions.filter(d => d.id !== editingDivision.id)}
        />
      )}

      <ConfirmDialog
        open={confirmClearAll}
        onClose={() => setConfirmClearAll(false)}
        onConfirm={() => void handleClearAllDraft()}
        title="Clear draft schedule"
        message={`This will permanently delete all ${sortedDraftEvents.length} draft game${sortedDraftEvents.length !== 1 ? 's' : ''} and reset the schedule to the generation step. This cannot be undone.`}
        confirmLabel="Clear draft"
        typeToConfirm="CLEAR"
      />
    </div>
  );
}
