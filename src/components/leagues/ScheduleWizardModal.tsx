import { useState, useRef, useMemo, useEffect } from 'react';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { collection, getDocs, setDoc, updateDoc, doc, query, orderBy, limit, where, deleteDoc } from 'firebase/firestore';
import {
  Calendar, MapPin, Users, Wand2, CheckCircle2, AlertTriangle,
  AlertCircle, ChevronLeft, ChevronRight, Plus, Trash2, Loader2,
  GripVertical, Trophy, Dumbbell, Star, Lightbulb, Search, ChevronDown,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { db } from '@/lib/firebase';
import { useEventStore } from '@/store/useEventStore';
import { useCollectionStore } from '@/store/useCollectionStore';
import { useVenueStore } from '@/store/useVenueStore';
import { useLeagueVenueStore } from '@/store/useLeagueVenueStore';
import { useAuthStore } from '@/store/useAuthStore';
import { DEFAULT_CONSTRAINTS } from '@/types/wizard';
import type { WizardSurface } from '@/types/wizard';
import { getTopCoverageSlots } from '@/lib/coverageUtils';
import type { Venue, LeagueVenue, RecurringVenueWindow } from '@/types/venue';
import type { Division, League, Team, ScheduledEvent, Season, WizardMode, ScheduleConstraint, CoachAvailabilityResponse } from '@/types';
import type { ScheduleConfig, ScheduleVenueConfig } from '@/types/scheduleConfig';

// ─── Local types ──────────────────────────────────────────────────────────────

interface WizardVenueConfig {
  selectedVenueId: string | null; // null = manual entry
  name: string;
  surfaces: WizardSurface[];
  availableDays: string[]; // derived from defaultAvailabilityWindows for generator compat
  availableTimeStart: string;
  availableTimeEnd: string;
  blackoutDates: string[];
  // New availability windows (v2)
  availabilityWindows: RecurringVenueWindow[];
  // Per-division surface preferences: divisionId -> array of surface preference entries
  divisionSurfacePrefs: Record<string, Array<{ surfaceId: string; preference: 'preferred' | 'required' }>>;
}

interface GeneratedFixture {
  round: number;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  date: string;
  startTime: string;
  endTime: string;
  venueId: string;
  venueName: string;
  fieldId?: string;
  fieldName?: string;
  isDoubleheader: boolean;
  doubleheaderSlot?: 1 | 2;
  isFallbackSlot: boolean;
  divisionId?: string;
  // Legacy compatibility fields
  venue?: string;
  stage?: string;
  isFallback?: boolean;
  fallbackReason?: string;
}

interface FallbackFixtureSummary {
  homeTeamName: string;
  awayTeamName: string;
  date: string;
  startTime: string;
  reason: string;
}

interface DivisionResult {
  divisionId: string;
  divisionName: string;
  fixtures: GeneratedFixture[];
  unassignedCount: number;
}

interface ScheduleOutput {
  fixtures: GeneratedFixture[];
  unassignedPairings?: Array<{
    homeTeamId: string; homeTeamName: string;
    awayTeamId: string; awayTeamName: string;
    reason: string;
  }>;
  conflicts: Array<{ severity: 'hard' | 'soft'; description: string; constraintId?: string }>;
  teamStats?: Array<{
    teamId: string; teamName: string;
    totalGames: number; homeGames: number; awayGames: number;
    maxRestGap: number; minRestGap: number;
    byeRounds: number; byeRound?: number;
  }>;
  stats: {
    totalFixtures?: number;
    totalFixturesRequired?: number;
    assignedFixtures: number;
    unassignedFixtures: number;
    fallbackSlotsUsed?: number;
    feasible: boolean;
  };
  summary: string;
  warnings?: Array<{ code: string; message: string }>;
  fallbackFixtures?: FallbackFixtureSummary[];
  divisionResults?: DivisionResult[];
}

type WizardStep = 'mode' | 'config' | 'teams' | 'cadence' | 'venues' | 'preferences' | 'availability' | 'blackouts' | 'generate' | 'preview' | 'publish';
type Format = 'single_round_robin' | 'double_round_robin' | 'single_elimination' | 'double_elimination' | 'group_then_knockout';

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_OPTIONS = DAY_NAMES.map((d, i) => ({ value: String(i), label: d }));
const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const generateScheduleFn = httpsCallable<object, ScheduleOutput>(getFunctions(), 'generateSchedule');
const publishScheduleFn = httpsCallable<{ leagueId: string; seasonId: string; divisionId?: string }, { publishedCount: number }>(getFunctions(), 'publishSchedule');

// FORMAT_OPTIONS is used when mode === 'season' format select is rendered (group_then_knockout path)
const FORMAT_OPTIONS: { value: string; label: string }[] = [
  { value: 'single_round_robin', label: 'Single Round-Robin (each pair plays once)' },
  { value: 'double_round_robin', label: 'Double Round-Robin (home & away)' },
  { value: 'group_then_knockout', label: 'Group Stage + Knockout' },
];

const PLAYOFF_FORMAT_OPTIONS = [
  { value: 'single_elimination', label: 'Single Elimination (knockout)' },
  { value: 'double_elimination', label: 'Double Elimination (2 losses to exit)' },
];

function getSteps(mode: WizardMode): WizardStep[] {
  if (mode === 'season') return ['config', 'venues', 'preferences', 'availability', 'blackouts', 'generate', 'preview', 'publish'];
  if (mode === 'practice') return ['teams', 'cadence', 'venues', 'blackouts', 'generate', 'preview', 'publish'];
  if (mode === 'playoff') return ['config', 'venues', 'blackouts', 'generate', 'preview', 'publish'];
  return [];
}

const STEP_LABELS: Record<WizardStep, string> = {
  mode: 'Mode',
  config: 'Season Setup',
  teams: 'Teams',
  cadence: 'Practice Cadence',
  venues: 'Venues',
  preferences: 'Preferences',
  availability: 'Coach Availability',
  blackouts: 'Blackout Dates',
  generate: 'Generate',
  preview: 'Preview',
  publish: 'Publish',
};

function newVenueConfig(): WizardVenueConfig {
  return {
    selectedVenueId: null,
    name: '',
    surfaces: [],
    availableDays: ['Saturday', 'Sunday'],
    availableTimeStart: '09:00',
    availableTimeEnd: '17:00',
    blackoutDates: [],
    availabilityWindows: [],
    divisionSurfacePrefs: {},
  };
}

function venueConfigFromSaved(saved: Venue): Partial<WizardVenueConfig> {
  const surfaces: WizardSurface[] = (saved.fields && saved.fields.length > 0)
    ? saved.fields.map(f => ({ id: f.id, name: f.name }))
    : [{ id: crypto.randomUUID(), name: 'Field 1' }];
  return {
    selectedVenueId: saved.id,
    name: saved.name,
    surfaces,
  };
}

// ─── Quick-Create Venue Modal ─────────────────────────────────────────────────

interface QuickCreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (venue: Venue) => void;
  ownerUid: string;
}

function QuickCreateVenueModal({ open, onClose, onCreated, ownerUid }: QuickCreateModalProps) {
  const addVenueToLib = useVenueStore(s => s.addVenue);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!name.trim()) { setError('Venue name is required.'); return; }
    if (!address.trim()) { setError('Address is required.'); return; }
    setSaving(true);
    setError('');
    const now = new Date().toISOString();
    const venue: Venue = {
      id: crypto.randomUUID(),
      ownerUid,
      name: name.trim(),
      address: address.trim(),
      isOutdoor: true,
      fields: [{ id: crypto.randomUUID(), name: 'Field 1' }],
      defaultAvailabilityWindows: [],
      defaultBlackoutDates: [],
      createdAt: now,
      updatedAt: now,
    };
    try {
      await addVenueToLib(venue);
      // Fire-and-forget geocode
      const geocodeFn = httpsCallable(getFunctions(), 'geocodeVenueAddress');
      geocodeFn({ venueId: venue.id, address: venue.address, ownerUid }).catch(() => {});
      onCreated(venue);
      setName('');
      setAddress('');
    } catch {
      setError('Failed to save venue. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    setName('');
    setAddress('');
    setError('');
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="New Venue" size="sm">
      <div className="space-y-4">
        <Input
          label="Venue Name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Riverside Park"
          autoFocus
        />
        <Input
          label="Address"
          value={address}
          onChange={e => setAddress(e.target.value)}
          placeholder="e.g. 123 Park Rd, City"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={handleClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save Venue'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Venue Combobox ───────────────────────────────────────────────────────────

interface VenueComboboxProps {
  venueConfig: WizardVenueConfig;
  savedVenues: Venue[];
  leagueVenues: LeagueVenue[];
  onSelectSaved: (venue: Venue) => void;
  onCreateNew: () => void;
}

function VenueCombobox({ venueConfig, savedVenues, leagueVenues, onSelectSaved, onCreateNew }: VenueComboboxProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredLeague = leagueVenues.filter(v =>
    v.name.toLowerCase().includes(query.toLowerCase())
  );
  const filteredSaved = savedVenues.filter(v =>
    v.name.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelect(venue: Venue) {
    onSelectSaved(venue);
    setQuery('');
    setOpen(false);
  }

  function handleCreateNew() {
    setQuery('');
    setOpen(false);
    onCreateNew();
  }

  const allVenues: Venue[] = [...leagueVenues, ...savedVenues];
  const displayValue = venueConfig.selectedVenueId
    ? (allVenues.find(v => v.id === venueConfig.selectedVenueId)?.name ?? venueConfig.name)
    : venueConfig.name
      ? venueConfig.name
      : '';

  const isLeagueVenue = venueConfig.selectedVenueId
    ? leagueVenues.some(v => v.id === venueConfig.selectedVenueId)
    : false;

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Venue
      </label>
      <div
        className={`flex items-center border rounded-lg px-3 py-2 gap-2 bg-white cursor-text ${open ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-300 hover:border-gray-400'}`}
        onClick={() => setOpen(true)}
      >
        <Search size={14} className="text-gray-400 flex-shrink-0" />
        <input
          type="text"
          className="flex-1 text-sm outline-none bg-transparent placeholder-gray-400"
          placeholder={displayValue || 'Search venues…'}
          value={open ? query : displayValue}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        {venueConfig.selectedVenueId && !open && (
          isLeagueVenue
            ? <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5 font-medium flex-shrink-0">League</span>
            : <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-medium flex-shrink-0">Saved</span>
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {filteredLeague.length === 0 && filteredSaved.length === 0 && query && (
            <div className="px-3 py-2 text-xs text-gray-400">No venues match "{query}"</div>
          )}
          {filteredLeague.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 border-b border-indigo-100">League Pool</div>
              {filteredLeague.map(venue => (
                <button
                  key={venue.id}
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-indigo-50 flex items-start gap-2 border-b border-gray-100 last:border-0"
                  onMouseDown={e => { e.preventDefault(); handleSelect(venue); }}
                >
                  <MapPin size={13} className="text-indigo-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-gray-800">{venue.name}</span>
                    {venue.address && (
                      <span className="block text-xs text-gray-400 mt-0.5">{venue.address}</span>
                    )}
                  </div>
                </button>
              ))}
            </>
          )}
          {filteredSaved.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 border-b border-blue-100">My Venues</div>
              {filteredSaved.map(venue => (
                <button
                  key={venue.id}
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-blue-50 flex items-start gap-2 border-b border-gray-100 last:border-0"
                  onMouseDown={e => { e.preventDefault(); handleSelect(venue); }}
                >
                  <MapPin size={13} className="text-gray-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-gray-800">{venue.name}</span>
                    {venue.address && (
                      <span className="block text-xs text-gray-400 mt-0.5">{venue.address}</span>
                    )}
                  </div>
                </button>
              ))}
            </>
          )}
          <button
            className="w-full text-left px-3 py-2.5 text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-2 font-medium border-t border-gray-100"
            onMouseDown={e => { e.preventDefault(); handleCreateNew(); }}
          >
            <Plus size={13} /> Create new venue
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  league: League;
  leagueTeams: Team[];
  season?: Season;
  currentUserUid: string;
  divisionId?: string;
  divisions?: Division[];
  resumeAtPreview?: boolean;
  initialMode?: WizardMode;
}

export function ScheduleWizardModal({ open, onClose, league, leagueTeams, season, currentUserUid, divisionId, divisions, resumeAtPreview, initialMode }: Props) {
  const { addEvent } = useEventStore();
  const { createCollection, saveWizardDraft, clearWizardDraft, wizardDraft, activeCollection, responses, loadCollection } = useCollectionStore();

  // Venue stores
  const savedVenues = useVenueStore(s => s.venues);
  const leagueVenues = useLeagueVenueStore(s => s.venues);
  const user = useAuthStore(s => s.user);

  useEffect(() => {
    return useVenueStore.getState().subscribe();
  }, []);

  useEffect(() => {
    return useLeagueVenueStore.getState().subscribe(league.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league.id]);

  // Resolve a venueId from either the league pool or personal saved venues
  function resolveVenue(venueId: string): Venue | undefined {
    return leagueVenues.find(v => v.id === venueId) ?? savedVenues.find(v => v.id === venueId);
  }

  // Mode & step
  const [mode, setMode] = useState<WizardMode | null>(null);
  const [step, setStep] = useState<WizardStep>('mode');

  // ── Season / Playoff config ──────────────────────────────────────────────────
  const [seasonStart, setSeasonStart] = useState(season?.startDate ?? '');
  const [seasonEnd, setSeasonEnd] = useState(season?.endDate ?? '');
  const [matchDuration, setMatchDuration] = useState('60');
  const [bufferMinutes, setBufferMinutes] = useState('15');
  const [gamesPerTeam, setGamesPerTeam] = useState(String(season?.gamesPerTeam ?? 10));
  const [homeAwayBalance, setHomeAwayBalance] = useState(season?.homeAwayBalance ?? true);
  const [useHomeVenues, setUseHomeVenues] = useState(false);
  const [format, setFormat] = useState<Format>('single_round_robin');
  const [playoffFormat, setPlayoffFormat] = useState<Format>('single_elimination');
  const [groupCount, setGroupCount] = useState('2');
  const [groupAdvance, setGroupAdvance] = useState('2');
  const [minRestDays, setMinRestDays] = useState('6');
  const [maxConsecAway, setMaxConsecAway] = useState('2');
  const [distributionExpanded, setDistributionExpanded] = useState(false);

  // ── Per-division config (when divisions prop is present) ─────────────────────
  type DivisionConfigEntry = { format: string; gamesPerTeam: number; matchDurationMinutes: number; coachEnforcement: 'soft' | 'hard' };
  const [divisionConfigs, setDivisionConfigs] = useState<Record<string, DivisionConfigEntry>>(() => {
    if (!divisions || divisions.length === 0) return {};
    return Object.fromEntries(
      divisions.map(div => [
        div.id,
        {
          format: div.format ?? 'single_round_robin',
          gamesPerTeam: div.gamesPerTeam ?? (season?.gamesPerTeam ?? 8),
          matchDurationMinutes: div.matchDurationMinutes ?? 60,
          coachEnforcement: 'soft' as const,
        },
      ])
    );
  });

  // ── Practice config ──────────────────────────────────────────────────────────
  const [practiceTeamIds, setPracticeTeamIds] = useState<Set<string>>(new Set());
  const [practiceTimes, setPracticeTimes] = useState<RecurringVenueWindow[]>([
    { dayOfWeek: 2, startTime: '18:00', endTime: '20:00' }, // Tuesday evening
  ]);
  const [practiceDuration, setPracticeDuration] = useState('90');
  const [practiceMaxPerWeek, setPracticeMaxPerWeek] = useState('2');
  const [practiceSeasonStart, setPracticeSeasonStart] = useState('');
  const [practiceSeasonEnd, setPracticeSeasonEnd] = useState('');

  // ── Venues ──────────────────────────────────────────────────────────────────
  const [venueConfigs, setVenueConfigs] = useState<WizardVenueConfig[]>([newVenueConfig()]);
  const [venueErrors, setVenueErrors] = useState<string[]>([]);

  // Quick-create modal state
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreateTargetIdx, setQuickCreateTargetIdx] = useState<number | null>(null);

  // Per-venue card advanced section open state (keyed by venue index)
  const [venueAdvancedOpen, setVenueAdvancedOpen] = useState<Set<number>>(new Set());

  // Per-venue surface name input state (one input per venue card)
  const [surfaceNameInputs, setSurfaceNameInputs] = useState<string[]>(['']);

  // Per-venue blackout input state (one input per venue card)
  const [venueBlackoutInputs, setVenueBlackoutInputs] = useState<string[]>(['']);

  // ── Preferences ─────────────────────────────────────────────────────────────
  const [constraints, setConstraints] = useState<ScheduleConstraint[]>(DEFAULT_CONSTRAINTS);
  const dragIdx = useRef<number | null>(null);

  // ── Blackouts ───────────────────────────────────────────────────────────────
  const [seasonBlackouts, setSeasonBlackouts] = useState<string[]>([]);
  const [blackoutInput, setBlackoutInput] = useState('');

  // ── Generation & preview ─────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [result, setResult] = useState<ScheduleOutput | null>(null);

  // ── Publish ──────────────────────────────────────────────────────────────────
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [publishedAsDraft, setPublishedAsDraft] = useState(false);

  // ── Availability collection ───────────────────────────────────────────────
  const [availabilityOption, setAvailabilityOption] = useState<'skip' | 'collect'>('skip');
  const [collectionDueDate, setCollectionDueDate] = useState('');
  const [collectionId, setCollectionId] = useState<string | null>(null);

  // ── Generate step ─────────────────────────────────────────────────────────
  const [generatePhase, setGeneratePhase] = useState<'configure' | 'running'>('configure');
  const [recommendationDismissed, setRecommendationDismissed] = useState(false);

  // ── Cross-division coach conflict detection ────────────────────────────────
  interface CrossDivisionConflict {
    coachId: string;
    coachName: string;
    teams: Array<{ teamName: string; divisionName: string }>;
  }
  const [coachConflicts, setCoachConflicts] = useState<CrossDivisionConflict[]>([]);
  const [showConflictWarning, setShowConflictWarning] = useState(false);

  // ── Draft resume ───────────────────────────────────────────────────────────
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [resumeStep, setResumeStep] = useState<WizardStep | null>(null);
  const [showResumeStartOverConfirm, setShowResumeStartOverConfirm] = useState(false);

  // ── Close guard ────────────────────────────────────────────────────────────
  const [showCloseGuard, setShowCloseGuard] = useState(false);

  // ── Mode-change guard ──────────────────────────────────────────────────────
  const [showModeChangeGuard, setShowModeChangeGuard] = useState(false);

  // ── Auto-save micro-indicator ──────────────────────────────────────────────
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (step === 'generate' && generatePhase === 'configure' && mode === 'season') {
      const unsub = loadCollection(league.id);
      return unsub;
    }
  }, [step, generatePhase, mode, league.id, loadCollection]);

  // ── Preview: per-fixture fallback acknowledgement ────────────────────────
  const [acknowledgedFallbacks, setAcknowledgedFallbacks] = useState<Set<number>>(new Set());

  // ── Preview: active division tab ──────────────────────────────────────────
  const [activeDivisionTab, setActiveDivisionTab] = useState<string | null>(null);

  // ── Validation errors ────────────────────────────────────────────────────────
  const [configError, setConfigError] = useState('');
  const [practiceTeamError, setPracticeTeamError] = useState('');
  const [practiceCadenceError, setPracticeCadenceError] = useState('');

  // Suppress unused-local warnings — FORMAT_OPTIONS and group/format setters are reserved
  // for the group_then_knockout and season format flows; removed from UI in games-per-team redesign
  // but kept for the generator payload and future re-introduction.
  void FORMAT_OPTIONS;
  void setFormat;
  void setGroupCount;
  void setGroupAdvance;

  // ─── Load most recent config on wizard open ──────────────────────────────────

  useEffect(() => {
    if (!open || !league.id) return;

    // initialMode prop: bypass all draft restore logic and jump straight to that mode's first step
    if (initialMode) {
      setMode(initialMode);
      setStep(getSteps(initialMode)[0]);
      return;
    }

    // No-season path (wizard opened from LeagueDetailPage): restore from league-level wizardDraft
    if (!season?.id) {
      const draft = useCollectionStore.getState().wizardDraft;
      if (draft?.mode && draft?.currentStep) {
        setMode(draft.mode);
        if (resumeAtPreview) {
          setGeneratePhase('configure');
          setRecommendationDismissed(false);
          setStep('generate');
          return;
        }
        const modeSteps = getSteps(draft.mode);
        const isResumable =
          draft.currentStep !== 'mode' &&
          draft.currentStep !== modeSteps[0] &&
          draft.currentStep !== 'preview';
        if (isResumable) {
          setResumeStep(draft.currentStep as WizardStep);
          setShowResumePrompt(true);
          return;
        }
        if (draft.currentStep === 'preview') {
          setResumeStep('preview');
          setShowResumePrompt(true);
          return;
        }
        setStep(getSteps(draft.mode)[0]);
      }
      return;
    }

    const configCol = collection(db, 'leagues', league.id, 'seasons', season.id, 'scheduleConfig');
    const q = query(configCol, orderBy('createdAt', 'desc'), limit(1));

    getDocs(q).then(snap => {
      if (snap.empty) return;
      const cfg = snap.docs[0].data() as ScheduleConfig;

      if (cfg.mode) setMode(cfg.mode);
      if (cfg.seasonStart) setSeasonStart(cfg.seasonStart);
      if (cfg.seasonEnd) setSeasonEnd(cfg.seasonEnd);
      if (cfg.matchDuration != null) setMatchDuration(String(cfg.matchDuration));
      if (cfg.bufferMinutes != null) setBufferMinutes(String(cfg.bufferMinutes));
      if (cfg.gamesPerTeam != null) setGamesPerTeam(String(cfg.gamesPerTeam));
      if (cfg.homeAwayBalance != null) setHomeAwayBalance(cfg.homeAwayBalance);
      if (cfg.format) setFormat(cfg.format as Format);
      if (cfg.playoffFormat) setPlayoffFormat(cfg.playoffFormat as Format);
      if (cfg.groupCount != null) setGroupCount(String(cfg.groupCount));
      if (cfg.groupAdvance != null) setGroupAdvance(String(cfg.groupAdvance));
      if (cfg.minRestDays != null) setMinRestDays(String(cfg.minRestDays));
      if (cfg.maxConsecAway != null) setMaxConsecAway(String(cfg.maxConsecAway));
      if (cfg.constraints?.length) setConstraints(cfg.constraints);
      if (cfg.seasonBlackouts) setSeasonBlackouts(cfg.seasonBlackouts);
      if (cfg.availabilityOption) setAvailabilityOption(cfg.availabilityOption);
      if (cfg.collectionId) setCollectionId(cfg.collectionId);

      if (cfg.venueConfigs?.length) {
        setVenueConfigs(cfg.venueConfigs.map((svc: ScheduleVenueConfig): WizardVenueConfig => {
          const surfaces: WizardSurface[] = svc.surfaces && svc.surfaces.length > 0
            ? svc.surfaces.map(s => ({ id: s.id, name: s.name, availabilityWindowsOverride: s.availabilityWindows, blackoutDatesOverride: s.blackoutDates }))
            : Array.from({ length: svc.concurrentPitches ?? 1 }, (_, idx) => ({ id: `_pitch_${idx}`, name: `Pitch ${idx + 1}` }));
          const divisionSurfacePrefs: Record<string, Array<{ surfaceId: string; preference: 'preferred' | 'required' }>> = {};
          if (cfg.divisionConfigs) {
            for (const dc of cfg.divisionConfigs) {
              const prefs = (dc.surfacePreferences ?? []).filter(p => p.venueId === (svc.venueId || ''));
              if (prefs.length > 0) {
                divisionSurfacePrefs[dc.divisionId] = prefs.map(p => ({ surfaceId: p.surfaceId, preference: p.preference }));
              }
            }
          }
          return {
            selectedVenueId: svc.venueId || null,
            name: svc.name,
            surfaces,
            availableDays: svc.availableDays ?? ['Saturday', 'Sunday'],
            availableTimeStart: svc.availableTimeStart ?? '09:00',
            availableTimeEnd: svc.availableTimeEnd ?? '17:00',
            blackoutDates: svc.blackoutDates ?? [],
            availabilityWindows: svc.availabilityWindows ?? [],
            divisionSurfacePrefs,
          };
        }));
        setVenueBlackoutInputs(cfg.venueConfigs.map(() => ''));
        setSurfaceNameInputs(cfg.venueConfigs.map(() => ''));
      }

      // resumeAtPreview prop: "Edit Draft" CTA — jump straight to generate step
      if (resumeAtPreview && cfg.mode) {
        setGeneratePhase('configure');
        setRecommendationDismissed(false);
        setStep('generate');
        return;
      }

      // Resume detection: if saved config has a currentStep beyond the first step
      if (cfg.mode && cfg.currentStep) {
        const modeSteps = getSteps(cfg.mode);
        const isResumable =
          cfg.currentStep !== 'mode' &&
          cfg.currentStep !== modeSteps[0] &&
          cfg.currentStep !== 'preview';

        if (isResumable) {
          setResumeStep(cfg.currentStep as WizardStep);
          setShowResumePrompt(true);
          return;
        }

        if (cfg.currentStep === 'preview') {
          setResumeStep('preview');
          setShowResumePrompt(true);
          return;
        }
      }

      // Normal: advance to first config step
      if (cfg.mode) {
        setStep(getSteps(cfg.mode)[0]);
      }
    }).catch(() => {
      // Non-fatal: if the query fails, default wizard state is used
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, season?.id, league.id, resumeAtPreview, initialMode]);

  // ─── Save wizard config to Firestore ────────────────────────────────────────

  function saveScheduleConfig(stepOverride?: string) {
    if (!season?.id || !league.id || !mode) return;

    const configId = crypto.randomUUID();
    const venueConfigsMapped: ScheduleVenueConfig[] = venueConfigs.map(vc => ({
      venueId: vc.selectedVenueId ?? '',
      name: vc.name,
      surfaces: vc.surfaces.map(s => ({
        id: s.id,
        name: s.name,
        ...(s.availabilityWindowsOverride?.length ? { availabilityWindows: s.availabilityWindowsOverride } : {}),
        ...(s.blackoutDatesOverride?.length ? { blackoutDates: s.blackoutDatesOverride } : {}),
      })),
      availableDays: vc.availableDays,
      availableTimeStart: vc.availableTimeStart,
      availableTimeEnd: vc.availableTimeEnd,
      availabilityWindows: vc.availabilityWindows,
      blackoutDates: vc.blackoutDates,
    }));

    const divisionConfigsMap = new Map<string, Array<{ venueId: string; surfaceId: string; preference: 'required' | 'preferred' }>>();
    for (const vc of venueConfigs) {
      const venueId = vc.selectedVenueId ?? vc.name;
      for (const [divId, prefs] of Object.entries(vc.divisionSurfacePrefs)) {
        if (!divisionConfigsMap.has(divId)) divisionConfigsMap.set(divId, []);
        for (const p of prefs) {
          divisionConfigsMap.get(divId)!.push({ venueId, surfaceId: p.surfaceId, preference: p.preference });
        }
      }
    }
    const divisionConfigs = divisionConfigsMap.size > 0
      ? Array.from(divisionConfigsMap.entries()).map(([divisionId, surfacePreferences]) => ({ divisionId, surfacePreferences }))
      : undefined;

    const cfg: ScheduleConfig = {
      id: configId,
      mode,
      seasonStart,
      seasonEnd,
      matchDuration: parseInt(matchDuration) || 60,
      bufferMinutes: parseInt(bufferMinutes) || 15,
      gamesPerTeam: parseInt(gamesPerTeam) || 10,
      homeAwayBalance,
      format,
      ...(mode === 'playoff' ? { playoffFormat } : {}),
      ...(groupCount ? { groupCount: parseInt(groupCount) || 2 } : {}),
      ...(groupAdvance ? { groupAdvance: parseInt(groupAdvance) || 2 } : {}),
      minRestDays: parseInt(minRestDays) || 6,
      maxConsecAway: parseInt(maxConsecAway) || 2,
      constraints,
      venueConfigs: venueConfigsMapped,
      ...(divisionConfigs ? { divisionConfigs } : {}),
      seasonBlackouts,
      teamIds: leagueTeams.map(t => t.id),
      availabilityOption,
      ...(collectionId ? { collectionId } : {}),
      currentStep: stepOverride ?? step,
      createdAt: new Date().toISOString(),
      createdBy: currentUserUid,
    };

    // Fire-and-forget — don't block the publish flow
    setDoc(
      doc(db, 'leagues', league.id, 'seasons', season.id, 'scheduleConfig', configId),
      cfg
    ).catch(() => {
      // Non-fatal: config save failure does not block the user
    });
  }

  // ─── Navigation ─────────────────────────────────────────────────────────────

  function resetWizard() {
    setMode(null);
    setStep('mode');
    setResult(null);
    setGenError('');
    setPublished(false);
    setConfigError('');
    setVenueErrors([]);
    setSeasonBlackouts([]);
    setBlackoutInput('');
    setGeneratePhase('configure');
    setRecommendationDismissed(false);
    setShowResumePrompt(false);
    setResumeStep(null);
    setShowResumeStartOverConfirm(false);
    setShowModeChangeGuard(false);
    setCoachConflicts([]);
    setShowConflictWarning(false);
  }

  function handleModalClose() {
    if (step === 'mode' || published || showResumePrompt) {
      onClose();
      return;
    }
    setShowCloseGuard(true);
  }

  function validateConfig(): boolean {
    if (!seasonStart || !seasonEnd) { setConfigError('Season start and end dates are required.'); return false; }
    if (seasonStart >= seasonEnd) { setConfigError('Season end must be after start date.'); return false; }
    if (!matchDuration || parseInt(matchDuration) < 10) { setConfigError('Match duration must be at least 10 minutes.'); return false; }
    if (mode === 'season') {
      const gpt = parseInt(gamesPerTeam);
      if (isNaN(gpt) || gpt < 1) { setConfigError('Games per team must be at least 1.'); return false; }
    }
    setConfigError(''); return true;
  }

  function validatePracticeTeams(): boolean {
    if (practiceTeamIds.size === 0) { setPracticeTeamError('Select at least one team.'); return false; }
    setPracticeTeamError(''); return true;
  }

  function validatePracticeCadence(): boolean {
    if (practiceTimes.length === 0) { setPracticeCadenceError('Add at least one practice time window.'); return false; }
    const invalid = practiceTimes.some(t => !t.startTime || !t.endTime || t.startTime >= t.endTime);
    if (invalid) { setPracticeCadenceError('Each time window must have a valid start and end time.'); return false; }
    if (!practiceDuration || parseInt(practiceDuration) < 15) { setPracticeCadenceError('Practice duration must be at least 15 minutes.'); return false; }
    if (!practiceSeasonStart || !practiceSeasonEnd) { setPracticeCadenceError('Season date range is required.'); return false; }
    if (practiceSeasonStart >= practiceSeasonEnd) { setPracticeCadenceError('Season end must be after start date.'); return false; }
    setPracticeCadenceError(''); return true;
  }

  function validateVenues(): boolean {
    const errs = venueConfigs.map(v => {
      if (!v.name.trim()) return 'Venue name is required.';
      if (v.surfaces.length < 1) return 'Add at least one surface.';
      if (!(v.availableDays ?? []).length) return 'Select at least one available day.';
      if (v.availableTimeStart >= v.availableTimeEnd) return 'End time must be after start time.';
      return '';
    });
    setVenueErrors(errs);
    return errs.every(e => !e);
  }

  function triggerAutoSave(nextStep: WizardStep) {
    saveScheduleConfig(nextStep);
    // Also persist to league-level wizardDraft so resume works when no season exists
    if (mode) {
      void saveWizardDraft(league.id, {
        mode,
        currentStep: nextStep,
        ...(collectionId ? { collectionId } : {}),
        stepData: {},
        createdBy: currentUserUid,
      });
    }
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  }

  function goNext() {
    if (!mode) return;
    const steps = getSteps(mode);
    const idx = steps.indexOf(step);

    if (step === 'config') { if (!validateConfig()) return; }
    if (step === 'teams') { if (!validatePracticeTeams()) return; }
    if (step === 'cadence') { if (!validatePracticeCadence()) return; }
    if (step === 'venues') { if (!validateVenues()) return; }

    if (step === 'availability') {
      void handleAvailabilityNext();
      return;
    }

    if (step === 'blackouts') {
      if (mode === 'season') {
        setGeneratePhase('configure');
        setRecommendationDismissed(false);
        setStep('generate');
        triggerAutoSave('generate');
      } else {
        handleGenerateClick();
      }
      return;
    }

    if (idx < steps.length - 1) {
      const nextStep = steps[idx + 1];
      setStep(nextStep);
      triggerAutoSave(nextStep);
    }
  }

  async function handleAvailabilityNext() {
    if (!mode) return;
    const steps = getSteps(mode);
    const idx = steps.indexOf('availability');

    if (availabilityOption === 'collect' && collectionDueDate) {
      const newCollectionId = await createCollection(league.id, collectionDueDate, currentUserUid);
      setCollectionId(newCollectionId);

      const requestAvailabilityFn = httpsCallable(getFunctions(), 'requestAvailability');
      await requestAvailabilityFn({ leagueId: league.id, collectionId: newCollectionId });

      await saveWizardDraft(league.id, {
        mode,
        currentStep: 'availability',
        collectionId: newCollectionId,
        stepData: {},
        createdBy: currentUserUid,
      });

      onClose();
      return;
    }

    // skip — advance normally
    if (idx < steps.length - 1) {
      const nextStep = steps[idx + 1];
      triggerAutoSave(nextStep);
      setStep(nextStep);
    }
  }

  function goBack() {
    if (!mode) return;
    const steps = getSteps(mode);
    const idx = steps.indexOf(step);

    if (step === 'generate' && generatePhase === 'configure') {
      const blackoutsIdx = steps.indexOf('blackouts');
      setStep(steps[blackoutsIdx]);
      return;
    }

    if (step === 'preview') {
      setResult(null);
      setGenError('');
      if (mode === 'season') {
        setGeneratePhase('configure');
        setRecommendationDismissed(false);
        setStep('generate');
      } else {
        const blackoutsIdx = steps.indexOf('blackouts');
        setStep(steps[blackoutsIdx]);
      }
      return;
    }

    if (idx === 0) {
      setShowModeChangeGuard(true);
    } else {
      setStep(steps[idx - 1]);
    }
  }

  // ─── Cross-division coach conflict detection ─────────────────────────────────

  function detectCrossDivisionConflicts(): CrossDivisionConflict[] {
    if (!divisions || divisions.length < 2) return [];

    // Build a map: coachId -> [{ teamName, divisionName }]
    const coachDivisions = new Map<string, Array<{ teamName: string; divisionName: string }>>();

    for (const div of divisions) {
      const divTeams = leagueTeams.filter(t => div.teamIds?.includes(t.id));
      for (const team of divTeams) {
        const coachIdSet = new Set<string>();
        if (team.coachId) coachIdSet.add(team.coachId);
        if (team.coachIds) team.coachIds.forEach(id => coachIdSet.add(id));

        for (const coachId of coachIdSet) {
          if (!coachDivisions.has(coachId)) coachDivisions.set(coachId, []);
          coachDivisions.get(coachId)!.push({ teamName: team.name, divisionName: div.name });
        }
      }
    }

    const conflicts: CrossDivisionConflict[] = [];
    for (const [coachId, entries] of coachDivisions.entries()) {
      const divNames = new Set(entries.map(e => e.divisionName));
      if (divNames.size > 1) {
        // Find a display name: check team's coachName field for any team where this coach is primary
        const representativeTeam = leagueTeams.find(t => t.coachId === coachId);
        const coachName = representativeTeam?.coachName ?? coachId;
        conflicts.push({ coachId, coachName, teams: entries });
      }
    }

    return conflicts;
  }

  function handleGenerateClick() {
    if (!divisions || divisions.length < 2) {
      void handleGenerate();
      return;
    }

    const conflicts = detectCrossDivisionConflicts();
    if (conflicts.length > 0) {
      setCoachConflicts(conflicts);
      setShowConflictWarning(true);
    } else {
      void handleGenerate();
    }
  }

  // ─── Generate ───────────────────────────────────────────────────────────────

  async function handleGenerate() {
    setGenerating(true);
    setGenError('');
    setResult(null);
    setGeneratePhase('running');
    setStep('generate');

    try {
      const isPractice = mode === 'practice';
      // Auto-derive format from gamesPerTeam + team count so the LM doesn't need to pick it manually.
      // single_round_robin: max gamesPerTeam = N-1; double_round_robin: max = 2*(N-1).
      const N = isPractice
        ? leagueTeams.filter(t => practiceTeamIds.has(t.id)).length
        : leagueTeams.length;
      const gpt = parseInt(gamesPerTeam) || 1;
      const derivedSeasonFormat: Format = gpt > N - 1 ? 'double_round_robin' : 'single_round_robin';
      const activeFormat = mode === 'playoff' ? playoffFormat : (mode === 'practice' ? format : derivedSeasonFormat);

      // Resolve which collection to read responses from.
      const activeCollectionId = collectionId ?? wizardDraft?.collectionId ?? null;

      let coachAvailability: CoachAvailabilityResponse[] = [];
      if (activeCollectionId) {
        const snap = await getDocs(
          collection(db, 'leagues', league.id, 'availabilityCollections', activeCollectionId, 'responses')
        );
        coachAvailability = snap.docs.map(d => d.data() as CoachAvailabilityResponse);
      }

      // Map venueConfigs to the generator payload format
      const venuesPayload = venueConfigs.map(vc => {
        // Synthesize availabilityWindows from availableDays + time fields when the
        // user configured availability via the day-picker checkboxes rather than
        // explicit RecurringVenueWindow entries. The algorithm requires at least one
        // window per venue, so an empty array will fail validateInput.
        // Note: availableDays stores names sourced from the DAYS_OF_WEEK constant
        // (day-picker UI only), so indexOf against DAY_NAMES (Sunday-first) always
        // produces a valid 0–6 integer. The filter guards against any stale persisted
        // state that might contain an unrecognized string.
        const resolvedWindows: RecurringVenueWindow[] = (vc.availabilityWindows?.length ?? 0) > 0
          ? vc.availabilityWindows
          : (vc.availableDays ?? [])
              .filter(dayName => DAY_NAMES.includes(dayName))
              .map(dayName => ({
                dayOfWeek: DAY_NAMES.indexOf(dayName),
                startTime: vc.availableTimeStart,
                endTime: vc.availableTimeEnd,
              }));
        const days = resolvedWindows.length > 0
          ? [...new Set(resolvedWindows.map(w => DAY_NAMES[w.dayOfWeek]))]
          : (vc.availableDays ?? []);
        const firstWindow = resolvedWindows[0];
        const venueId = vc.selectedVenueId ?? vc.name;
        return {
          // id is required by the algorithm for duplicate-detection; use the saved
          // venue id when available, otherwise fall back to the manual entry name.
          id: venueId,
          name: vc.name,
          surfaces: vc.surfaces.map(s => ({
            id: s.id,
            name: s.name,
            ...(s.availabilityWindowsOverride?.length ? { availabilityWindows: s.availabilityWindowsOverride } : {}),
            ...(s.blackoutDatesOverride?.length ? { blackoutDates: s.blackoutDatesOverride } : {}),
          })),
          // Keep concurrentPitches for algorithm backward compat when surfaces are empty
          concurrentPitches: vc.surfaces.length > 0 ? vc.surfaces.length : 1,
          availableDays: days,
          availableTimeStart: firstWindow?.startTime ?? vc.availableTimeStart,
          availableTimeEnd: firstWindow?.endTime ?? vc.availableTimeEnd,
          availabilityWindows: resolvedWindows,
          blackoutDates: vc.blackoutDates,
        };
      });

      // Map wizard constraint IDs to the algorithm's SoftConstraintId vocabulary,
      // preserving priority order and skipping any unknown/hard constraints.
      const WIZARD_TO_ALGO: Record<string, string> = {
        'SC-01': 'prefer_weekends',
        'SC-02': 'respect_coach_availability',
        'SC-04': 'balance_home_away',
        'SC-05': 'avoid_practice_conflicts',
        'SC-06': 'minimise_doubleheaders',
      };
      const softConstraintPriority = constraints
        .filter(c => c.type === 'soft' && c.enabled && WIZARD_TO_ALGO[c.id])
        .sort((a, b) => a.priority - b.priority)
        .map(c => WIZARD_TO_ALGO[c.id]);

      const divisionsPayload = (!isPractice && divisions && divisions.length > 0)
        ? divisions.map(div => {
            const divCfg = divisionConfigs[div.id];
            return {
              id: div.id,
              name: div.name,
              teamIds: div.teamIds,
              format: divCfg?.format ?? div.format ?? 'single_round_robin',
              gamesPerTeam: divCfg?.gamesPerTeam ?? div.gamesPerTeam ?? gpt,
              matchDurationMinutes: divCfg?.matchDurationMinutes ?? div.matchDurationMinutes ?? (parseInt(matchDuration) || 60),
              enforcement: divCfg?.coachEnforcement ?? 'soft',
              surfacePreferences: venueConfigs.flatMap(vc => {
                const venueId = vc.selectedVenueId ?? vc.name;
                const prefs = vc.divisionSurfacePrefs[div.id] ?? [];
                return prefs.map(p => ({ venueId, surfaceId: p.surfaceId, preference: p.preference }));
              }),
            };
          })
        : undefined;


      const payload: Record<string, unknown> = {
        mode: mode ?? 'season',
        leagueId: league.id,
        leagueName: league.name,
        seasonStart: isPractice ? practiceSeasonStart : seasonStart,
        seasonEnd: isPractice ? practiceSeasonEnd : seasonEnd,
        matchDurationMinutes: parseInt(isPractice ? practiceDuration : matchDuration) || (isPractice ? 90 : 60),
        bufferMinutes: isPractice ? 0 : (parseInt(bufferMinutes) || 15),
        format: isPractice ? 'practice' : activeFormat,
        teams: isPractice
          ? leagueTeams
              .filter(t => practiceTeamIds.has(t.id))
              .map(t => ({ id: t.id, name: t.name }))
          : leagueTeams.map(t => ({
              id: t.id,
              name: t.name,
              homeVenue: venuesPayload.length === 1 ? venuesPayload[0].name : undefined,
              ...(useHomeVenues && t.homeVenueId ? { homeVenueId: t.homeVenueId } : {}),
            })),
        venues: venuesPayload,
        blackoutDates: seasonBlackouts,
        softConstraintPriority,
        homeAwayMode: homeAwayBalance ? 'strict' : 'relaxed',
        ...(useHomeVenues ? { homeVenueEnforcement: 'soft' } : {}),
        coachAvailability,
        ...(divisionsPayload ? { divisions: divisionsPayload } : {}),
        ...(isPractice
          ? {
              practiceTimeWindows: practiceTimes,
              practiceMaxPerWeek: parseInt(practiceMaxPerWeek) || 2,
            }
          : {
              gamesPerTeam: gpt,
              minRestDays: parseInt(minRestDays) || 6,
              maxConsecutiveAway: parseInt(maxConsecAway) || 2,
              ...(activeFormat === 'group_then_knockout'
                ? { groupCount: parseInt(groupCount) || 2, groupAdvance: parseInt(groupAdvance) || 2 }
                : {}),
            }),
      };

      const { data } = await generateScheduleFn(payload);
      setResult(data);
      setAcknowledgedFallbacks(new Set());
      setActiveDivisionTab(data.divisionResults?.[0]?.divisionId ?? null);
      setStep('preview');
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Schedule generation failed.';
      setGenError(msg);
    } finally {
      setGenerating(false);
    }
  }

  // ─── Publish ────────────────────────────────────────────────────────────────

  async function handlePublish() {
    if (!result || !mode) return;
    setPublishing(true);
    const now = new Date().toISOString();
    const durationMins = parseInt(mode === 'practice' ? practiceDuration : matchDuration) || (mode === 'practice' ? 90 : 60);
    // Auto field assignment: round-robin across fields per venue+date+time slot
    const fieldSlotCounter = new Map<string, number>();

    try {
      await Promise.all(
        result.fixtures.map(fixture => {
          const endTime = fixture.endTime || (() => {
            const [h, m] = fixture.startTime.split(':').map(Number);
            const endMins = h * 60 + m + durationMins;
            return `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;
          })();

          const isPracticeFixture = fixture.awayTeamId === '';

          // Attach venue library fields if matched (searches league pool first, then personal)
          const fixtureName = fixture.venueName ?? fixture.venue ?? '';
          const matchedConfig = venueConfigs.find(vc => vc.name === fixtureName);
          const venueFields = matchedConfig?.selectedVenueId ? (() => {
            const selectedVenue = resolveVenue(matchedConfig.selectedVenueId);
            const slotKey = `${matchedConfig.selectedVenueId}|${fixture.date}|${fixture.startTime}`;
            const slotIdx = fieldSlotCounter.get(slotKey) ?? 0;
            fieldSlotCounter.set(slotKey, slotIdx + 1);
            const assignedField = selectedVenue?.fields && selectedVenue.fields.length > 1
              ? selectedVenue.fields[slotIdx % selectedVenue.fields.length]
              : undefined;
            return {
              venueId: matchedConfig.selectedVenueId,
              ...(selectedVenue?.lat != null && selectedVenue?.lng != null ? {
                venueLat: selectedVenue.lat,
                venueLng: selectedVenue.lng,
              } : {}),
              ...(assignedField ? { fieldId: assignedField.id, fieldName: assignedField.name } : {}),
            };
          })() : {};

          const event: ScheduledEvent = isPracticeFixture
            ? {
                id: crypto.randomUUID(),
                title: `${fixture.homeTeamName} Practice`,
                type: 'practice',
                status: 'scheduled',
                date: fixture.date,
                startTime: fixture.startTime,
                endTime,
                duration: durationMins,
                location: fixtureName,
                teamIds: [fixture.homeTeamId],
                isRecurring: false,
                notes: fixture.stage ? fixture.stage : undefined,
                createdAt: now,
                updatedAt: now,
                ...venueFields,
                leagueId: league.id,
                ...(season?.id ? { seasonId: season.id } : {}),
              }
            : {
                id: crypto.randomUUID(),
                title: `${fixture.homeTeamName} vs ${fixture.awayTeamName}`,
                type: 'game',
                status: 'scheduled',
                date: fixture.date,
                startTime: fixture.startTime,
                endTime,
                duration: durationMins,
                location: fixtureName,
                homeTeamId: fixture.homeTeamId,
                awayTeamId: fixture.awayTeamId,
                teamIds: [fixture.homeTeamId, fixture.awayTeamId],
                isRecurring: false,
                notes: fixture.stage || undefined,
                createdAt: now,
                updatedAt: now,
                ...venueFields,
                leagueId: league.id,
                ...(season?.id ? { seasonId: season.id } : {}),
              };

          return addEvent(event);
        })
      );
      setPublished(true);
      saveScheduleConfig();
    } catch (err) {
      console.error('handlePublish failed:', err);
      setGenError('Failed to publish some events. Please check the schedule and try again.');
    } finally {
      setPublishing(false);
    }
  }

  // ─── Save/publish fixtures (season & playoff) ────────────────────────────────

  async function saveFixtures(publishNow: boolean) {
    if (!result) return;
    // A5: Cannot publish without a season context — show error instead of silent draft
    if (publishNow && !season?.id) {
      setGenError('A season is required to publish. Save as draft instead, then publish from the Season Dashboard.');
      return;
    }
    setPublishing(true);
    const now = new Date().toISOString();
    // Auto field assignment: round-robin across fields per venue+date+time slot
    const fieldSlotCounter = new Map<string, number>();
    try {
      // Clear stale draft events for this season/division before saving new ones
      if (season?.id) {
        const staleSnap = await getDocs(
          query(
            collection(db, 'events'),
            where('seasonId', '==', season.id),
            where('status', '==', 'draft'),
          )
        );
        if (!staleSnap.empty) {
          const divIds = result.divisionResults && result.divisionResults.length > 0
            ? new Set(result.divisionResults.map(dr => dr.divisionId))
            : divisionId ? new Set([divisionId]) : null;
          const toDelete = divIds
            ? staleSnap.docs.filter(d => divIds.has(d.data().divisionId as string))
            : staleSnap.docs;
          if (toDelete.length > 0) {
            await Promise.all(toDelete.map(d => deleteDoc(d.ref)));
          }
        }
      }
      // SEC-15: Always save events as draft. The transition to 'scheduled' is
      // handled exclusively by the publishSchedule Cloud Function, which
      // enforces server-side league-manager ownership and validation.
      await Promise.all(
        result.fixtures.map(fixture => {
          const durationMins = parseInt(matchDuration) || 60;
          const [h, m] = fixture.startTime.split(':').map(Number);
          const endMinutes = h * 60 + m + durationMins;
          const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
          const fixtureName = fixture.venueName ?? fixture.venue ?? '';
          const matchedConfig = venueConfigs.find(vc => vc.name === fixtureName);
          const venueFields = matchedConfig?.selectedVenueId ? (() => {
            const selectedVenue = resolveVenue(matchedConfig.selectedVenueId);
            const slotKey = `${matchedConfig.selectedVenueId}|${fixture.date}|${fixture.startTime}`;
            const slotIdx = fieldSlotCounter.get(slotKey) ?? 0;
            fieldSlotCounter.set(slotKey, slotIdx + 1);
            const assignedField = selectedVenue?.fields && selectedVenue.fields.length > 1
              ? selectedVenue.fields[slotIdx % selectedVenue.fields.length]
              : undefined;
            return {
              venueId: matchedConfig.selectedVenueId,
              ...(selectedVenue?.lat != null && selectedVenue?.lng != null ? {
                venueLat: selectedVenue.lat,
                venueLng: selectedVenue.lng,
              } : {}),
              ...(assignedField ? { fieldId: assignedField.id, fieldName: assignedField.name } : {}),
            };
          })() : {};
          const event: ScheduledEvent = {
            id: crypto.randomUUID(),
            title: `${fixture.homeTeamName} vs ${fixture.awayTeamName}`,
            type: 'game',
            status: 'draft',
            date: fixture.date,
            startTime: fixture.startTime,
            endTime,
            duration: durationMins,
            location: fixtureName,
            homeTeamId: fixture.homeTeamId,
            awayTeamId: fixture.awayTeamId,
            teamIds: [fixture.homeTeamId, fixture.awayTeamId],
            isRecurring: false,
            notes: fixture.stage || undefined,
            createdAt: now,
            updatedAt: now,
            ...venueFields,
            leagueId: league.id,
            ...(season?.id ? { seasonId: season.id } : {}),
            ...(fixture.divisionId ? { divisionId: fixture.divisionId } : divisionId ? { divisionId } : {}),
          };
          return addEvent(event);
        })
      );

      // If "Publish Now" was requested, call the server-side publishSchedule
      // callable to atomically transition draft events to scheduled.
      if (publishNow && season?.id && league?.id) {
        if (result.divisionResults && result.divisionResults.length > 0) {
          await Promise.all(result.divisionResults.map(dr =>
            publishScheduleFn({ leagueId: league.id, seasonId: season.id, divisionId: dr.divisionId })
          ));
        } else {
          await publishScheduleFn({
            leagueId: league.id,
            seasonId: season.id,
            ...(divisionId ? { divisionId } : {}),
          });
        }
      } else if (!publishNow && season?.id) {
        // Mark division(s) as having a draft schedule so the dashboard CTA updates.
        if (result.divisionResults && result.divisionResults.length > 0) {
          await Promise.all(result.divisionResults.map(dr =>
            updateDoc(
              doc(db, 'leagues', league.id, 'divisions', dr.divisionId),
              {
                scheduleStatus: 'draft',
                unscheduledCount: dr.unassignedCount ?? 0,
                updatedAt: now,
              }
            )
          ));
        } else if (divisionId) {
          await updateDoc(
            doc(db, 'leagues', league.id, 'divisions', divisionId),
            {
              scheduleStatus: 'draft',
              unscheduledCount: result?.stats.unassignedFixtures ?? 0,
              updatedAt: now,
            }
          );
        }
      }

      setPublished(true);
      setPublishedAsDraft(!publishNow);
      saveScheduleConfig();
      // Clear league-level wizardDraft — draft games are now persisted in Firestore
      clearWizardDraft(league.id).catch(err => console.error('[saveFixtures] clearWizardDraft failed:', err));
    } catch (err) {
      console.error('saveFixtures failed:', err);
      setGenError('Failed to save some events. Please check the schedule and try again.');
    } finally {
      setPublishing(false);
    }
  }

  // ─── Venue config helpers ────────────────────────────────────────────────────

  function updateVenueConfig(i: number, patch: Partial<WizardVenueConfig>) {
    setVenueConfigs(vs => vs.map((v, idx) => idx === i ? { ...v, ...patch } : v));
  }

  function toggleDay(i: number, day: string) {
    setVenueConfigs(vs => vs.map((v, idx) => {
      if (idx !== i) return v;
      const days = v.availableDays.includes(day)
        ? v.availableDays.filter(d => d !== day)
        : [...v.availableDays, day];
      return { ...v, availableDays: days };
    }));
  }

  function addVenueBlackout(i: number, date: string) {
    if (!date) return;
    setVenueConfigs(vs => vs.map((v, idx) =>
      idx === i && !v.blackoutDates.includes(date)
        ? { ...v, blackoutDates: [...v.blackoutDates, date].sort() }
        : v
    ));
  }

  function removeVenueBlackout(i: number, date: string) {
    setVenueConfigs(vs => vs.map((v, idx) =>
      idx === i ? { ...v, blackoutDates: v.blackoutDates.filter(d => d !== date) } : v
    ));
  }

  function selectSavedVenue(i: number, venue: Venue) {
    setVenueConfigs(vs => vs.map((v, idx) =>
      idx === i ? { ...v, ...venueConfigFromSaved(venue) } : v
    ));
  }

  function openQuickCreate(i: number) {
    setQuickCreateTargetIdx(i);
    setQuickCreateOpen(true);
  }

  function handleQuickCreated(venue: Venue) {
    setQuickCreateOpen(false);
    if (quickCreateTargetIdx !== null) {
      selectSavedVenue(quickCreateTargetIdx, venue);
      setQuickCreateTargetIdx(null);
    }
  }

  function addVenueCard() {
    setVenueConfigs(vs => [...vs, newVenueConfig()]);
    setVenueBlackoutInputs(bi => [...bi, '']);
    setSurfaceNameInputs(si => [...si, '']);
  }

  function removeVenueCard(i: number) {
    setVenueConfigs(vs => vs.filter((_, idx) => idx !== i));
    setVenueBlackoutInputs(bi => bi.filter((_, idx) => idx !== i));
    setSurfaceNameInputs(si => si.filter((_, idx) => idx !== i));
    setVenueAdvancedOpen(prev => {
      const next = new Set<number>();
      for (const idx of prev) {
        if (idx < i) next.add(idx);
        else if (idx > i) next.add(idx - 1);
      }
      return next;
    });
  }

  // ─── Practice cadence helpers ────────────────────────────────────────────────

  function addPracticeWindow() {
    setPracticeTimes(ts => [...ts, { dayOfWeek: 2, startTime: '18:00', endTime: '20:00' }]);
  }

  function updatePracticeWindow(i: number, patch: Partial<RecurringVenueWindow>) {
    setPracticeTimes(ts => ts.map((t, idx) => idx === i ? { ...t, ...patch } : t));
  }

  function removePracticeWindow(i: number) {
    setPracticeTimes(ts => ts.filter((_, idx) => idx !== i));
  }

  // ─── Constraint drag-to-reorder ─────────────────────────────────────────────

  function onDragStart(i: number) {
    dragIdx.current = i;
  }

  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    const from = dragIdx.current;
    if (from === null || from === i) return;
    setConstraints(cs => {
      const next = [...cs];
      const [moved] = next.splice(from, 1);
      next.splice(i, 0, moved);
      // Re-assign priorities
      return next.map((c, idx) => ({ ...c, priority: idx + 1 }));
    });
    dragIdx.current = i;
  }

  function toggleConstraint(id: string) {
    setConstraints(cs => cs.map(c => c.id === id ? { ...c, enabled: !c.enabled } : c));
  }

  // ─── Computed ────────────────────────────────────────────────────────────────

  const resolvedCollectionId = collectionId ?? wizardDraft?.collectionId ?? null;

  const teamNameById = useMemo<Record<string, string>>(
    () => Object.fromEntries(leagueTeams.map(t => [t.id, t.name])),
    [leagueTeams],
  );
  const allTeamIds = useMemo(() => leagueTeams.map(t => t.id), [leagueTeams]);

  const topSlots = useMemo(
    () => getTopCoverageSlots(responses, allTeamIds, teamNameById, 2),
    [responses, allTeamIds, teamNameById],
  );

  const hasResponses = activeCollection !== null && responses.length > 0;

  const recommendedWindow = useMemo(() => {
    if (!seasonStart || !seasonEnd) return null;
    return { start: seasonStart, end: seasonEnd };
  }, [seasonStart, seasonEnd]);

  const HOME_VENUE_CONSTRAINT_IDS = new Set(['no_home_venue', 'home_venue_mismatch']);
  const visibleConflicts = result?.conflicts.filter(
    c => useHomeVenues || !HOME_VENUE_CONSTRAINT_IDS.has(c.constraintId ?? '')
  ) ?? [];
  const hardConflicts = visibleConflicts.filter(c => c.severity === 'hard');
  const softConflicts = visibleConflicts.filter(c => c.severity === 'soft');
  const fallbackFixtures = result?.fallbackFixtures ?? [];
  const allFallbacksAcknowledged = fallbackFixtures.length === 0 || fallbackFixtures.every((_, i) => acknowledgedFallbacks.has(i));
  const canPublish = result && hardConflicts.length === 0 && allFallbacksAcknowledged;

  const currentSteps = mode ? getSteps(mode) : [];
  const currentStepIdx = currentSteps.indexOf(step);
  const visibleSteps = currentSteps.filter(s => s !== 'generate');
  const isPracticeMode = mode === 'practice';

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <Modal open={open} onClose={handleModalClose} title="Schedule Wizard" size="lg" fixedHeight>

        {/* ── Scrollable step content ──────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto py-4">

        {/* Progress indicator */}
        {mode && step !== 'mode' && (
          <div className="mb-5 -mt-1">
            <div className="flex items-center gap-1">
              {visibleSteps.map((s, idx) => {
                const realIdx = currentSteps.indexOf(s);
                const isDone = currentStepIdx > realIdx;
                const isActive = s === step || (step === 'generate' && s === 'blackouts');
                return (
                  <div key={s} className="flex items-center gap-1 flex-1">
                    <div className={`h-1.5 flex-1 rounded-full transition-colors ${isDone ? 'bg-blue-600' : isActive ? 'bg-blue-400' : 'bg-gray-200'}`} />
                    {idx < visibleSteps.length - 1 && (
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isDone ? 'bg-blue-600' : isActive ? 'bg-blue-400' : 'bg-gray-300'}`} />
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 mt-1.5 text-right">
              Step {currentStepIdx + 1} of {currentSteps.length} — {STEP_LABELS[step]}
            </p>
          </div>
        )}

        {/* ── Resume interstitial ─────────────────────────────────────────────── */}
        {showResumePrompt && (
          <div className="flex flex-col items-center justify-center py-8 gap-6">
            <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
              <div>
                <p className="text-base font-semibold text-gray-900">Continue where you left off?</p>
                {resumeStep === 'preview' ? (
                  <p className="text-sm text-gray-600 mt-1">
                    Your configuration is saved. The generated schedule will need to be re-run (~30 seconds).
                  </p>
                ) : (
                  <p className="text-sm text-gray-600 mt-1">
                    You have an in-progress <strong>{mode}</strong> schedule configured up
                    to <strong>{resumeStep ? STEP_LABELS[resumeStep] : ''}</strong>.
                  </p>
                )}
              </div>
              {showResumeStartOverConfirm ? (
                <div className="space-y-3">
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    This will clear your saved configuration. Are you sure?
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        void clearWizardDraft(league.id);
                        resetWizard();
                      }}
                    >
                      Yes, start over
                    </Button>
                    <Button variant="secondary" onClick={() => setShowResumeStartOverConfirm(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      setShowResumePrompt(false);
                      if (resumeStep === 'preview') {
                        setGeneratePhase('configure');
                        setRecommendationDismissed(false);
                        setStep('generate');
                      } else if (resumeStep) {
                        setStep(resumeStep);
                      }
                    }}
                  >
                    {resumeStep === 'preview' ? 'Re-generate and Continue' : 'Continue'}
                  </Button>
                  <Button variant="secondary" onClick={() => setShowResumeStartOverConfirm(true)}>
                    Start Over
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Close guard ─────────────────────────────────────────────────────── */}
        {showCloseGuard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
              <p className="text-base font-semibold text-gray-900">Leave wizard?</p>
              <p className="text-sm text-gray-600">
                Your progress is saved. Return to this schedule via "Continue Schedule" on the league page.
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" onClick={() => setShowCloseGuard(false)}>Keep Editing</Button>
                <Button onClick={() => { setShowCloseGuard(false); onClose(); }}>Close Wizard</Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Mode-change guard ────────────────────────────────────────────────── */}
        {showModeChangeGuard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
              <p className="text-base font-semibold text-gray-900">Change schedule mode?</p>
              <p className="text-sm text-gray-600">
                Changing mode will clear your current configuration. Continue?
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" onClick={() => setShowModeChangeGuard(false)}>Keep Current Mode</Button>
                <Button
                  onClick={() => {
                    setShowModeChangeGuard(false);
                    resetWizard();
                  }}
                >
                  Change Mode
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Mode picker ─────────────────────────────────────────────────────── */}
        {!showResumePrompt && step === 'mode' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">What would you like to schedule?</p>
            {(
              [
                { m: 'season' as WizardMode, icon: <Calendar size={22} className="text-blue-500" />, label: 'Season', desc: 'Full round-robin or group+knockout schedule for all league teams' },
                { m: 'practice' as WizardMode, icon: <Dumbbell size={22} className="text-green-500" />, label: 'Practice', desc: 'Recurring practice sessions for one or more teams' },
                { m: 'playoff' as WizardMode, icon: <Trophy size={22} className="text-amber-500" />, label: 'Playoff / Tournament', desc: 'Single or double elimination bracket from seeded teams' },
              ] as { m: WizardMode; icon: React.ReactNode; label: string; desc: string }[]
            ).map(({ m, icon, label, desc }) => (
              <button
                key={m}
                onClick={() => { setMode(m); setStep(getSteps(m)[0]); }}
                className="w-full flex items-start gap-4 p-4 border-2 border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-colors text-left"
              >
                <div className="flex-shrink-0 mt-0.5">{icon}</div>
                <div>
                  <p className="font-semibold text-gray-900">{label}</p>
                  <p className="text-sm text-gray-500 mt-0.5">{desc}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── Season / Playoff Config ──────────────────────────────────────────── */}
        {step === 'config' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Season Start" type="date" value={seasonStart} onChange={e => setSeasonStart(e.target.value)} />
              <Input label="Season End" type="date" value={seasonEnd} onChange={e => setSeasonEnd(e.target.value)} />
            </div>
            {/* Buffer Between Games — always global */}
            {!(divisions && divisions.length > 0) && (
              <div className="grid grid-cols-2 gap-3">
                <Input label="Match Duration (min)" type="number" min="10" value={matchDuration} onChange={e => setMatchDuration(e.target.value)} />
                <Input label="Buffer Between Games (min)" type="number" min="0" value={bufferMinutes} onChange={e => setBufferMinutes(e.target.value)} />
              </div>
            )}
            {divisions && divisions.length > 0 && (
              <Input label="Buffer Between Games (min)" type="number" min="0" value={bufferMinutes} onChange={e => setBufferMinutes(e.target.value)} />
            )}
            {mode === 'season' && divisions && divisions.length > 0 && (
              <>
                {/* Per-division config grid */}
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Division Settings</p>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Division</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Format</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Games / Team</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Duration (min)</th>
                          {resolvedCollectionId && (
                            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Coach Availability</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {divisions.map((div, idx) => {
                          const cfg = divisionConfigs[div.id] ?? {
                            format: 'single_round_robin',
                            gamesPerTeam: season?.gamesPerTeam ?? 8,
                            matchDurationMinutes: 60,
                            coachEnforcement: 'soft' as const,
                          };
                          return (
                            <tr key={div.id} className={`border-b border-gray-100 last:border-0 ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}>
                              <td className="px-3 py-2 text-sm text-gray-800 font-medium whitespace-nowrap">{div.name}</td>
                              <td className="px-3 py-2">
                                <select
                                  value={cfg.format}
                                  onChange={e => setDivisionConfigs(prev => ({
                                    ...prev,
                                    [div.id]: { ...cfg, format: e.target.value },
                                  }))}
                                  className="text-sm border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                  aria-label={`Format for ${div.name}`}
                                >
                                  <option value="single_round_robin">Round Robin</option>
                                  <option value="double_round_robin">Double Round Robin</option>
                                  <option value="playoff">Playoff</option>
                                </select>
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  min="1"
                                  max="100"
                                  value={cfg.gamesPerTeam}
                                  onChange={e => setDivisionConfigs(prev => ({
                                    ...prev,
                                    [div.id]: { ...cfg, gamesPerTeam: parseInt(e.target.value) || 1 },
                                  }))}
                                  className="w-16 text-sm border border-gray-300 rounded px-2 py-1 text-center focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                  aria-label={`Games per team for ${div.name}`}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  min="10"
                                  value={cfg.matchDurationMinutes}
                                  onChange={e => setDivisionConfigs(prev => ({
                                    ...prev,
                                    [div.id]: { ...cfg, matchDurationMinutes: parseInt(e.target.value) || 60 },
                                  }))}
                                  className="w-16 text-sm border border-gray-300 rounded px-2 py-1 text-center focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                  aria-label={`Match duration for ${div.name}`}
                                />
                              </td>
                              {resolvedCollectionId && (
                                <td className="px-3 py-2">
                                  <select
                                    value={cfg.coachEnforcement}
                                    onChange={e => setDivisionConfigs(prev => ({
                                      ...prev,
                                      [div.id]: { ...cfg, coachEnforcement: e.target.value as 'soft' | 'hard' },
                                    }))}
                                    className="text-sm border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                    aria-label={`Coach availability enforcement for ${div.name}`}
                                  >
                                    <option value="soft">Soft</option>
                                    <option value="hard">Hard</option>
                                  </select>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                {resolvedCollectionId && (
                  <p className="text-xs text-gray-400 mt-2 px-1">
                    Coach availability: <strong>Soft</strong> — algorithm tries to honor preferences, may schedule around them. <strong>Hard</strong> — unavailable slots are blackouts; games will not be placed there.
                  </p>
                )}
              </>
            )}
            {mode === 'season' && !(divisions && divisions.length > 0) && (
              <>
                <Input
                  label="Games Per Team"
                  type="number"
                  min="1"
                  max="100"
                  value={gamesPerTeam}
                  onChange={e => setGamesPerTeam(e.target.value)}
                />
                <p className="text-xs text-gray-500 -mt-2">How many games should each team play this season?</p>

                {/* Neutral info block — game count summary */}
                {(() => {
                  const gpt = parseInt(gamesPerTeam);
                  const teamCount = leagueTeams.length;
                  if (!isNaN(gpt) && gpt > 0 && teamCount >= 2) {
                    const total = Math.ceil((gpt * teamCount) / 2);
                    return (
                      <div className="flex items-start gap-2 text-xs bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-blue-800">
                        <span>
                          With {teamCount} teams and {gpt} games per team, <strong>{total} total games</strong> will be scheduled.
                        </span>
                      </div>
                    );
                  }
                  return null;
                })()}

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={homeAwayBalance}
                    onChange={e => setHomeAwayBalance(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700">Home/Away Balance</span>
                    <p className="text-xs text-gray-500 mt-0.5">Distribute home and away games evenly across teams.</p>
                    {homeAwayBalance && parseInt(gamesPerTeam) > leagueTeams.length - 1 && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        When a pair meets more than once, home and away alternate.
                      </p>
                    )}
                  </div>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useHomeVenues}
                    onChange={e => setUseHomeVenues(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700">Respect Team Home Venues</span>
                    <p className="text-xs text-gray-500 mt-0.5">Schedule home games at each team's configured home venue when possible.</p>
                    {useHomeVenues && (() => {
                      const teamsWithoutHomeVenue = leagueTeams.filter(t => !t.homeVenueId);
                      return teamsWithoutHomeVenue.length > 0 ? (
                        <p className="text-xs text-amber-600 mt-0.5">
                          {teamsWithoutHomeVenue.length} team{teamsWithoutHomeVenue.length !== 1 ? 's' : ''} without a home venue: {teamsWithoutHomeVenue.map(t => t.name).join(', ')}
                        </p>
                      ) : null;
                    })()}
                  </div>
                </label>

                {/* Season continuity note */}
                {season?.priorSeasonId && (
                  <div className="flex items-start gap-2 text-xs bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-blue-800">
                    <Users size={13} className="flex-shrink-0 mt-0.5" />
                    <span>Season-to-season randomization is enabled — opponent sequence will vary from last season.</span>
                  </div>
                )}

                {/* About game distribution expander */}
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setDistributionExpanded(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <span className="font-medium">How does the scheduler distribute games?</span>
                    <ChevronDown size={14} className={`text-gray-400 transition-transform ${distributionExpanded ? 'rotate-180' : ''}`} />
                  </button>
                  {distributionExpanded && (
                    <div className="px-3 pb-3 pt-1 text-xs text-gray-600 border-t border-gray-100 bg-gray-50">
                      <p>
                        Games are distributed as evenly as possible across your available dates and venues.
                        Each team plays {gamesPerTeam || 'N'} games.
                        {leagueTeams.length > 0 && parseInt(gamesPerTeam) > leagueTeams.length - 1 && (
                          <> With {leagueTeams.length} teams, some pairs may meet more than once — this is normal when your game count is higher than the number of unique matchups available. Home and away assignments rotate across repeated meetings.</>
                        )}
                      </p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input label="Min Rest Days Between Games" type="number" min="0" value={minRestDays} onChange={e => setMinRestDays(e.target.value)} />
                  <Input label="Max Consecutive Away Games" type="number" min="1" value={maxConsecAway} onChange={e => setMaxConsecAway(e.target.value)} />
                </div>
              </>
            )}
            {mode === 'playoff' && (
              <>
                <Select label="Format" value={playoffFormat} onChange={e => setPlayoffFormat(e.target.value as Format)} options={PLAYOFF_FORMAT_OPTIONS} />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Min Rest Days Between Games" type="number" min="0" value={minRestDays} onChange={e => setMinRestDays(e.target.value)} />
                  <Input label="Max Consecutive Away Games" type="number" min="1" value={maxConsecAway} onChange={e => setMaxConsecAway(e.target.value)} />
                </div>
              </>
            )}
            <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700 flex items-start gap-2">
              <Users size={15} className="flex-shrink-0 mt-0.5" />
              <span>{leagueTeams.length} team{leagueTeams.length !== 1 ? 's' : ''}: {leagueTeams.map(t => t.name).join(', ')}</span>
            </div>
            {configError && <p className="text-xs text-red-600">{configError}</p>}
          </div>
        )}

        {/* ── Practice: Teams ─────────────────────────────────────────────────── */}
        {step === 'teams' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">Select which teams to schedule practices for.</p>
            <div className="border border-gray-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
              {leagueTeams.map(team => (
                <label key={team.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-0">
                  <input
                    type="checkbox"
                    checked={practiceTeamIds.has(team.id)}
                    onChange={() => {
                      setPracticeTeamIds(prev => {
                        const next = new Set(prev);
                        next.has(team.id) ? next.delete(team.id) : next.add(team.id);
                        return next;
                      });
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: team.color }} />
                  <span className="text-sm text-gray-800">{team.name}</span>
                </label>
              ))}
            </div>
            {leagueTeams.length > 1 && (
              <button
                className="text-xs text-blue-600 hover:underline"
                onClick={() => {
                  if (practiceTeamIds.size === leagueTeams.length) {
                    setPracticeTeamIds(new Set());
                  } else {
                    setPracticeTeamIds(new Set(leagueTeams.map(t => t.id)));
                  }
                }}
              >
                {practiceTeamIds.size === leagueTeams.length ? 'Deselect all' : 'Select all'}
              </button>
            )}
            {practiceTeamError && <p className="text-xs text-red-600">{practiceTeamError}</p>}
          </div>
        )}

        {/* ── Practice: Cadence ───────────────────────────────────────────────── */}
        {step === 'cadence' && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Practice Days & Times</p>
              <p className="text-xs text-gray-500 mb-3">Define when practices can be scheduled. Add one row per day/time combination.</p>
              <div className="space-y-2">
                {practiceTimes.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select
                      value={String(t.dayOfWeek)}
                      onChange={e => updatePracticeWindow(i, { dayOfWeek: parseInt(e.target.value) })}
                      options={DAY_OPTIONS}
                    />
                    <Input type="time" value={t.startTime} onChange={e => updatePracticeWindow(i, { startTime: e.target.value })} />
                    <span className="text-gray-400 text-sm flex-shrink-0">–</span>
                    <Input type="time" value={t.endTime} onChange={e => updatePracticeWindow(i, { endTime: e.target.value })} />
                    {practiceTimes.length > 1 && (
                      <button onClick={() => removePracticeWindow(i)} className="text-gray-400 hover:text-red-500 flex-shrink-0">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={addPracticeWindow} className="mt-2 text-xs text-blue-600 hover:underline flex items-center gap-1">
                <Plus size={12} /> Add another day/time
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Session Duration (min)" type="number" min="15" value={practiceDuration} onChange={e => setPracticeDuration(e.target.value)} />
              <Input label="Max Sessions / Week / Team" type="number" min="1" max="7" value={practiceMaxPerWeek} onChange={e => setPracticeMaxPerWeek(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Season Start" type="date" value={practiceSeasonStart} onChange={e => setPracticeSeasonStart(e.target.value)} />
              <Input label="Season End" type="date" value={practiceSeasonEnd} onChange={e => setPracticeSeasonEnd(e.target.value)} />
            </div>
            {practiceCadenceError && <p className="text-xs text-red-600">{practiceCadenceError}</p>}
          </div>
        )}

        {/* ── Venues ──────────────────────────────────────────────────────────── */}
        {step === 'venues' && (
          <div className="space-y-4">
            {/* Slot coverage progress bar */}
            {(() => {
              const gpt = parseInt(gamesPerTeam);
              const requiredSlots = Math.ceil((gpt * leagueTeams.length) / 2);
              // Estimate available slots from configured venue windows
              const availableSlots = venueConfigs.reduce((total, vc) => {
                if (!seasonStart || !seasonEnd) return total;
                const startMs = new Date(seasonStart).getTime();
                const endMs = new Date(seasonEnd).getTime();
                const weeks = Math.max(1, Math.floor((endMs - startMs) / (7 * 24 * 60 * 60 * 1000)));
                const surfaceCount = vc.surfaces.length > 0 ? vc.surfaces.length : 1;
                const windows = vc.availabilityWindows;
                if (windows.length > 0) {
                  for (const w of windows) {
                    const startMins = parseInt(w.startTime.split(':')[0]) * 60 + parseInt(w.startTime.split(':')[1]);
                    const endMins = parseInt(w.endTime.split(':')[0]) * 60 + parseInt(w.endTime.split(':')[1]);
                    const slotDuration = Math.max(parseInt(matchDuration) + parseInt(bufferMinutes), 30);
                    const slotsPerDay = Math.floor((endMins - startMins) / slotDuration);
                    total += slotsPerDay * surfaceCount * weeks;
                  }
                } else {
                  const dayCount = vc.availableDays.length;
                  const startMins = parseInt(vc.availableTimeStart.split(':')[0]) * 60 + parseInt(vc.availableTimeStart.split(':')[1]);
                  const endMins = parseInt(vc.availableTimeEnd.split(':')[0]) * 60 + parseInt(vc.availableTimeEnd.split(':')[1]);
                  const slotDuration = Math.max(parseInt(matchDuration) + parseInt(bufferMinutes), 30);
                  const slotsPerDay = Math.floor((endMins - startMins) / slotDuration);
                  total += slotsPerDay * surfaceCount * dayCount * weeks;
                }
                return total;
              }, 0);

              if (requiredSlots === 0) return null;
              const pct = Math.min(100, Math.round((availableSlots / requiredSlots) * 100));
              const barColor = pct >= 100 ? 'bg-green-500' : pct >= 75 ? 'bg-amber-400' : 'bg-red-500';
              const labelColor = pct >= 100 ? 'text-green-700' : pct >= 75 ? 'text-amber-700' : 'text-red-700';
              return (
                <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-gray-700">Slot coverage</span>
                    <span className={`font-medium ${labelColor}`}>{availableSlots} of {requiredSlots} required slots covered</span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })()}

            {venueConfigs.map((venueConfig, i) => (
              <div key={i} className="border border-gray-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                    <MapPin size={13} /> Venue {i + 1}
                  </h4>
                  {venueConfigs.length > 1 && (
                    <button onClick={() => removeVenueCard(i)} className="text-gray-400 hover:text-red-500 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                {/* Searchable combobox */}
                <VenueCombobox
                  venueConfig={venueConfig}
                  savedVenues={savedVenues}
                  leagueVenues={leagueVenues}
                  onSelectSaved={venue => selectSavedVenue(i, venue)}
                  onCreateNew={() => openQuickCreate(i)}
                />

                {/* Editable detail fields */}
                <Input
                  label="Venue Name"
                  value={venueConfig.name}
                  onChange={e => updateVenueConfig(i, { name: e.target.value, selectedVenueId: null })}
                  placeholder="e.g. Riverside Park"
                  error={venueErrors[i]}
                />

                {/* Named surfaces */}
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1.5">{isPracticeMode ? 'Courts / Areas' : 'Surfaces / Fields'}</p>
                  {venueConfig.surfaces.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {venueConfig.surfaces.map(s => (
                        <span key={s.id} className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-1 font-medium">
                          {s.name}
                          <button
                            type="button"
                            aria-label={`Remove ${s.name}`}
                            onClick={() => updateVenueConfig(i, { surfaces: venueConfig.surfaces.filter(x => x.id !== s.id) })}
                            className="hover:text-blue-900 ml-0.5"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={isPracticeMode ? 'e.g. Court A' : 'e.g. Field 1'}
                      value={surfaceNameInputs[i] ?? ''}
                      onChange={e => setSurfaceNameInputs(si => si.map((v, idx) => idx === i ? e.target.value : v))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const name = (surfaceNameInputs[i] ?? '').trim();
                          if (name) {
                            updateVenueConfig(i, { surfaces: [...venueConfig.surfaces, { id: crypto.randomUUID(), name }] });
                            setSurfaceNameInputs(si => si.map((v, idx) => idx === i ? '' : v));
                          }
                        }
                      }}
                    />
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const name = (surfaceNameInputs[i] ?? '').trim();
                        if (name) {
                          updateVenueConfig(i, { surfaces: [...venueConfig.surfaces, { id: crypto.randomUUID(), name }] });
                          setSurfaceNameInputs(si => si.map((v, idx) => idx === i ? '' : v));
                        }
                      }}
                    >
                      <Plus size={14} /> Add surface
                    </Button>
                  </div>
                  {venueErrors[i] === 'Add at least one surface.' && (
                    <p className="text-xs text-red-600 mt-1">{venueErrors[i]}</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Available From"
                    type="time"
                    value={venueConfig.availableTimeStart}
                    onChange={e => updateVenueConfig(i, { availableTimeStart: e.target.value })}
                  />
                  <Input
                    label="Available Until"
                    type="time"
                    value={venueConfig.availableTimeEnd}
                    onChange={e => updateVenueConfig(i, { availableTimeEnd: e.target.value })}
                  />
                </div>

                {/* Available days pills */}
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1.5">Available Days</p>
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS_OF_WEEK.map(day => (
                      <button
                        key={day}
                        onClick={() => toggleDay(i, day)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          venueConfig.availableDays.includes(day)
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                        }`}
                      >
                        {day.slice(0, 3)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Venue blackout dates */}
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1.5">Venue Blackout Dates</p>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={venueBlackoutInputs[i] ?? ''}
                      onChange={e => {
                        const val = e.target.value;
                        setVenueBlackoutInputs(bi => bi.map((b, idx) => idx === i ? val : b));
                      }}
                    />
                    <Button
                      variant="secondary"
                      onClick={() => {
                        addVenueBlackout(i, venueBlackoutInputs[i] ?? '');
                        setVenueBlackoutInputs(bi => bi.map((b, idx) => idx === i ? '' : b));
                      }}
                    >
                      <Plus size={14} /> Add
                    </Button>
                  </div>
                  {venueConfig.blackoutDates.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {venueConfig.blackoutDates.map(d => (
                        <span key={d} className="flex items-center gap-1 text-xs bg-red-50 text-red-700 border border-red-200 rounded-full px-2 py-0.5">
                          {d}
                          <button onClick={() => removeVenueBlackout(i, d)} className="hover:text-red-900">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Advanced options expander */}
                {venueConfig.surfaces.length >= 1 && (
                  <div className="border-t border-gray-100 pt-2">
                    <button
                      type="button"
                      onClick={() => setVenueAdvancedOpen(prev => {
                        const next = new Set(prev);
                        next.has(i) ? next.delete(i) : next.add(i);
                        return next;
                      })}
                      className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      <ChevronDown size={13} className={`transition-transform ${venueAdvancedOpen.has(i) ? 'rotate-180' : ''}`} />
                      Advanced options
                    </button>

                    {venueAdvancedOpen.has(i) && (
                      <div className="mt-3 space-y-4">
                        {/* Per-surface availability overrides */}
                        <div>
                          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Surface availability overrides</p>
                          <div className="space-y-2">
                            {venueConfig.surfaces.map(surface => (
                              <div key={surface.id} className="rounded-lg border border-gray-200 p-3 space-y-2">
                                <p className="text-sm font-medium text-gray-700">{surface.name}</p>
                                {(!surface.availabilityWindowsOverride?.length && !surface.blackoutDatesOverride?.length) && (
                                  <p className="text-xs text-gray-400 italic">Inherits venue availability</p>
                                )}
                                {surface.availabilityWindowsOverride && surface.availabilityWindowsOverride.length > 0 && (
                                  <div className="space-y-1">
                                    {surface.availabilityWindowsOverride.map((w, wi) => (
                                      <div key={wi} className="flex items-center gap-2 text-xs text-gray-600">
                                        <span>{DAY_NAMES[w.dayOfWeek]}</span>
                                        <span>{w.startTime} – {w.endTime}</span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const updated = venueConfig.surfaces.map(s =>
                                              s.id === surface.id
                                                ? { ...s, availabilityWindowsOverride: s.availabilityWindowsOverride?.filter((_, wIdx) => wIdx !== wi) }
                                                : s
                                            );
                                            updateVenueConfig(i, { surfaces: updated });
                                          }}
                                          className="text-gray-400 hover:text-red-500"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Division surface preferences — only when multiple divisions */}
                        {(divisions?.length ?? 0) > 1 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Division preferences</p>
                            <div className="space-y-2">
                              {(divisions ?? []).map(div => {
                                const divPrefs = venueConfig.divisionSurfacePrefs[div.id] ?? [];
                                const selectionType: 'any' | 'preferred' | 'required' =
                                  divPrefs.length === 0 ? 'any'
                                  : divPrefs[0]?.preference === 'required' ? 'required' : 'preferred';

                                return (
                                  <div key={div.id} className="rounded-lg border border-gray-100 p-3 space-y-2 bg-gray-50">
                                    <div className="flex items-center gap-3">
                                      <span className="text-sm font-medium text-gray-700 flex-1">{div.name}</span>
                                      <select
                                        className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        value={selectionType}
                                        onChange={e => {
                                          const val = e.target.value as 'any' | 'preferred' | 'required';
                                          if (val === 'any') {
                                            updateVenueConfig(i, { divisionSurfacePrefs: { ...venueConfig.divisionSurfacePrefs, [div.id]: [] } });
                                          } else {
                                            updateVenueConfig(i, {
                                              divisionSurfacePrefs: {
                                                ...venueConfig.divisionSurfacePrefs,
                                                // If switching from 'any' (empty prefs), default to all surfaces
                                                // so selectionType doesn't snap back to 'any'.
                                                [div.id]: divPrefs.length > 0
                                                  ? divPrefs.map(p => ({ ...p, preference: val }))
                                                  : venueConfig.surfaces.map(s => ({ surfaceId: s.id, preference: val })),
                                              },
                                            });
                                          }
                                        }}
                                      >
                                        <option value="any">Any surface</option>
                                        <option value="preferred">Preferred</option>
                                        <option value="required">Required</option>
                                      </select>
                                    </div>

                                    {selectionType !== 'any' && venueConfig.surfaces.length > 0 && (
                                      <div className="space-y-1 pl-1">
                                        {venueConfig.surfaces.map(surface => {
                                          const isSelected = divPrefs.some(p => p.surfaceId === surface.id);
                                          return (
                                            <label key={surface.id} className="flex items-center gap-2 cursor-pointer">
                                              <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => {
                                                  const next = isSelected
                                                    ? divPrefs.filter(p => p.surfaceId !== surface.id)
                                                    : [...divPrefs, { surfaceId: surface.id, preference: selectionType }];
                                                  updateVenueConfig(i, { divisionSurfacePrefs: { ...venueConfig.divisionSurfacePrefs, [div.id]: next } });
                                                }}
                                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                                              />
                                              <span className="text-xs text-gray-700">{surface.name}</span>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <Button variant="secondary" onClick={addVenueCard}>
              <Plus size={14} /> Add Venue
            </Button>
          </div>
        )}

        {/* ── Preferences (Season only) ────────────────────────────────────────── */}
        {step === 'preferences' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Drag to reorder soft constraints by priority. The scheduler relaxes lower-priority constraints first when a perfect solution isn't possible.
            </p>

            {/* Hard constraints — non-draggable */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Hard Constraints (always enforced)</p>
              <div className="space-y-1">
                {constraints.filter(c => c.type === 'hard').map(c => (
                  <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg">
                    <div className="w-4 h-4 flex-shrink-0" /> {/* spacer for grip */}
                    <span className="text-xs font-mono text-gray-400 w-12 flex-shrink-0">{c.id}</span>
                    <span className="text-sm text-gray-700 flex-1">{c.label}</span>
                    <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">Required</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Soft constraints — draggable */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Soft Constraints (drag to reorder)</p>
              <div className="space-y-1">
                {constraints.filter(c => c.type === 'soft').map((c) => {
                  const softIdx = constraints.filter(x => x.type === 'soft').indexOf(c);
                  const globalIdx = constraints.indexOf(c);
                  return (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={() => onDragStart(globalIdx)}
                      onDragOver={e => onDragOver(e, globalIdx)}
                      className="flex items-center gap-3 px-3 py-2.5 bg-white border border-gray-200 rounded-lg cursor-grab active:cursor-grabbing hover:border-blue-300 transition-colors"
                    >
                      <GripVertical size={14} className="text-gray-300 flex-shrink-0" />
                      <span className="text-xs font-mono text-gray-400 w-12 flex-shrink-0">{c.id}</span>
                      <span className="text-sm text-gray-700 flex-1">{c.label}</span>
                      <div className="flex items-center gap-2">
                        {c.id === 'SC-03' && <Star size={11} className="text-amber-400" />}
                        <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">#{softIdx + 1}</span>
                        <label className="flex items-center gap-1.5 cursor-pointer" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={c.enabled}
                            onChange={() => toggleConstraint(c.id)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                          />
                          <span className="text-xs text-gray-500">On</span>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Availability Collection ─────────────────────────────────────────── */}
        {step === 'availability' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Optionally collect game availability from coaches before generating the schedule.
            </p>

            {/* Option A — Skip */}
            <label className={`flex items-start gap-4 p-4 border-2 rounded-xl cursor-pointer transition-colors ${
              availabilityOption === 'skip' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
            }`}>
              <input
                type="radio"
                name="availabilityOption"
                value="skip"
                checked={availabilityOption === 'skip'}
                onChange={() => setAvailabilityOption('skip')}
                className="mt-0.5 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <p className="font-semibold text-gray-900">Skip availability collection</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  Scheduler uses venue windows only.
                </p>
              </div>
            </label>

            {/* Option B — Collect */}
            <label className={`flex items-start gap-4 p-4 border-2 rounded-xl cursor-pointer transition-colors ${
              availabilityOption === 'collect' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
            }`}>
              <input
                type="radio"
                name="availabilityOption"
                value="collect"
                checked={availabilityOption === 'collect'}
                onChange={() => setAvailabilityOption('collect')}
                className="mt-0.5 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1">
                <p className="font-semibold text-gray-900">Request availability from coaches</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  Coaches receive a notification to submit their game availability before scheduling begins.
                </p>
                {availabilityOption === 'collect' && (
                  <div className="mt-3">
                    <label className="text-sm font-medium text-gray-700 block mb-1.5">
                      Responses due by:
                    </label>
                    <input
                      type="date"
                      value={collectionDueDate}
                      min={new Date(Date.now() + 86_400_000).toISOString().split('T')[0]}
                      onChange={e => setCollectionDueDate(e.target.value)}
                      className="w-full sm:w-auto px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {availabilityOption === 'collect' && !collectionDueDate && (
                      <p className="text-xs text-amber-600 mt-1.5">
                        Set a due date to continue. The wizard will pause here until coaches respond.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </label>
          </div>
        )}

        {/* ── Blackout Dates ───────────────────────────────────────────────────── */}
        {step === 'blackouts' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Add season-wide blackout dates — no games or practices will be scheduled on these dates (e.g. public holidays, school breaks).
            </p>
            <div className="flex gap-2">
              <Input
                type="date"
                value={blackoutInput}
                onChange={e => setBlackoutInput(e.target.value)}
              />
              <Button
                variant="secondary"
                onClick={() => {
                  if (blackoutInput && !seasonBlackouts.includes(blackoutInput)) {
                    setSeasonBlackouts(bs => [...bs, blackoutInput].sort());
                    setBlackoutInput('');
                  }
                }}
              >
                <Plus size={14} /> Add
              </Button>
            </div>
            {seasonBlackouts.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No blackout dates added.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {seasonBlackouts.map(d => (
                  <span key={d} className="flex items-center gap-1 text-sm bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-3 py-1">
                    <Calendar size={12} /> {d}
                    <button onClick={() => setSeasonBlackouts(bs => bs.filter(x => x !== d))} className="ml-1 hover:text-amber-900">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Generate: configure phase (Season mode — show recommendation) ────── */}
        {step === 'generate' && generatePhase === 'configure' && mode === 'season' && (
          <div className="space-y-5">

            {/* Recommendation card */}
            {hasResponses && !recommendationDismissed && topSlots.length > 0 && recommendedWindow && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
                <div className="flex items-start gap-2.5">
                  <Lightbulb size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-blue-900">Availability recommendation</p>
                    <p className="text-sm text-blue-800 mt-1">
                      Based on coach availability,{' '}
                      {topSlots.map((s, i) => (
                        <span key={`${s.dayLabel}-${s.slotLabel}`}>
                          {i > 0 && ' and '}
                          <strong>{s.dayLabel} {s.slotLabel}s</strong>
                        </span>
                      ))}{' '}
                      have strongest coverage. Recommended season:{' '}
                      <strong>
                        {new Date(recommendedWindow.start + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {' – '}
                        {new Date(recommendedWindow.end + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </strong>
                    </p>
                    <p className="text-xs text-blue-600 mt-1">
                      Based on {responses.length} coach response{responses.length !== 1 ? 's' : ''}.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-7">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setSeasonStart(recommendedWindow.start);
                      setSeasonEnd(recommendedWindow.end);
                      setRecommendationDismissed(true);
                    }}
                  >
                    Use this recommendation
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRecommendationDismissed(true)}
                  >
                    Set manually
                  </Button>
                </div>
              </div>
            )}

            {/* Season window fields */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">Season window</p>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Season Start"
                  type="date"
                  value={seasonStart}
                  onChange={e => setSeasonStart(e.target.value)}
                />
                <Input
                  label="Season End"
                  type="date"
                  value={seasonEnd}
                  onChange={e => setSeasonEnd(e.target.value)}
                />
              </div>
            </div>

            {(!seasonStart || !seasonEnd) && (
              <p className="text-xs text-amber-600">Season start and end dates are required before generating.</p>
            )}
            {divisions && divisions.length > 0 && divisions.some(d => { const cfg = divisionConfigs[d.id]; return !cfg?.format || !cfg?.gamesPerTeam; }) && (
              <p className="text-xs text-amber-600 flex items-start gap-1.5">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                Some divisions are missing schedule configuration — set format and games per team for each division before generating.
              </p>
            )}

            {/* Cross-division coach conflict warning */}
            {showConflictWarning && coachConflicts.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900">Cross-division coach conflict detected</p>
                    <p className="text-sm text-amber-800 mt-1">
                      The following coaches are assigned to teams in multiple divisions:
                    </p>
                    <ul className="mt-2 space-y-1">
                      {coachConflicts.map(conflict => (
                        <li key={conflict.coachId} className="text-sm text-amber-800">
                          <span className="font-medium">{conflict.coachName}</span>
                          {' — '}
                          {conflict.teams.map((t, i) => (
                            <span key={i}>
                              {i > 0 && ' and '}
                              {t.teamName} <span className="text-amber-600">({t.divisionName})</span>
                            </span>
                          ))}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="flex gap-2 pl-7">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setShowConflictWarning(false);
                      setCoachConflicts([]);
                      void handleGenerate();
                    }}
                  >
                    Ignore and generate anyway
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowConflictWarning(false);
                      setCoachConflicts([]);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Generating ───────────────────────────────────────────────────────── */}
        {step === 'generate' && generatePhase === 'running' && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            {generating ? (
              <>
                <Loader2 size={40} className="text-blue-500 animate-spin" />
                <div className="text-center">
                  <p className="text-base font-semibold text-gray-800">Generating your schedule…</p>
                  <p className="text-sm text-gray-500 mt-1">Claude is solving constraints and building fixtures. This may take up to 60 seconds.</p>
                </div>
              </>
            ) : genError ? (
              <>
                <AlertCircle size={40} className="text-red-500" />
                <div className="text-center">
                  <p className="text-base font-semibold text-red-700">Generation failed</p>
                  <p className="text-sm text-gray-500 mt-1">{genError}</p>
                </div>
                <Button onClick={() => void handleGenerate()}>Try Again</Button>
              </>
            ) : null}
          </div>
        )}


        {/* ── Preview ──────────────────────────────────────────────────────────── */}
        {step === 'preview' && result && (
          <div className="space-y-4">
            {result.stats.unassignedFixtures > 0 && !isPracticeMode && (
              <div className="rounded-lg p-3 border border-amber-300 bg-amber-50 text-sm space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="font-semibold text-amber-900">
                    {result.stats.unassignedFixtures} of {result.stats.assignedFixtures + result.stats.unassignedFixtures} committed games couldn't be scheduled
                  </p>
                </div>
                <p className="text-amber-800 text-xs pl-6">
                  Your venues and dates don't have enough available slots to fit the full commitment. To schedule all games, try:
                </p>
                <ul className="text-xs text-amber-800 pl-6 space-y-0.5">
                  <li>• <strong>Extend your season</strong> — add more weeks at the end</li>
                  <li>• <strong>Add another venue</strong> — more concurrent fields means more slots</li>
                  <li>• <strong>Add a game day</strong> — open an additional day of the week in your venue schedule</li>
                </ul>
                <p className="text-xs text-amber-700 pl-6">
                  Or proceed with {result.stats.assignedFixtures} games now and add the remaining {result.stats.unassignedFixtures} manually from the season dashboard.
                </p>
              </div>
            )}

            <div className={`rounded-lg p-3 border text-sm ${result.stats.feasible ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-start gap-2">
                {result.stats.feasible
                  ? <CheckCircle2 size={16} className="text-green-600 flex-shrink-0 mt-0.5" />
                  : <CheckCircle2 size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />
                }
                <div>
                  <p className={`font-medium ${result.stats.feasible ? 'text-green-800' : 'text-gray-700'}`}>
                    {result.stats.assignedFixtures} {isPracticeMode ? 'sessions' : 'games'} scheduled
                    {result.stats.unassignedFixtures > 0 && ` · ${result.stats.unassignedFixtures} need manual scheduling`}
                  </p>
                  <p className="text-gray-600 mt-0.5">{result.summary}</p>
                  {(() => {
                    if (!result) return null;
                    const pairCounts = new Map<string, number>();
                    for (const f of result.fixtures) {
                      const key = [f.homeTeamId, f.awayTeamId].sort().join('|');
                      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
                    }
                    const counts = Array.from(pairCounts.values());
                    const maxCount = Math.max(...counts);
                    if (maxCount <= 1) return null;
                    const freq = new Map<number, number>();
                    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
                    const parts = Array.from(freq.entries())
                      .sort(([a], [b]) => a - b)
                      .map(([times, pairs]) => `${pairs} pair${pairs !== 1 ? 's' : ''} meet${pairs === 1 ? 's' : ''} ${times}×`);
                    return (
                      <p className="text-xs text-gray-500 mt-1">{parts.join(' · ')}</p>
                    );
                  })()}
                </div>
              </div>
            </div>

            {result.conflicts.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-gray-700">Constraint Issues</p>
                {hardConflicts.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs bg-red-50 border border-red-200 rounded-lg p-2.5 text-red-800">
                    <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                    <span><strong>Hard:</strong> {c.description}</span>
                  </div>
                ))}
                {softConflicts.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-amber-800">
                    <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                    <span><strong>Soft:</strong> {c.description}</span>
                  </div>
                ))}
              </div>
            )}

            {fallbackFixtures.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
                  <p className="font-semibold text-amber-800">
                    {fallbackFixtures.length} of {(result.stats.totalFixtures ?? result.stats.totalFixturesRequired ?? result.stats.assignedFixtures)} fixture{result.stats.totalFixtures !== 1 ? 's' : ''} scheduled in fallback time windows
                  </p>
                </div>
                <p className="text-sm text-amber-700">
                  Each fallback fixture must be individually acknowledged before you can publish.
                </p>
                <div className="space-y-2">
                  {fallbackFixtures.map((f, idx) => (
                    <label key={idx} className="flex items-start gap-3 bg-amber-100 border border-amber-200 rounded-lg px-3 py-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={acknowledgedFallbacks.has(idx)}
                        onChange={() => {
                          setAcknowledgedFallbacks(prev => {
                            const next = new Set(prev);
                            next.has(idx) ? next.delete(idx) : next.add(idx);
                            return next;
                          });
                        }}
                        className="mt-0.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500 flex-shrink-0"
                      />
                      <div className="text-sm">
                        <p className="font-medium text-amber-900">{f.homeTeamName} vs {f.awayTeamName}</p>
                        <p className="text-amber-700">{f.date} at {f.startTime}</p>
                        <p className="text-amber-600 text-xs mt-0.5">{f.reason}</p>
                        <p className="text-amber-700 text-xs font-medium mt-0.5">I acknowledge this fixture</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {!isPracticeMode && (() => {
              const teamTally = new Map<string, { name: string; count: number }>();
              for (const f of result.fixtures) {
                const h = teamTally.get(f.homeTeamId) ?? { name: f.homeTeamName, count: 0 };
                h.count += 1;
                teamTally.set(f.homeTeamId, h);
                const a = teamTally.get(f.awayTeamId) ?? { name: f.awayTeamName, count: 0 };
                a.count += 1;
                teamTally.set(f.awayTeamId, a);
              }
              if (teamTally.size === 0) return null;
              const entries = Array.from(teamTally.values()).sort((a, b) => a.name.localeCompare(b.name));
              const counts = entries.map(e => e.count);
              const allEqual = counts.every(c => c === counts[0]);
              return (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <p className="text-xs font-semibold text-gray-600 mb-1.5">Games per team</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {entries.map(e => (
                      <span key={e.name} className="text-xs text-gray-700">
                        <span className="font-medium">{e.name}</span>
                        <span className={`ml-1 font-bold ${allEqual ? 'text-green-700' : 'text-amber-700'}`}>{e.count}</span>
                      </span>
                    ))}
                  </div>
                  {!allEqual && (
                    <p className="text-xs text-amber-700 mt-1.5">Teams have unequal game counts — season may be too short to balance all teams.</p>
                  )}
                </div>
              );
            })()}

            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">{isPracticeMode ? 'Sessions' : 'Fixtures'}</p>

              {/* Division tab bar — shown only when divisionResults are present */}
              {result.divisionResults && result.divisionResults.length > 0 && (
                <div className="flex gap-1 mb-2 border-b border-gray-200">
                  {result.divisionResults.map(dr => (
                    <button
                      key={dr.divisionId}
                      type="button"
                      onClick={() => setActiveDivisionTab(dr.divisionId)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-t-lg border border-b-0 transition-colors ${
                        activeDivisionTab === dr.divisionId
                          ? 'bg-white border-gray-200 text-blue-700 -mb-px'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {dr.divisionName}
                      {dr.unassignedCount > 0 && (
                        <span className="ml-1.5 text-amber-600">({dr.unassignedCount} unscheduled)</span>
                      )}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setActiveDivisionTab(null)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-t-lg border border-b-0 transition-colors ${
                      activeDivisionTab === null
                        ? 'bg-white border-gray-200 text-blue-700 -mb-px'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    All
                  </button>
                </div>
              )}

              {(() => {
                const rawFixtures = result.divisionResults && result.divisionResults.length > 0 && activeDivisionTab !== null
                  ? (result.divisionResults.find(dr => dr.divisionId === activeDivisionTab)?.fixtures ?? [])
                  : result.fixtures;

                // Compute field assignments using the same round-robin logic as saveFixtures
                // so the preview accurately reflects which field each game will land on.
                const fieldSlotCounterPreview = new Map<string, number>();
                const displayFixtures = rawFixtures.map(f => {
                  const fixtureName = f.venueName ?? f.venue ?? '';
                  const matchedConfig = venueConfigs.find(vc => vc.name === fixtureName);
                  if (!matchedConfig?.selectedVenueId) return f;
                  const selectedVenue = resolveVenue(matchedConfig.selectedVenueId);
                  if (!selectedVenue?.fields || selectedVenue.fields.length <= 1) return f;
                  const slotKey = `${matchedConfig.selectedVenueId}|${f.date}|${f.startTime}`;
                  const slotIdx = fieldSlotCounterPreview.get(slotKey) ?? 0;
                  fieldSlotCounterPreview.set(slotKey, slotIdx + 1);
                  const assignedField = selectedVenue.fields[slotIdx % selectedVenue.fields.length];
                  return { ...f, fieldName: assignedField.name };
                });

                return (
                  <div className="border border-gray-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 text-gray-500 font-medium">Date</th>
                          <th className="text-left px-3 py-2 text-gray-500 font-medium">Time</th>
                          {isPracticeMode ? (
                            <th className="text-left px-3 py-2 text-gray-500 font-medium">Team</th>
                          ) : (
                            <>
                              <th className="text-left px-3 py-2 text-gray-500 font-medium">Home</th>
                              <th className="text-left px-3 py-2 text-gray-500 font-medium">Away</th>
                            </>
                          )}
                          <th className="text-left px-3 py-2 text-gray-500 font-medium hidden sm:table-cell">Venue / Field</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {displayFixtures.map((f, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{f.date}</td>
                            <td className="px-3 py-2 text-gray-700">{f.startTime}</td>
                            {isPracticeMode ? (
                              <td className="px-3 py-2 font-medium text-gray-900">{f.homeTeamName}</td>
                            ) : (
                              <>
                                <td className="px-3 py-2 font-medium text-gray-900">{f.homeTeamName}</td>
                                <td className="px-3 py-2 text-gray-700">{f.awayTeamName}</td>
                              </>
                            )}
                            <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">
                              {f.venueName ?? f.venue}
                              {f.fieldName && <span className="text-gray-400"> · {f.fieldName}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>

            {!canPublish && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                {hardConflicts.length > 0
                  ? 'Publishing is blocked until all hard constraint violations are resolved. Adjust your inputs and regenerate.'
                  : 'Acknowledge all fallback fixtures above before publishing.'}
              </div>
            )}
          </div>
        )}

        {/* ── Publish ──────────────────────────────────────────────────────────── */}
        {step === 'publish' && (
          <div className="space-y-4">
            {published ? (
              <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
                <CheckCircle2 size={48} className="text-green-500" />
                <div>
                  <p className="text-lg font-bold text-gray-900">
                    {isPracticeMode ? 'Practices Published!' : publishedAsDraft ? 'Schedule Saved as Draft!' : 'Schedule Published!'}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    {isPracticeMode
                      ? `${result?.stats.assignedFixtures} practice sessions added to the calendar.`
                      : publishedAsDraft
                        ? `${result?.stats.assignedFixtures} games saved as draft. Players will not see the schedule until you publish it from the Season Dashboard.`
                        : `${result?.stats.assignedFixtures} fixtures added to the league calendar.`}
                  </p>
                </div>
                <Button onClick={onClose}>Done</Button>
              </div>
            ) : (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 flex items-start gap-2">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>
                    This will save {result?.stats.assignedFixtures} game{result?.stats.assignedFixtures !== 1 ? 's' : ''} as a draft.
                    Players will not see the schedule until you publish it from the Season Dashboard.
                  </span>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
                  <p className="text-sm font-semibold text-blue-900 flex items-center gap-2">
                    <Wand2 size={15} /> {isPracticeMode ? 'Ready to publish' : 'Ready to save'}
                  </p>
                  <ul className="text-sm text-blue-800 space-y-1">
                    <li>• {result?.stats.assignedFixtures} {isPracticeMode ? 'practice sessions' : 'fixtures'} will be added to the {isPracticeMode ? 'calendar' : 'league schedule'}</li>
                    {!isPracticeMode && <li>• "Save as Draft" — visible only to league managers until published</li>}
                    {!isPracticeMode && <li>• "Publish Now" — immediately visible to coaches and players</li>}
                    {isPracticeMode && <li>• Events will appear immediately in team and league calendars</li>}
                    {result && result.stats.unassignedFixtures > 0 && (
                      <li className="text-amber-700">• {result.stats.unassignedFixtures} game{result.stats.unassignedFixtures !== 1 ? 's' : ''} couldn't fit in your schedule — add them manually from the season dashboard after publishing</li>
                    )}
                  </ul>
                </div>
                {genError && <p className="text-sm text-red-600">{genError}</p>}
              </>
            )}
          </div>
        )}

        </div>{/* end scrollable step content */}

        {/* ── Navigation ───────────────────────────────────────────────────────── */}
        {!showResumePrompt && !published && step !== 'mode' && !(step === 'generate' && generatePhase === 'running') && (
          <div className="flex justify-between items-center flex-shrink-0 border-t border-gray-100 py-4">
            <div className="flex items-center gap-3">
              <Button variant="secondary" onClick={goBack} disabled={publishing}>
                <ChevronLeft size={16} /> {currentStepIdx === 0 ? 'Change Mode' : 'Back'}
              </Button>
              {justSaved && (
                <span className="text-xs text-green-600 transition-opacity">&#10003; Saved</span>
              )}
            </div>

            {step === 'generate' && generatePhase === 'configure' ? (
              <Button
                onClick={handleGenerateClick}
                disabled={
                  !seasonStart ||
                  !seasonEnd ||
                  (divisions !== undefined &&
                    divisions.length > 0 &&
                    divisions.some(d => { const cfg = divisionConfigs[d.id]; return !cfg?.format || !cfg?.gamesPerTeam; }))
                }
              >
                <Wand2 size={15} /> Generate Schedule
              </Button>
            ) : step === 'preview' ? (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setResult(null);
                    setGenError('');
                    if (mode === 'season') {
                      setGeneratePhase('configure');
                      setRecommendationDismissed(false);
                      setStep('generate');
                    } else {
                      void handleGenerate();
                    }
                  }}
                >
                  Regenerate
                </Button>
                <Button onClick={goNext} disabled={!canPublish}>
                  Next <ChevronRight size={16} />
                </Button>
              </div>
            ) : step === 'publish' ? (
              isPracticeMode ? (
                <Button onClick={() => void handlePublish()} disabled={publishing || !canPublish}>
                  {publishing ? <><Loader2 size={14} className="animate-spin" /> Publishing…</> : 'Publish Practices'}
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => saveFixtures(false)} disabled={publishing || !canPublish}>
                    {publishing ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save as Draft'}
                  </Button>
                  <Button onClick={() => saveFixtures(true)} disabled={publishing || !canPublish}>
                    {publishing ? <><Loader2 size={14} className="animate-spin" /> Publishing…</> : 'Publish Now'}
                  </Button>
                </div>
              )
            ) : (
              <Button
                onClick={goNext}
                disabled={step === 'availability' && availabilityOption === 'collect' && !collectionDueDate}
              >
                {step === 'blackouts' && mode !== 'season'
                  ? <><Wand2 size={15} /> Generate</>
                  : step === 'availability' && availabilityOption === 'collect'
                    ? <>Send {'&'} Pause</>
                    : <>Next <ChevronRight size={16} /></>
                }
              </Button>
            )}
          </div>
        )}

        {!showResumePrompt && step === 'mode' && (
          <div className="flex justify-end flex-shrink-0 border-t border-gray-100 py-4">
            <Button variant="secondary" onClick={handleModalClose}>Cancel</Button>
          </div>
        )}
      </Modal>

      {/* Quick-create venue modal — rendered outside wizard Modal to avoid z-index stacking issues */}
      <QuickCreateVenueModal
        open={quickCreateOpen}
        onClose={() => { setQuickCreateOpen(false); setQuickCreateTargetIdx(null); }}
        onCreated={handleQuickCreated}
        ownerUid={user?.uid ?? ''}
      />
    </>
  );
}
