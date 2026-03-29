import { useState, useRef } from 'react';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { collection, getDocs } from 'firebase/firestore';
import {
  Calendar, MapPin, Users, Wand2, CheckCircle2, AlertTriangle,
  AlertCircle, ChevronLeft, ChevronRight, Plus, Trash2, Loader2,
  GripVertical, Trophy, Dumbbell, Star, ChevronDown,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { db } from '@/lib/firebase';
import { useEventStore } from '@/store/useEventStore';
import { useCollectionStore } from '@/store/useCollectionStore';
import { DEFAULT_CONSTRAINTS } from '@/types/wizard';
import type { League, Team, ScheduledEvent, WizardMode, WizardVenueInput, ScheduleConstraint, RecurringVenueWindow, CoachAvailabilityResponse } from '@/types';

// ─── Local types ──────────────────────────────────────────────────────────────

interface GeneratedFixture {
  round: number;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  date: string;
  startTime: string;
  venue: string;
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
  conflicts: Array<{ severity: 'hard' | 'soft'; description: string; constraintId?: string }>;
  stats: { totalFixtures: number; assignedFixtures: number; unassignedFixtures: number; feasible: boolean };
  summary: string;
  fallbackFixtures?: FallbackFixtureSummary[];
}

type WizardStep = 'mode' | 'config' | 'teams' | 'cadence' | 'venues' | 'preferences' | 'availability' | 'blackouts' | 'generate' | 'preview' | 'publish';
type Format = 'single_round_robin' | 'double_round_robin' | 'single_elimination' | 'double_elimination' | 'group_then_knockout';

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_OPTIONS = DAY_NAMES.map((d, i) => ({ value: String(i), label: d }));

const FORMAT_OPTIONS = [
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
  generate: 'Generating…',
  preview: 'Preview',
  publish: 'Publish',
};

function newVenue(): WizardVenueInput {
  return {
    name: '',
    concurrentPitches: 1,
    availabilityWindows: [
      { dayOfWeek: 6, startTime: '09:00', endTime: '17:00' }, // Saturday
      { dayOfWeek: 0, startTime: '10:00', endTime: '16:00' }, // Sunday
    ],
    fallbackWindows: [],
    blackoutDates: [],
  };
}

const generateScheduleFn = httpsCallable<object, ScheduleOutput>(getFunctions(), 'generateLeagueSchedule');

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  league: League;
  leagueTeams: Team[];
  currentUserUid: string;
}

export function ScheduleWizardModal({ open, onClose, league, leagueTeams, currentUserUid }: Props) {
  const { addEvent } = useEventStore();
  const { createCollection, saveWizardDraft, wizardDraft } = useCollectionStore();

  // Mode & step
  const [mode, setMode] = useState<WizardMode | null>(null);
  const [step, setStep] = useState<WizardStep>('mode');

  // ── Season / Playoff config ──────────────────────────────────────────────────
  const [seasonStart, setSeasonStart] = useState('');
  const [seasonEnd, setSeasonEnd] = useState('');
  const [matchDuration, setMatchDuration] = useState('60');
  const [bufferMinutes, setBufferMinutes] = useState('15');
  const [format, setFormat] = useState<Format>('single_round_robin');
  const [playoffFormat, setPlayoffFormat] = useState<Format>('single_elimination');
  const [minRestDays, setMinRestDays] = useState('6');
  const [maxConsecAway, setMaxConsecAway] = useState('2');
  const [groupCount, setGroupCount] = useState('2');
  const [groupAdvance, setGroupAdvance] = useState('2');

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
  const [venues, setVenues] = useState<WizardVenueInput[]>([newVenue()]);
  const [venueErrors, setVenueErrors] = useState<string[]>([]);
  const [fallbackExpanded, setFallbackExpanded] = useState<boolean[]>([false]);

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

  // ── Availability collection ───────────────────────────────────────────────
  const [availabilityOption, setAvailabilityOption] = useState<'skip' | 'collect'>('skip');
  const [collectionDueDate, setCollectionDueDate] = useState('');
  const [collectionId, setCollectionId] = useState<string | null>(null);

  // ── Preview: per-fixture fallback acknowledgement ────────────────────────
  const [acknowledgedFallbacks, setAcknowledgedFallbacks] = useState<Set<number>>(new Set());

  // ── Validation errors ────────────────────────────────────────────────────────
  const [configError, setConfigError] = useState('');
  const [practiceTeamError, setPracticeTeamError] = useState('');
  const [practiceCadenceError, setPracticeCadenceError] = useState('');

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
  }

  function validateConfig(): boolean {
    if (!seasonStart || !seasonEnd) { setConfigError('Season start and end dates are required.'); return false; }
    if (seasonStart >= seasonEnd) { setConfigError('Season end must be after start date.'); return false; }
    if (!matchDuration || parseInt(matchDuration) < 10) { setConfigError('Match duration must be at least 10 minutes.'); return false; }
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
    const errs = venues.map(v => {
      if (!v.name.trim()) return 'Venue name is required.';
      if (v.availabilityWindows.length === 0) return 'Add at least one availability window.';
      const bad = v.availabilityWindows.some(w => !w.startTime || !w.endTime || w.startTime >= w.endTime);
      if (bad) return 'Each window must have a valid start and end time.';
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
      void handleGenerate();
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

    if (step === 'generate' || step === 'preview') {
      setResult(null);
      setGenError('');
      const blackoutsIdx = steps.indexOf('blackouts');
      setStep(steps[blackoutsIdx]);
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
    setStep('generate');

    try {
      const isPractice = mode === 'practice';
      const activeFormat = mode === 'playoff' ? playoffFormat : format;

      // Resolve which collection to read responses from.
      // Prefer the local state collectionId (set when LM created a collection in
      // this session), then fall back to the persisted wizardDraft collectionId
      // (set when LM returns after coaches have submitted responses).
      const resolvedCollectionId = collectionId ?? wizardDraft?.collectionId ?? null;

      let coachAvailability: CoachAvailabilityResponse[] = [];
      if (resolvedCollectionId) {
        const snap = await getDocs(
          collection(db, 'leagues', league.id, 'availabilityCollections', resolvedCollectionId, 'responses')
        );
        coachAvailability = snap.docs.map(d => d.data() as CoachAvailabilityResponse);
      }

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
              homeVenue: venues.length === 1 ? venues[0].name : undefined,
            })),
        venues,
        blackoutDates: seasonBlackouts,
        preferences: constraints,
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
          const [h, m] = fixture.startTime.split(':').map(Number);
          const endMins = h * 60 + m + durationMins;
          const endTime = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;

          const isPracticeFixture = fixture.awayTeamId === '';

          const event: Omit<ScheduledEvent, 'id'> = isPracticeFixture
            ? {
                title: `${fixture.homeTeamName} Practice`,
                type: 'practice',
                status: 'scheduled',
                date: fixture.date,
                startTime: fixture.startTime,
                endTime,
                duration: durationMins,
                location: fixture.venue,
                teamIds: [fixture.homeTeamId],
                isRecurring: false,
                notes: fixture.stage ? fixture.stage : undefined,
                createdAt: now,
                updatedAt: now,
              }
            : {
                title: `${fixture.homeTeamName} vs ${fixture.awayTeamName}`,
                type: 'game',
                status: 'scheduled',
                date: fixture.date,
                startTime: fixture.startTime,
                endTime,
                duration: durationMins,
                location: fixture.venue,
                homeTeamId: fixture.homeTeamId,
                awayTeamId: fixture.awayTeamId,
                teamIds: [fixture.homeTeamId, fixture.awayTeamId],
                isRecurring: false,
                notes: fixture.stage ? `Round ${fixture.round} — ${fixture.stage}` : `Round ${fixture.round}`,
                createdAt: now,
                updatedAt: now,
              };

          return addEvent(event as ScheduledEvent);
        })
      );
      setPublished(true);
    } catch {
      setGenError('Failed to publish some events. Please check the schedule and try again.');
    } finally {
      setPublishing(false);
    }
  }

  // ─── Venue helpers ──────────────────────────────────────────────────────────

  function updateVenue(i: number, patch: Partial<WizardVenueInput>) {
    setVenues(vs => vs.map((v, idx) => idx === i ? { ...v, ...patch } : v));
  }

  function addWindow(venueIdx: number) {
    setVenues(vs => vs.map((v, i) =>
      i === venueIdx
        ? { ...v, availabilityWindows: [...v.availabilityWindows, { dayOfWeek: 6, startTime: '09:00', endTime: '17:00' }] }
        : v
    ));
  }

  function updateWindow(venueIdx: number, winIdx: number, patch: Partial<RecurringVenueWindow>) {
    setVenues(vs => vs.map((v, i) =>
      i === venueIdx
        ? { ...v, availabilityWindows: v.availabilityWindows.map((w, j) => j === winIdx ? { ...w, ...patch } : w) }
        : v
    ));
  }

  function removeWindow(venueIdx: number, winIdx: number) {
    setVenues(vs => vs.map((v, i) =>
      i === venueIdx
        ? { ...v, availabilityWindows: v.availabilityWindows.filter((_, j) => j !== winIdx) }
        : v
    ));
  }

  function addFallbackWindow(venueIdx: number) {
    setVenues(vs => vs.map((v, i) =>
      i === venueIdx
        ? { ...v, fallbackWindows: [...v.fallbackWindows, { dayOfWeek: 6, startTime: '09:00', endTime: '17:00' }] }
        : v
    ));
  }

  function updateFallbackWindow(venueIdx: number, winIdx: number, patch: Partial<RecurringVenueWindow>) {
    setVenues(vs => vs.map((v, i) =>
      i === venueIdx
        ? { ...v, fallbackWindows: v.fallbackWindows.map((w, j) => j === winIdx ? { ...w, ...patch } : w) }
        : v
    ));
  }

  function removeFallbackWindow(venueIdx: number, winIdx: number) {
    setVenues(vs => vs.map((v, i) =>
      i === venueIdx
        ? { ...v, fallbackWindows: v.fallbackWindows.filter((_, j) => j !== winIdx) }
        : v
    ));
  }

  function addVenueBlackout(i: number, date: string) {
    if (!date) return;
    setVenues(vs => vs.map((v, idx) =>
      idx === i && !v.blackoutDates.includes(date)
        ? { ...v, blackoutDates: [...v.blackoutDates, date].sort() }
        : v
    ));
  }

  function removeVenueBlackout(i: number, date: string) {
    setVenues(vs => vs.map((v, idx) =>
      idx === i ? { ...v, blackoutDates: v.blackoutDates.filter(d => d !== date) } : v
    ));
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
              <Select label="Format" value={format} onChange={e => setFormat(e.target.value as Format)} options={FORMAT_OPTIONS} />
              {format === 'group_then_knockout' && (
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Number of Groups" type="number" min="2" value={groupCount} onChange={e => setGroupCount(e.target.value)} />
                  <Input label="Teams Advancing per Group" type="number" min="1" value={groupAdvance} onChange={e => setGroupAdvance(e.target.value)} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Input label="Min Rest Days Between Games" type="number" min="0" value={minRestDays} onChange={e => setMinRestDays(e.target.value)} />
                <Input label="Max Consecutive Away Games" type="number" min="1" value={maxConsecAway} onChange={e => setMaxConsecAway(e.target.value)} />
              </div>
            </>
          )}
          {mode === 'playoff' && (
            <Select label="Format" value={playoffFormat} onChange={e => setPlayoffFormat(e.target.value as Format)} options={PLAYOFF_FORMAT_OPTIONS} />
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
          {venues.map((venue, i) => (
            <div key={i} className="border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                  <MapPin size={13} /> Venue {i + 1}
                </h4>
                {venues.length > 1 && (
                  <button onClick={() => {
                    setVenues(vs => vs.filter((_, idx) => idx !== i));
                    setFallbackExpanded(prev => prev.filter((_, idx) => idx !== i));
                  }} className="text-gray-400 hover:text-red-500 transition-colors">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Venue Name"
                  value={venue.name}
                  onChange={e => updateVenue(i, { name: e.target.value })}
                  placeholder="e.g. Riverside Park"
                  error={venueErrors[i]}
                />
                <Input
                  label={isPracticeMode ? 'Concurrent Courts' : 'Concurrent Pitches'}
                  type="number"
                  min="1"
                  value={String(venue.concurrentPitches)}
                  onChange={e => updateVenue(i, { concurrentPitches: parseInt(e.target.value) || 1 })}
                />
              </div>

              {/* Availability windows */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Availability Windows</p>
                <div className="space-y-2">
                  {venue.availabilityWindows.map((win, wi) => (
                    <div key={wi} className="flex items-center gap-2">
                      <Select
                        value={String(win.dayOfWeek)}
                        onChange={e => updateWindow(i, wi, { dayOfWeek: parseInt(e.target.value) })}
                        options={DAY_OPTIONS}
                      />
                      <Input
                        type="time"
                        value={win.startTime}
                        onChange={e => updateWindow(i, wi, { startTime: e.target.value })}
                      />
                      <span className="text-gray-400 text-sm flex-shrink-0">–</span>
                      <Input
                        type="time"
                        value={win.endTime}
                        onChange={e => updateWindow(i, wi, { endTime: e.target.value })}
                      />
                      {venue.availabilityWindows.length > 1 && (
                        <button onClick={() => removeWindow(i, wi)} className="text-gray-400 hover:text-red-500 flex-shrink-0">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={() => addWindow(i)} className="mt-2 text-xs text-blue-600 hover:underline flex items-center gap-1">
                  <Plus size={12} /> Add time window
                </button>
              </div>

              {/* Fallback time windows */}
              <div>
                <button
                  type="button"
                  onClick={() => setFallbackExpanded(prev => prev.map((v, idx) => idx === i ? !v : v))}
                  className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
                  aria-expanded={fallbackExpanded[i]}
                >
                  <ChevronDown
                    size={14}
                    className={`transition-transform ${fallbackExpanded[i] ? 'rotate-180' : ''}`}
                  />
                  Fallback Time Windows (optional)
                </button>
                {fallbackExpanded[i] && (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs text-gray-500">
                      Used only if primary windows can't fill the full schedule.
                    </p>
                    {venue.fallbackWindows.map((win, wi) => (
                      <div key={wi} className="flex items-center gap-2">
                        <Select
                          value={String(win.dayOfWeek)}
                          onChange={e => updateFallbackWindow(i, wi, { dayOfWeek: parseInt(e.target.value) })}
                          options={DAY_OPTIONS}
                        />
                        <Input
                          type="time"
                          value={win.startTime}
                          onChange={e => updateFallbackWindow(i, wi, { startTime: e.target.value })}
                        />
                        <span className="text-gray-400 text-sm flex-shrink-0">–</span>
                        <Input
                          type="time"
                          value={win.endTime}
                          onChange={e => updateFallbackWindow(i, wi, { endTime: e.target.value })}
                        />
                        <button onClick={() => removeFallbackWindow(i, wi)} className="text-gray-400 hover:text-red-500 flex-shrink-0">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => addFallbackWindow(i)} className="mt-1 text-xs text-blue-600 hover:underline flex items-center gap-1">
                      <Plus size={12} /> Add fallback window
                    </button>
                  </div>
                )}
              </div>

              {/* Venue blackout dates */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1.5">Venue Blackout Dates</p>
                <input
                  type="date"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onChange={e => { addVenueBlackout(i, e.target.value); e.target.value = ''; }}
                />
                {venue.blackoutDates.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {venue.blackoutDates.map(d => (
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
          <Button variant="secondary" onClick={() => {
            setVenues(vs => [...vs, newVenue()]);
            setFallbackExpanded(prev => [...prev, false]);
          }}>
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

      {/* ── Generating ───────────────────────────────────────────────────────── */}
      {step === 'generate' && (
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
                  {result.stats.assignedFixtures}/{result.stats.totalFixtures} {isPracticeMode ? 'sessions' : 'fixtures'} scheduled
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
                  {fallbackFixtures.length} of {result.stats.totalFixtures} fixture{result.stats.totalFixtures !== 1 ? 's' : ''} scheduled in fallback time windows
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
                  {isPracticeMode ? 'Practices Published!' : 'Schedule Published!'}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  {result?.stats.assignedFixtures} {isPracticeMode ? 'practice sessions' : 'fixtures'} added to the calendar.
                </p>
              </div>
              <Button onClick={onClose}>Done</Button>
            </div>
          ) : (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
                <p className="text-sm font-semibold text-blue-900 flex items-center gap-2">
                  <Wand2 size={15} /> Ready to publish
                </p>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• {result?.stats.assignedFixtures} {isPracticeMode ? 'practice sessions' : 'fixtures'} will be added to the calendar</li>
                  <li>• Events will appear immediately in team and league calendars</li>
                  <li>• Coaches and players can view and RSVP right away</li>
                  {result && result.stats.unassignedFixtures > 0 && (
                    <li className="text-amber-700">• {result.stats.unassignedFixtures} {isPracticeMode ? 'session' : 'fixture'}{result.stats.unassignedFixtures !== 1 ? 's' : ''} could not be scheduled</li>
                  )}
                </ul>
              </div>
              {genError && <p className="text-sm text-red-600">{genError}</p>}
            </>
          )}
        </div>
      )}

      {/* ── Navigation ───────────────────────────────────────────────────────── */}
      {!published && step !== 'generate' && step !== 'mode' && (
        <div className="flex justify-between pt-4 mt-4 border-t border-gray-100">
          <Button variant="secondary" onClick={goBack} disabled={publishing}>
            <ChevronLeft size={16} /> {currentStepIdx === 0 ? 'Change Mode' : 'Back'}
          </Button>

          {step === 'preview' ? (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => { setStep('blackouts'); setResult(null); }}>
                Regenerate
              </Button>
              <Button onClick={goNext} disabled={!canPublish}>
                Next <ChevronRight size={16} />
              </Button>
            </div>
          ) : step === 'publish' ? (
            <Button onClick={() => void handlePublish()} disabled={publishing || !canPublish}>
              {publishing ? <><Loader2 size={14} className="animate-spin" /> Publishing…</> : `Publish ${isPracticeMode ? 'Practices' : 'Schedule'}`}
            </Button>
          ) : (
            <Button
              onClick={goNext}
              disabled={step === 'availability' && availabilityOption === 'collect' && !collectionDueDate}
            >
              {step === 'blackouts'
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
  );
}
