import { useState, useEffect, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { getFunctions } from 'firebase/functions';
import {
  Calendar, MapPin, Users, Wand2, CheckCircle2, AlertTriangle,
  AlertCircle, ChevronLeft, ChevronRight, Plus, Trash2, Loader2, Search,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useEventStore } from '@/store/useEventStore';
import { useVenueStore } from '@/store/useVenueStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { Venue, RecurringVenueWindow } from '@/types/venue';
import type { League, Team, ScheduledEvent } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

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
  venue: string;
  stage?: string;
}

interface ScheduleConflict {
  severity: 'hard' | 'soft';
  description: string;
  constraintId?: string;
}

interface ScheduleOutput {
  fixtures: GeneratedFixture[];
  conflicts: ScheduleConflict[];
  stats: {
    totalFixtures: number;
    assignedFixtures: number;
    unassignedFixtures: number;
    feasible: boolean;
  };
  summary: string;
}

type Step = 'config' | 'venues' | 'blackouts' | 'generate' | 'preview' | 'publish';
type Format = 'single_round_robin' | 'double_round_robin' | 'single_elimination' | 'double_elimination' | 'group_then_knockout';

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const FORMAT_OPTIONS = [
  { value: 'single_round_robin', label: 'Single Round-Robin (each pair plays once)' },
  { value: 'double_round_robin', label: 'Double Round-Robin (home & away)' },
  { value: 'single_elimination', label: 'Single Elimination (knockout)' },
  { value: 'double_elimination', label: 'Double Elimination (2 losses to exit)' },
  { value: 'group_then_knockout', label: 'Group Stage + Knockout' },
];

const generateScheduleFn = httpsCallable<object, ScheduleOutput>(getFunctions(), 'generateLeagueSchedule');

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const windows = saved.defaultAvailabilityWindows ?? [];
  const days = windows.length > 0
    ? [...new Set(windows.map(w => DAY_NAMES[w.dayOfWeek]))]
    : ['Saturday', 'Sunday'];
  const firstWindow = windows[0];
  return {
    selectedVenueId: saved.id,
    name: saved.name,
    concurrentPitches: saved.fields?.length ?? 1,
    availableDays: days,
    availableTimeStart: firstWindow?.startTime ?? '09:00',
    availableTimeEnd: firstWindow?.endTime ?? '17:00',
    blackoutDates: saved.defaultBlackoutDates ?? [],
    availabilityWindows: windows,
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
}

export function ScheduleWizardModal({ open, onClose, league, leagueTeams }: Props) {
  const { addEvent } = useEventStore();
  const user = useAuthStore(s => s.user);

  // Venue store
  const savedVenues = useVenueStore(s => s.venues);
  const subscribeVenues = useVenueStore(s => s.subscribe);
  const addVenueToLib = useVenueStore(s => s.addVenue);

  useEffect(() => {
    const unsub = subscribeVenues();
    return unsub;
  }, [subscribeVenues]);

  // Step
  const [step, setStep] = useState<Step>('config');

  // Step 1 — config
  const [seasonStart, setSeasonStart] = useState('');
  const [seasonEnd, setSeasonEnd] = useState('');
  const [matchDuration, setMatchDuration] = useState('60');
  const [bufferMinutes, setBufferMinutes] = useState('15');
  const [format, setFormat] = useState<Format>('single_round_robin');
  const [minRestDays, setMinRestDays] = useState('6');
  const [maxConsecAway, setMaxConsecAway] = useState('2');
  const [groupCount, setGroupCount] = useState('2');
  const [groupAdvance, setGroupAdvance] = useState('2');

  // Step 2 — venues (WizardVenueConfig replaces VenueInput)
  const [venueConfigs, setVenueConfigs] = useState<WizardVenueConfig[]>([newVenueConfig()]);

  // Quick-create modal state
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreateTargetIdx, setQuickCreateTargetIdx] = useState<number | null>(null);

  // Per-venue blackout input state (one input per venue card)
  const [venueBlackoutInputs, setVenueBlackoutInputs] = useState<string[]>(['']);

  // Step 3 — blackout dates
  const [seasonBlackouts, setSeasonBlackouts] = useState<string[]>([]);
  const [blackoutInput, setBlackoutInput] = useState('');

  // Step 4/5 — generation & preview
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [result, setResult] = useState<ScheduleOutput | null>(null);

  // Step 6 — publish
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  // Validation
  const [configError, setConfigError] = useState('');
  const [venueErrors, setVenueErrors] = useState<string[]>([]);

  // ─── Step Helpers ───────────────────────────────────────────────────────────

  function validateConfig(): boolean {
    if (!seasonStart || !seasonEnd) { setConfigError('Season start and end dates are required.'); return false; }
    if (seasonStart >= seasonEnd) { setConfigError('Season end must be after start date.'); return false; }
    if (!matchDuration || parseInt(matchDuration) < 10) { setConfigError('Match duration must be at least 10 minutes.'); return false; }
    setConfigError('');
    return true;
  }

  function validateVenues(): boolean {
    const errs = venueConfigs.map(v => {
      if (!v.name.trim()) return 'Venue name is required.';
      if (!v.availableDays.length) return 'Select at least one available day.';
      if (v.availableTimeStart >= v.availableTimeEnd) return 'End time must be after start time.';
      return '';
    });
    setVenueErrors(errs);
    return errs.every(e => !e);
  }

  function goNext() {
    if (step === 'config') { if (!validateConfig()) return; setStep('venues'); }
    else if (step === 'venues') { if (!validateVenues()) return; setStep('blackouts'); }
    else if (step === 'blackouts') { setStep('generate'); handleGenerate(); }
    else if (step === 'preview') setStep('publish');
  }

  function goBack() {
    if (step === 'venues') setStep('config');
    else if (step === 'blackouts') setStep('venues');
    else if (step === 'generate' || step === 'preview') { setStep('blackouts'); setResult(null); setGenError(''); }
    else if (step === 'publish') setStep('preview');
  }

  // ─── Venue config helpers ───────────────────────────────────────────────────

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

  // ─── Generate ──────────────────────────────────────────────────────────────

  async function handleGenerate() {
    setGenerating(true);
    setGenError('');
    setResult(null);
    setStep('generate');
    try {
      const venues = venueConfigs.map(vc => {
        const days = vc.availabilityWindows.length > 0
          ? [...new Set(vc.availabilityWindows.map(w => DAY_NAMES[w.dayOfWeek]))]
          : vc.availableDays;
        const firstWindow = vc.availabilityWindows[0];
        return {
          name: vc.name,
          concurrentPitches: vc.concurrentPitches,
          availableDays: days,
          availableTimeStart: firstWindow?.startTime ?? vc.availableTimeStart,
          availableTimeEnd: firstWindow?.endTime ?? vc.availableTimeEnd,
          availabilityWindows: vc.availabilityWindows,
          blackoutDates: vc.blackoutDates,
        };
      });

      const { data } = await generateScheduleFn({
        leagueId: league.id,
        leagueName: league.name,
        seasonStart,
        seasonEnd,
        matchDurationMinutes: parseInt(matchDuration),
        bufferMinutes: parseInt(bufferMinutes),
        format,
        teams: leagueTeams.map(t => ({
          id: t.id,
          name: t.name,
          homeVenue: venues.length === 1 ? venues[0].name : undefined,
        })),
        venues,
        blackoutDates: seasonBlackouts,
        minRestDays: parseInt(minRestDays),
        maxConsecutiveAway: parseInt(maxConsecAway),
        ...(format === 'group_then_knockout' ? { groupCount: parseInt(groupCount), groupAdvance: parseInt(groupAdvance) } : {}),
      });
      setResult(data);
      setStep('preview');
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Schedule generation failed.';
      setGenError(msg);
    } finally {
      setGenerating(false);
    }
  }

  // ─── Publish ───────────────────────────────────────────────────────────────

  async function handlePublish() {
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
          const matchedConfig = venueConfigs.find(vc => vc.name === fixture.venue);
          const event: Omit<ScheduledEvent, 'id'> = {
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
            ...(matchedConfig?.selectedVenueId ? (() => {
              const selectedVenue = savedVenues.find(v => v.id === matchedConfig.selectedVenueId);
              return {
                venueId: matchedConfig.selectedVenueId,
                ...(selectedVenue?.lat != null && selectedVenue?.lng != null ? {
                  venueLat: selectedVenue.lat,
                  venueLng: selectedVenue.lng,
                } : {}),
              };
            })() : {}),
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

  // ─── Render helpers ─────────────────────────────────────────────────────────

  const hardConflicts = result?.conflicts.filter(c => c.severity === 'hard') ?? [];
  const softConflicts = result?.conflicts.filter(c => c.severity === 'soft') ?? [];
  const canPublish = result && hardConflicts.length === 0;

  const stepLabels: Record<Step, string> = {
    config: 'Season Setup',
    venues: 'Venues',
    blackouts: 'Blackout Dates',
    generate: 'Generating…',
    preview: 'Preview',
    publish: 'Publish',
  };

  const steps: Step[] = ['config', 'venues', 'blackouts', 'generate', 'preview', 'publish'];
  const currentStepIdx = steps.indexOf(step);

  // Suppress unused var warning — addVenueToLib is used in QuickCreateVenueModal via store
  void addVenueToLib;

  return (
    <>
      <Modal open={open} onClose={onClose} title="Schedule Wizard" size="lg">
        {/* Progress bar */}
        <div className="flex items-center gap-1 mb-6 -mt-1">
          {steps.filter(s => s !== 'generate').map((s) => {
            const visibleIdx = steps.filter(x => x !== 'generate').indexOf(s);
            const isActive = s === step || (step as string) === 'generate' && s === 'blackouts';
            const isDone = currentStepIdx > steps.indexOf(s) && (s as string) !== 'generate';
            return (
              <div key={s} className="flex items-center gap-1 flex-1">
                <div className={`h-1.5 flex-1 rounded-full transition-colors ${isDone ? 'bg-blue-600' : isActive ? 'bg-blue-400' : 'bg-gray-200'}`} />
                {visibleIdx < 4 && <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isDone ? 'bg-blue-600' : isActive ? 'bg-blue-400' : 'bg-gray-300'}`} />}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-gray-400 mb-4 -mt-3 text-right">{stepLabels[step]}</p>

        {/* ── Step 1: Config ── */}
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
            <Select
              label="Format"
              value={format}
              onChange={e => setFormat(e.target.value as Format)}
              options={FORMAT_OPTIONS}
            />
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
            <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700 flex items-start gap-2">
              <Users size={15} className="flex-shrink-0 mt-0.5" />
              <span>{leagueTeams.length} team{leagueTeams.length !== 1 ? 's' : ''} in this league will be scheduled: {leagueTeams.map(t => t.name).join(', ')}</span>
            </div>
            {configError && <p className="text-xs text-red-600">{configError}</p>}
          </div>
        )}

        {/* ── Step 2: Venues ── */}
        {step === 'venues' && (
          <div className="space-y-4">
            {venueConfigs.map((venueConfig, i) => (
              <div key={i} className="border border-gray-200 rounded-xl p-4 space-y-3">
                {/* Card header */}
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                    <MapPin size={13} /> Venue {i + 1}
                  </h4>
                  {venueConfigs.length > 1 && (
                    <button
                      onClick={() => removeVenueCard(i)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                    >
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
                    label="Concurrent Pitches"
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

        {/* ── Step 3: Blackout Dates ── */}
        {step === 'blackouts' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Add season-wide blackout dates — no games will be scheduled on these dates for any team or venue (e.g. bank holidays, school holidays).</p>
            <div className="flex gap-2">
              <Input
                type="date"
                value={blackoutInput}
                onChange={e => setBlackoutInput(e.target.value)}
                className="flex-1"
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

        {/* ── Step 4: Generating ── */}
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
                <Button onClick={handleGenerate}>Try Again</Button>
              </>
            ) : null}
          </div>
        )}

        {/* ── Step 5: Preview ── */}
        {step === 'preview' && result && (
          <div className="space-y-4">
            {/* Stats bar */}
            <div className={`rounded-lg p-3 border text-sm ${result.stats.feasible ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-start gap-2">
                {result.stats.feasible
                  ? <CheckCircle2 size={16} className="text-green-600 flex-shrink-0 mt-0.5" />
                  : <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                }
                <div>
                  <p className={`font-medium ${result.stats.feasible ? 'text-green-800' : 'text-amber-800'}`}>
                    {result.stats.assignedFixtures}/{result.stats.totalFixtures} fixtures scheduled
                    {result.stats.unassignedFixtures > 0 && ` · ${result.stats.unassignedFixtures} unassigned`}
                  </p>
                  <p className="text-gray-600 mt-0.5">{result.summary}</p>
                </div>
              </div>
            </div>

            {/* Conflicts */}
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

            {/* Fixture list */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Fixtures</p>
              <div className="border border-gray-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Date</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Time</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Home</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Away</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium hidden sm:table-cell">Venue</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium hidden sm:table-cell">Stage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {result.fixtures.map((f, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{f.date}</td>
                        <td className="px-3 py-2 text-gray-700">{f.startTime}</td>
                        <td className="px-3 py-2 font-medium text-gray-900">{f.homeTeamName}</td>
                        <td className="px-3 py-2 text-gray-700">{f.awayTeamName}</td>
                        <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">{f.venue}</td>
                        <td className="px-3 py-2 text-gray-400 hidden sm:table-cell">{f.stage ?? `Rd ${f.round}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {!canPublish && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                Publishing is blocked until all hard constraint violations are resolved. Adjust your inputs and regenerate.
              </div>
            )}
          </div>
        )}

        {/* ── Step 6: Publish ── */}
        {step === 'publish' && (
          <div className="space-y-4">
            {published ? (
              <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
                <CheckCircle2 size={48} className="text-green-500" />
                <div>
                  <p className="text-lg font-bold text-gray-900">Schedule Published!</p>
                  <p className="text-sm text-gray-500 mt-1">{result?.stats.assignedFixtures} fixtures added to the league calendar.</p>
                </div>
                <Button onClick={onClose}>Done</Button>
              </div>
            ) : (
              <>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
                  <p className="text-sm font-semibold text-blue-900 flex items-center gap-2"><Wand2 size={15} /> Ready to publish</p>
                  <ul className="text-sm text-blue-800 space-y-1">
                    <li>• {result?.stats.assignedFixtures} fixtures will be added to the league schedule</li>
                    <li>• Events will appear immediately in team and league calendars</li>
                    <li>• Coaches and players can view and RSVP right away</li>
                    {result && result.stats.unassignedFixtures > 0 && (
                      <li className="text-amber-700">• {result.stats.unassignedFixtures} fixture{result.stats.unassignedFixtures !== 1 ? 's' : ''} could not be scheduled and will not be published</li>
                    )}
                  </ul>
                </div>
                {genError && <p className="text-sm text-red-600">{genError}</p>}
              </>
            )}
          </div>
        )}

        {/* Navigation */}
        {!published && step !== 'generate' && (
          <div className="flex justify-between pt-4 mt-4 border-t border-gray-100">
            <Button
              variant="secondary"
              onClick={step === 'config' ? onClose : goBack}
              disabled={publishing}
            >
              <ChevronLeft size={16} /> {step === 'config' ? 'Cancel' : 'Back'}
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
              <Button onClick={handlePublish} disabled={publishing || !canPublish}>
                {publishing ? <><Loader2 size={14} className="animate-spin" /> Publishing…</> : 'Publish Schedule'}
              </Button>
            ) : (step as string) !== 'generate' ? (
              <Button onClick={goNext}>
                {step === 'blackouts' ? <><Wand2 size={15} /> Generate</> : <>Next <ChevronRight size={16} /></>}
              </Button>
            ) : null}
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
