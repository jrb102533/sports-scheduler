import { useState, useRef, useMemo, useEffect } from 'react';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { collection, getDocs, setDoc, doc, query, orderBy, limit } from 'firebase/firestore';
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
import { useAuthStore } from '@/store/useAuthStore';
import { DEFAULT_CONSTRAINTS } from '@/types/wizard';
import { getTopCoverageSlots } from '@/lib/coverageUtils';
import type { Venue, RecurringVenueWindow } from '@/types/venue';
import type { League, Team, ScheduledEvent, Season, WizardMode, ScheduleConstraint, CoachAvailabilityResponse } from '@/types';
import type { ScheduleConfig, ScheduleVenueConfig } from '@/types/scheduleConfig';

// ─── Local types ──────────────────────────────────────────────────────────────

interface WizardVenueConfig {
  selectedVenueId: string | null; // null = manual entry
  name: string;
  concurrentPitches: number;
  availableDays: string[]; // derived from defaultAvailabilityWindows for generator compat
  availableTimeStart: string;
  availableTimeEnd: string;
  blackoutDates: string[];
  // New availability windows (v2)
  availabilityWindows: RecurringVenueWindow[];
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
  isDoubleheader: boolean;
  doubleheaderSlot?: 1 | 2;
  isFallbackSlot: boolean;
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
}

type WizardStep = 'mode' | 'config' | 'teams' | 'cadence' | 'venues' | 'preferences' | 'availability' | 'blackouts' | 'generate' | 'preview' | 'publish';
type Format = 'single_round_robin' | 'double_round_robin' | 'single_elimination' | 'double_elimination' | 'group_then_knockout';

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_OPTIONS = DAY_NAMES.map((d, i) => ({ value: String(i), label: d }));
const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const generateScheduleFn = httpsCallable<object, ScheduleOutput>(getFunctions(), 'generateSchedule');

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
    concurrentPitches: 1,
    availableDays: ['Saturday', 'Sunday'],
    availableTimeStart: '09:00',
    availableTimeEnd: '17:00',
    blackoutDates: [],
    availabilityWindows: [],
  };
}

function venueConfigFromSaved(saved: Venue): Partial<WizardVenueConfig> {
  return {
    selectedVenueId: saved.id,
    name: saved.name,
    concurrentPitches: saved.fields?.length ?? 1,
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
  onSelectSaved: (venue: Venue) => void;
  onCreateNew: () => void;
}

function VenueCombobox({ venueConfig, savedVenues, onSelectSaved, onCreateNew }: VenueComboboxProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = savedVenues.filter(v =>
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

  const displayValue = venueConfig.selectedVenueId
    ? (savedVenues.find(v => v.id === venueConfig.selectedVenueId)?.name ?? venueConfig.name)
    : venueConfig.name
      ? venueConfig.name
      : '';

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
          placeholder={displayValue || 'Search saved venues…'}
          value={open ? query : displayValue}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        {venueConfig.selectedVenueId && !open && (
          <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-medium flex-shrink-0">Saved</span>
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          {filtered.length === 0 && query && (
            <div className="px-3 py-2 text-xs text-gray-400">No venues match "{query}"</div>
          )}
          {filtered.map(venue => (
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
}

export function ScheduleWizardModal({ open, onClose, league, leagueTeams, season, currentUserUid, divisionId }: Props) {
  const { addEvent } = useEventStore();
  const { createCollection, saveWizardDraft, wizardDraft, activeCollection, responses, loadCollection } = useCollectionStore();

  // Venue store
  const savedVenues = useVenueStore(s => s.venues);
  const subscribeVenues = useVenueStore(s => s.subscribe);
  const user = useAuthStore(s => s.user);

  useEffect(() => {
    const unsub = subscribeVenues();
    return unsub;
  }, [subscribeVenues]);

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
  const [format, setFormat] = useState<Format>('single_round_robin');
  const [playoffFormat, setPlayoffFormat] = useState<Format>('single_elimination');
  const [groupCount, setGroupCount] = useState('2');
  const [groupAdvance, setGroupAdvance] = useState('2');
  const [minRestDays, setMinRestDays] = useState('6');
  const [maxConsecAway, setMaxConsecAway] = useState('2');
  const [distributionExpanded, setDistributionExpanded] = useState(false);

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

  useEffect(() => {
    if (step === 'generate' && generatePhase === 'configure' && mode === 'season') {
      const unsub = loadCollection(league.id);
      return unsub;
    }
  }, [step, generatePhase, mode, league.id, loadCollection]);

  // ── Preview: per-fixture fallback acknowledgement ────────────────────────
  const [acknowledgedFallbacks, setAcknowledgedFallbacks] = useState<Set<number>>(new Set());

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
    if (!open || !season?.id || !league.id) return;

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
        setVenueConfigs(cfg.venueConfigs.map((svc: ScheduleVenueConfig): WizardVenueConfig => ({
          selectedVenueId: svc.venueId || null,
          name: svc.name,
          concurrentPitches: svc.concurrentPitches ?? 1,
          availableDays: svc.availableDays ?? ['Saturday', 'Sunday'],
          availableTimeStart: svc.availableTimeStart ?? '09:00',
          availableTimeEnd: svc.availableTimeEnd ?? '17:00',
          blackoutDates: svc.blackoutDates ?? [],
          availabilityWindows: svc.availabilityWindows ?? [],
        })));
        setVenueBlackoutInputs(cfg.venueConfigs.map(() => ''));
      }

      // Skip mode picker — go straight to config step
      if (cfg.mode) {
        setStep(getSteps(cfg.mode)[0]);
      }
    }).catch(() => {
      // Non-fatal: if the query fails, default wizard state is used
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, season?.id, league.id]);

  // ─── Save wizard config to Firestore ────────────────────────────────────────

  function saveScheduleConfig() {
    if (!season?.id || !league.id || !mode) return;

    const configId = crypto.randomUUID();
    const venueConfigsMapped: ScheduleVenueConfig[] = venueConfigs.map(vc => ({
      venueId: vc.selectedVenueId ?? '',
      name: vc.name,
      concurrentPitches: vc.concurrentPitches,
      availableDays: vc.availableDays,
      availableTimeStart: vc.availableTimeStart,
      availableTimeEnd: vc.availableTimeEnd,
      availabilityWindows: vc.availabilityWindows,
      blackoutDates: vc.blackoutDates,
    }));

    const cfg: ScheduleConfig = {
      id: configId,
      mode,
      seasonStart,
      seasonEnd,
      matchDuration: parseInt(matchDuration),
      bufferMinutes: parseInt(bufferMinutes),
      gamesPerTeam: parseInt(gamesPerTeam),
      homeAwayBalance,
      format,
      ...(mode === 'playoff' ? { playoffFormat } : {}),
      ...(groupCount ? { groupCount: parseInt(groupCount) } : {}),
      ...(groupAdvance ? { groupAdvance: parseInt(groupAdvance) } : {}),
      minRestDays: parseInt(minRestDays),
      maxConsecAway: parseInt(maxConsecAway),
      constraints,
      venueConfigs: venueConfigsMapped,
      seasonBlackouts,
      teamIds: leagueTeams.map(t => t.id),
      availabilityOption,
      ...(collectionId ? { collectionId } : {}),
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
      if (!(v.availableDays ?? []).length) return 'Select at least one available day.';
      if (v.availableTimeStart >= v.availableTimeEnd) return 'End time must be after start time.';
      return '';
    });
    setVenueErrors(errs);
    return errs.every(e => !e);
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
      } else {
        void handleGenerate();
      }
      return;
    }

    if (idx < steps.length - 1) {
      setStep(steps[idx + 1]);
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
      setStep(steps[idx + 1]);
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
      resetWizard();
    } else {
      setStep(steps[idx - 1]);
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
      const activeFormat = mode === 'playoff' ? playoffFormat : format;

      // Resolve which collection to read responses from.
      const resolvedCollectionId = collectionId ?? wizardDraft?.collectionId ?? null;

      let coachAvailability: CoachAvailabilityResponse[] = [];
      if (resolvedCollectionId) {
        const snap = await getDocs(
          collection(db, 'leagues', league.id, 'availabilityCollections', resolvedCollectionId, 'responses')
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
        return {
          // id is required by the algorithm for duplicate-detection; use the saved
          // venue id when available, otherwise fall back to the manual entry name.
          id: vc.selectedVenueId ?? vc.name,
          name: vc.name,
          concurrentPitches: vc.concurrentPitches,
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

      const payload: Record<string, unknown> = {
        mode: mode ?? 'season',
        leagueId: league.id,
        leagueName: league.name,
        seasonStart: isPractice ? practiceSeasonStart : seasonStart,
        seasonEnd: isPractice ? practiceSeasonEnd : seasonEnd,
        matchDurationMinutes: parseInt(isPractice ? practiceDuration : matchDuration),
        bufferMinutes: isPractice ? 0 : parseInt(bufferMinutes),
        format: isPractice ? 'practice' : activeFormat,
        teams: isPractice
          ? leagueTeams
              .filter(t => practiceTeamIds.has(t.id))
              .map(t => ({ id: t.id, name: t.name }))
          : leagueTeams.map(t => ({
              id: t.id,
              name: t.name,
              homeVenue: venuesPayload.length === 1 ? venuesPayload[0].name : undefined,
            })),
        venues: venuesPayload,
        blackoutDates: seasonBlackouts,
        softConstraintPriority,
        homeAwayMode: homeAwayBalance ? 'strict' : 'relaxed',
        coachAvailability,
        ...(isPractice
          ? {
              practiceTimeWindows: practiceTimes,
              practiceMaxPerWeek: parseInt(practiceMaxPerWeek),
            }
          : {
              minRestDays: parseInt(minRestDays),
              maxConsecutiveAway: parseInt(maxConsecAway),
              ...(activeFormat === 'group_then_knockout'
                ? { groupCount: parseInt(groupCount), groupAdvance: parseInt(groupAdvance) }
                : {}),
            }),
      };

      const { data } = await generateScheduleFn(payload);
      setResult(data);
      setAcknowledgedFallbacks(new Set());
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
    const durationMins = parseInt(mode === 'practice' ? practiceDuration : matchDuration);

    try {
      await Promise.all(
        result.fixtures.map(fixture => {
          const endTime = fixture.endTime || (() => {
            const [h, m] = fixture.startTime.split(':').map(Number);
            const endMins = h * 60 + m + durationMins;
            return `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;
          })();

          const isPracticeFixture = fixture.awayTeamId === '';

          // Attach venue library fields if matched
          const fixtureName = fixture.venueName ?? fixture.venue ?? '';
          const matchedConfig = venueConfigs.find(vc => vc.name === fixtureName);
          const venueFields = matchedConfig?.selectedVenueId ? (() => {
            const selectedVenue = savedVenues.find(v => v.id === matchedConfig.selectedVenueId);
            return {
              venueId: matchedConfig.selectedVenueId,
              ...(selectedVenue?.lat != null && selectedVenue?.lng != null ? {
                venueLat: selectedVenue.lat,
                venueLng: selectedVenue.lng,
              } : {}),
            };
          })() : {};

          const event: Omit<ScheduledEvent, 'id'> = isPracticeFixture
            ? {
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
              }
            : {
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
                notes: fixture.stage ? `Round ${fixture.round} — ${fixture.stage}` : `Round ${fixture.round}`,
                createdAt: now,
                updatedAt: now,
                ...venueFields,
              };

          return addEvent(event as ScheduledEvent);
        })
      );
      setPublished(true);
      saveScheduleConfig();
    } catch {
      setGenError('Failed to publish some events. Please check the schedule and try again.');
    } finally {
      setPublishing(false);
    }
  }

  // ─── Save/publish fixtures (season & playoff) ────────────────────────────────

  async function saveFixtures(publishNow: boolean) {
    if (!result) return;
    setPublishing(true);
    const now = new Date().toISOString();
    try {
      await Promise.all(
        result.fixtures.map(fixture => {
          const durationMins = parseInt(matchDuration);
          const [h, m] = fixture.startTime.split(':').map(Number);
          const endMinutes = h * 60 + m + durationMins;
          const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
          const fixtureName = fixture.venueName ?? fixture.venue ?? '';
          const matchedConfig = venueConfigs.find(vc => vc.name === fixtureName);
          const venueFields = matchedConfig?.selectedVenueId ? (() => {
            const selectedVenue = savedVenues.find(v => v.id === matchedConfig.selectedVenueId);
            return {
              venueId: matchedConfig.selectedVenueId,
              ...(selectedVenue?.lat != null && selectedVenue?.lng != null ? {
                venueLat: selectedVenue.lat,
                venueLng: selectedVenue.lng,
              } : {}),
            };
          })() : {};
          const event: Omit<ScheduledEvent, 'id'> = {
            title: `${fixture.homeTeamName} vs ${fixture.awayTeamName}`,
            type: 'game',
            status: publishNow ? 'scheduled' : 'draft',
            date: fixture.date,
            startTime: fixture.startTime,
            endTime,
            duration: durationMins,
            location: fixtureName,
            homeTeamId: fixture.homeTeamId,
            awayTeamId: fixture.awayTeamId,
            teamIds: [fixture.homeTeamId, fixture.awayTeamId],
            isRecurring: false,
            notes: fixture.stage ? `Round ${fixture.round} — ${fixture.stage}` : `Round ${fixture.round}`,
            createdAt: now,
            updatedAt: now,
            ...venueFields,
            ...(season?.id ? { seasonId: season.id } : {}),
            ...(divisionId ? { divisionId } : {}),
          };
          return addEvent(event as ScheduledEvent);
        })
      );
      setPublished(true);
      setPublishedAsDraft(!publishNow);
      saveScheduleConfig();
    } catch {
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
  }

  function removeVenueCard(i: number) {
    setVenueConfigs(vs => vs.filter((_, idx) => idx !== i));
    setVenueBlackoutInputs(bi => bi.filter((_, idx) => idx !== i));
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

  const hardConflicts = result?.conflicts.filter(c => c.severity === 'hard') ?? [];
  const softConflicts = result?.conflicts.filter(c => c.severity === 'soft') ?? [];
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
      <Modal open={open} onClose={onClose} title="Schedule Wizard" size="lg">

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

        {/* ── Mode picker ─────────────────────────────────────────────────────── */}
        {step === 'mode' && (
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
            <div className="grid grid-cols-2 gap-3">
              <Input label="Match Duration (min)" type="number" min="10" value={matchDuration} onChange={e => setMatchDuration(e.target.value)} />
              <Input label="Buffer Between Games (min)" type="number" min="0" value={bufferMinutes} onChange={e => setBufferMinutes(e.target.value)} />
            </div>
            {mode === 'season' && (
              <>
                <Input
                  label="Games Per Team"
                  type="number"
                  min="1"
                  max="100"
                  value={gamesPerTeam}
                  onChange={e => setGamesPerTeam(e.target.value)}
                />

                {/* Round-down warning */}
                {(() => {
                  const gpt = parseInt(gamesPerTeam);
                  const teamCount = leagueTeams.length;
                  if (!isNaN(gpt) && gpt > 0 && teamCount > 0 && (gpt * teamCount) % 2 !== 0) {
                    return (
                      <div className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-amber-800">
                        <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                        <span>
                          With {teamCount} team{teamCount !== 1 ? 's' : ''} and {gpt} games per team, {teamCount % 2 === 0 ? 'some' : 'all'} teams will play {gpt - 1} games.
                          The schedule will round down to balance the remainder.
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
                    <span className="font-medium">About game distribution</span>
                    <ChevronDown size={14} className={`text-gray-400 transition-transform ${distributionExpanded ? 'rotate-180' : ''}`} />
                  </button>
                  {distributionExpanded && (
                    <div className="px-3 pb-3 pt-1 text-xs text-gray-600 border-t border-gray-100 bg-gray-50">
                      The scheduler uses a round-robin algorithm to distribute games evenly. Each team plays{' '}
                      {gamesPerTeam || 'N'} games against{' '}
                      {leagueTeams.length > 0
                        ? `up to ${Math.min(leagueTeams.length - 1, parseInt(gamesPerTeam) || 0)} different opponent${Math.min(leagueTeams.length - 1, parseInt(gamesPerTeam) || 0) !== 1 ? 's' : ''}`
                        : 'various opponents'}.
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
                const windows = vc.availabilityWindows;
                if (windows.length > 0) {
                  for (const w of windows) {
                    const startMins = parseInt(w.startTime.split(':')[0]) * 60 + parseInt(w.startTime.split(':')[1]);
                    const endMins = parseInt(w.endTime.split(':')[0]) * 60 + parseInt(w.endTime.split(':')[1]);
                    const slotDuration = Math.max(parseInt(matchDuration) + parseInt(bufferMinutes), 30);
                    const slotsPerDay = Math.floor((endMins - startMins) / slotDuration);
                    total += slotsPerDay * vc.concurrentPitches * weeks;
                  }
                } else {
                  const dayCount = vc.availableDays.length;
                  const startMins = parseInt(vc.availableTimeStart.split(':')[0]) * 60 + parseInt(vc.availableTimeStart.split(':')[1]);
                  const endMins = parseInt(vc.availableTimeEnd.split(':')[0]) * 60 + parseInt(vc.availableTimeEnd.split(':')[1]);
                  const slotDuration = Math.max(parseInt(matchDuration) + parseInt(bufferMinutes), 30);
                  const slotsPerDay = Math.floor((endMins - startMins) / slotDuration);
                  total += slotsPerDay * vc.concurrentPitches * dayCount * weeks;
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
                  onSelectSaved={venue => selectSavedVenue(i, venue)}
                  onCreateNew={() => openQuickCreate(i)}
                />

                {/* Editable detail fields */}
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Venue Name"
                    value={venueConfig.name}
                    onChange={e => updateVenueConfig(i, { name: e.target.value, selectedVenueId: null })}
                    placeholder="e.g. Riverside Park"
                    error={venueErrors[i]}
                  />
                  <Input
                    label={isPracticeMode ? 'Concurrent Courts' : 'Concurrent Pitches'}
                    type="number"
                    min="1"
                    value={String(venueConfig.concurrentPitches)}
                    onChange={e => updateVenueConfig(i, { concurrentPitches: parseInt(e.target.value) || 1 })}
                  />
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
            <div className={`rounded-lg p-3 border text-sm ${result.stats.feasible ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-start gap-2">
                {result.stats.feasible
                  ? <CheckCircle2 size={16} className="text-green-600 flex-shrink-0 mt-0.5" />
                  : <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                }
                <div>
                  <p className={`font-medium ${result.stats.feasible ? 'text-green-800' : 'text-amber-800'}`}>
                    {result.stats.assignedFixtures}/{(result.stats.totalFixtures ?? result.stats.totalFixturesRequired ?? result.stats.assignedFixtures)} {isPracticeMode ? 'sessions' : 'fixtures'} scheduled
                    {result.stats.unassignedFixtures > 0 && ` · ${result.stats.unassignedFixtures} unassigned`}
                  </p>
                  <p className="text-gray-600 mt-0.5">{result.summary}</p>
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

            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">{isPracticeMode ? 'Sessions' : 'Fixtures'}</p>
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
                      <th className="text-left px-3 py-2 text-gray-500 font-medium hidden sm:table-cell">Venue</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium hidden sm:table-cell">
                        {isPracticeMode ? '' : 'Stage'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {result.fixtures.map((f, i) => (
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
                        <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">{f.venue}</td>
                        <td className="px-3 py-2 text-gray-400 hidden sm:table-cell">
                          {isPracticeMode ? '' : (f.stage ?? `Rd ${f.round}`)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                      <li className="text-amber-700">• {result.stats.unassignedFixtures} {isPracticeMode ? 'session' : 'fixture'}{result.stats.unassignedFixtures !== 1 ? 's' : ''} could not be scheduled and will not be saved</li>
                    )}
                  </ul>
                </div>
                {genError && <p className="text-sm text-red-600">{genError}</p>}
              </>
            )}
          </div>
        )}

        {/* ── Navigation ───────────────────────────────────────────────────────── */}
        {!published && step !== 'mode' && !(step === 'generate' && generatePhase === 'running') && (
          <div className="flex justify-between pt-4 mt-4 border-t border-gray-100">
            <Button variant="secondary" onClick={goBack} disabled={publishing}>
              <ChevronLeft size={16} /> {currentStepIdx === 0 ? 'Change Mode' : 'Back'}
            </Button>

            {step === 'generate' && generatePhase === 'configure' ? (
              <Button
                onClick={() => void handleGenerate()}
                disabled={!seasonStart || !seasonEnd}
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

        {step === 'mode' && (
          <div className="flex justify-end pt-4 mt-4 border-t border-gray-100">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
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
