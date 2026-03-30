import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, MapPin, Users, Wand2, Plus, CheckCircle2,
  AlertTriangle, AlertCircle, Clock, ChevronRight, Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { ScheduleWizardModal } from '@/components/leagues/ScheduleWizardModal';
import { StandingsTable } from '@/components/standings/StandingsTable';
import { useSeasonStore } from '@/store/useSeasonStore';
import { useDivisionStore } from '@/store/useDivisionStore';
import { useLeagueStore } from '@/store/useLeagueStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useVenueStore } from '@/store/useVenueStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { Division, Season, Team } from '@/types';

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
}

function AddDivisionModal({ open, onClose, leagueId, seasonId, leagueTeams }: AddDivisionModalProps) {
  const createDivision = useDivisionStore(s => s.createDivision);
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
              {leagueTeams.map(team => (
                <label
                  key={team.id}
                  className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-0"
                >
                  <input
                    type="checkbox"
                    checked={selectedTeamIds.has(team.id)}
                    onChange={() => toggleTeam(team.id)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: team.color }} />
                  <span className="text-sm text-gray-800">{team.name}</span>
                </label>
              ))}
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
  const { seasons, fetchSeasons } = useSeasonStore();
  const { divisions, fetchDivisions } = useDivisionStore();
  const teams = useTeamStore(s => s.teams);
  const venues = useVenueStore(s => s.venues);
  const subscribeVenues = useVenueStore(s => s.subscribe);
  const profile = useAuthStore(s => s.profile);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [addDivisionOpen, setAddDivisionOpen] = useState(false);

  const league = leagues.find(l => l.id === leagueId);
  const season = seasons.find(s => s.id === seasonId);
  const leagueTeams = teams.filter(t => t.leagueId === leagueId);

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
    const unsub = fetchSeasons(leagueId);
    return unsub;
  }, [leagueId, fetchSeasons]);

  useEffect(() => {
    if (!leagueId || !seasonId) return;
    const unsub = fetchDivisions(leagueId, seasonId);
    return unsub;
  }, [leagueId, seasonId, fetchDivisions]);

  useEffect(() => {
    const unsub = subscribeVenues();
    return unsub;
  }, [subscribeVenues]);

  const isAdmin = profile?.role === 'admin';
  const canManage = isAdmin || (profile?.role === 'league_manager' && profile?.leagueId === leagueId);
  const hasPublishedDivision = divisions.some(d => d.scheduleStatus === 'published');

  if (!leagueId || !seasonId) return null;
  if (!league) return <div className="p-4 sm:p-6 text-gray-500">League not found.</div>;
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

        <div className="space-y-3">
          {/* Card 1: Venue & Blackouts */}
          <TaskCard
            icon={<MapPin size={16} />}
            title="Venue & Blackouts"
            status={
              venues.length === 0
                ? 'Warning: no venues'
                : `${venues.length} venue${venues.length !== 1 ? 's' : ''} configured`
            }
            statusVariant={venues.length === 0 ? 'warning' : 'ok'}
            description="Configure venues and season-specific blackout dates."
          >
            <Link
              to="/venues"
              className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              {venues.length === 0 ? 'Set up venues' : 'Manage venues'}
              <ChevronRight size={13} />
            </Link>
          </TaskCard>

          {/* Card 2: Coach Availability (Optional) */}
          <TaskCard
            icon={<Users size={16} />}
            title="Coach Availability"
            status="Not sent"
            statusVariant="neutral"
            description="Collect coach availability before generating the schedule."
            secondary
          >
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" disabled>
                Send availability request
              </Button>
              <span className="text-xs text-gray-400">Available in Sprint 2</span>
            </div>
          </TaskCard>
        </div>

        {/* Feasibility Advisory Panel */}
        <div className="mt-4">
          <FeasibilityPanel
            season={season}
            teamCount={leagueTeams.length}
            venueCount={venues.length}
            availableSlots={availableSlots}
          />
        </div>

        {/* Card 4: Generate Schedule CTA */}
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
            <Button
              onClick={() => setWizardOpen(true)}
              disabled={!canGenerate || leagueTeams.length < 2}
            >
              <Wand2 size={14} /> Open Wizard
            </Button>
          </div>
          {leagueTeams.length < 2 && (
            <p className="text-xs text-amber-700 mt-3">
              At least 2 teams are required. Add teams to the league first.
            </p>
          )}
        </div>
      </section>

      {/* ── Divisions ── */}
      {(divisions.length > 0 || canManage) && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-800">Divisions</h2>
            {canManage && (
              <Button variant="secondary" size="sm" onClick={() => setAddDivisionOpen(true)}>
                <Plus size={14} /> Add Division
              </Button>
            )}
          </div>

          {divisions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
              No divisions yet. Divisions let you organise teams into sub-groups with separate schedules.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {divisions.map(div => (
                <div
                  key={div.id}
                  className="flex items-center gap-2 border border-gray-200 bg-white rounded-lg px-3 py-2"
                >
                  <span className="text-sm font-medium text-gray-800">{div.name}</span>
                  <DivisionStatusBadge status={div.scheduleStatus} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Standings ── */}
      {hasPublishedDivision && (
        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-800 mb-3">Standings</h2>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <StandingsTable leagueId={leagueId} seasonId={seasonId} />
          </div>
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
          onClose={() => setWizardOpen(false)}
          league={league}
          leagueTeams={leagueTeams}
          season={season}
          currentUserUid={profile?.uid ?? ''}
          divisionId={divisions.length === 1 ? divisions[0].id : undefined}
        />
      )}

      <AddDivisionModal
        open={addDivisionOpen}
        onClose={() => setAddDivisionOpen(false)}
        leagueId={leagueId}
        seasonId={seasonId}
        leagueTeams={leagueTeams}
      />
    </div>
  );
}
