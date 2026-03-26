import { useEffect, useState } from 'react';
import { addDays, parseISO, format, differenceInDays } from 'date-fns';
import { Zap, CheckCircle2, AlertTriangle, Eye, EyeOff, Send } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useVenueStore } from '@/store/useVenueStore';
import { useBlackoutStore } from '@/store/useBlackoutStore';
import { useCoachAvailabilityStore } from '@/store/useCoachAvailabilityStore';
import { useScheduleStore } from '@/store/useScheduleStore';
import { useEventStore } from '@/store/useEventStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import type {
  ScheduledEvent, Venue, LeagueBlackout, CoachAvailability,
  LeagueSchedule, ScheduleParameters, Team,
} from '@/types';

interface ConflictEntry {
  homeTeam: string;
  awayTeam: string;
  reason: string;
}

interface Props {
  leagueId: string;
}

// ---- Constraint helpers ----

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function addMins(t: string, mins: number): string {
  const total = toMinutes(t) + mins;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isBlackedOut(date: string, venueId: string, blackouts: LeagueBlackout[]): boolean {
  return blackouts.some(b =>
    date >= b.startDate && date <= b.endDate &&
    (!b.venueId || b.venueId === venueId)
  );
}

function venueAvailableOn(date: string, startTime: string, endTime: string, venue: Venue): boolean {
  if (!venue.isActive) return false;
  const dow = parseISO(date).getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  return venue.availabilitySlots.some(slot =>
    slot.dayOfWeek === dow &&
    slot.startTime <= startTime &&
    slot.endTime >= endTime
  );
}

function coachUnavailable(date: string, sub: CoachAvailability | undefined): boolean {
  if (!sub) return false;
  return sub.unavailableDates.some(r => date >= r.startDate && date <= r.endDate);
}

function venueCapacityExceeded(date: string, startTime: string, endTime: string, venueId: string, assigned: ScheduledEvent[], capacity: number): boolean {
  const overlap = assigned.filter(e =>
    e.venueId === venueId &&
    e.date === date &&
    toMinutes(startTime) < toMinutes(e.endTime ?? addMins(e.startTime, 90)) &&
    toMinutes(e.startTime) < toMinutes(endTime)
  );
  return overlap.length >= capacity;
}

function teamLastGame(teamId: string, beforeDate: string, assigned: ScheduledEvent[]): string | null {
  const games = assigned.filter(e => e.teamIds.includes(teamId) && e.date < beforeDate);
  if (games.length === 0) return null;
  return games.sort((a, b) => b.date.localeCompare(a.date))[0].date;
}

function preferenceScore(date: string, startTime: string, homeAvail: CoachAvailability | undefined, awayAvail: CoachAvailability | undefined): number {
  let score = 0;
  const dow = parseISO(date).getDay();
  for (const sub of [homeAvail, awayAvail]) {
    if (!sub) continue;
    if (sub.preferredDaysOfWeek.includes(dow)) score += 2;
    if (sub.preferredDates.some(r => date >= r.startDate && date <= r.endDate)) score += 2;
    if (sub.preferredTimeStart && sub.preferredTimeEnd) {
      const slotStart = toMinutes(startTime);
      const prefStart = toMinutes(sub.preferredTimeStart);
      const prefEnd = toMinutes(sub.preferredTimeEnd);
      if (slotStart >= prefStart && slotStart < prefEnd) score += 1;
    }
  }
  return score;
}

// ---- Generator ----

interface Slot { date: string; startTime: string; endTime: string; venueId: string; }

function generateSchedule(
  teams: Team[],
  venues: Venue[],
  blackouts: LeagueBlackout[],
  submissions: CoachAvailability[],
  params: ScheduleParameters,
  scheduleId: string,
): { events: ScheduledEvent[]; conflicts: ConflictEntry[] } {
  const { seasonStart, seasonEnd, gameDurationMinutes, rounds, minGapDays } = params;
  const events: ScheduledEvent[] = [];
  const conflicts: ConflictEntry[] = [];
  const now = new Date().toISOString();

  // Build all fixtures (home/away pairs)
  const fixtures: Array<{ homeId: string; awayId: string }> = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      for (let r = 0; r < rounds; r++) {
        if (r % 2 === 0) {
          fixtures.push({ homeId: teams[i].id, awayId: teams[j].id });
        } else {
          fixtures.push({ homeId: teams[j].id, awayId: teams[i].id });
        }
      }
    }
  }

  // Shuffle fixtures to reduce bias
  for (let i = fixtures.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [fixtures[i], fixtures[j]] = [fixtures[j], fixtures[i]];
  }

  // Build candidate time slots across season
  function buildSlots(): Slot[] {
    const slots: Slot[] = [];
    let current = parseISO(seasonStart);
    const end = parseISO(seasonEnd);
    while (current <= end) {
      const dateStr = format(current, 'yyyy-MM-dd');
      const dow = current.getDay();
      for (const venue of venues) {
        if (!venue.isActive) continue;
        for (const slot of venue.availabilitySlots) {
          if (slot.dayOfWeek !== dow) continue;
          // Walk through start times within the window
          let t = slot.startTime;
          while (toMinutes(t) + gameDurationMinutes <= toMinutes(slot.endTime)) {
            slots.push({ date: dateStr, startTime: t, endTime: addMins(t, gameDurationMinutes), venueId: venue.id });
            t = addMins(t, gameDurationMinutes);
          }
        }
      }
      current = addDays(current, 1);
    }
    return slots;
  }

  const allSlots = buildSlots();

  for (const fixture of fixtures) {
    const homeTeam = teams.find(t => t.id === fixture.homeId)!;
    const awayTeam = teams.find(t => t.id === fixture.awayId)!;
    const homeSub = submissions.find(s => s.teamId === fixture.homeId);
    const awaySub = submissions.find(s => s.teamId === fixture.awayId);

    let bestSlot: Slot | null = null;
    let bestScore = -1;

    for (const slot of allSlots) {
      const venue = venues.find(v => v.id === slot.venueId)!;

      // Hard constraints
      if (isBlackedOut(slot.date, slot.venueId, blackouts)) continue;
      if (!venueAvailableOn(slot.date, slot.startTime, slot.endTime, venue)) continue;
      if (coachUnavailable(slot.date, homeSub)) continue;
      if (coachUnavailable(slot.date, awaySub)) continue;
      if (venueCapacityExceeded(slot.date, slot.startTime, slot.endTime, slot.venueId, events, venue.capacity)) continue;

      // Team rest gap
      const homeLastGame = teamLastGame(fixture.homeId, slot.date, events);
      const awayLastGame = teamLastGame(fixture.awayId, slot.date, events);
      if (homeLastGame && differenceInDays(parseISO(slot.date), parseISO(homeLastGame)) < minGapDays) continue;
      if (awayLastGame && differenceInDays(parseISO(slot.date), parseISO(awayLastGame)) < minGapDays) continue;

      // Soft score
      const score = preferenceScore(slot.date, slot.startTime, homeSub, awaySub);
      if (score > bestScore) {
        bestScore = score;
        bestSlot = slot;
      }
    }

    if (bestSlot) {
      const venue = venues.find(v => v.id === bestSlot!.venueId)!;
      events.push({
        id: crypto.randomUUID(),
        title: `${homeTeam.name} vs ${awayTeam.name}`,
        type: 'game',
        status: 'draft',
        date: bestSlot.date,
        startTime: bestSlot.startTime,
        endTime: bestSlot.endTime,
        duration: gameDurationMinutes,
        location: venue.name,
        homeTeamId: fixture.homeId,
        awayTeamId: fixture.awayId,
        teamIds: [fixture.homeId, fixture.awayId],
        venueId: bestSlot.venueId,
        scheduleId,
        isRecurring: false,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      conflicts.push({
        homeTeam: homeTeam.name,
        awayTeam: awayTeam.name,
        reason: 'No valid slot found — check venue availability, blackouts, and coach constraints',
      });
    }
  }

  return { events, conflicts };
}

// ---- Component ----

export function ScheduleGeneratorPanel({ leagueId }: Props) {
  const venues = useVenueStore(s => s.venues).filter(v => v.leagueId === leagueId);
  const blackouts = useBlackoutStore(s => s.blackouts).filter(b => b.leagueId === leagueId);
  const submissions = useCoachAvailabilityStore(s => s.submissions).filter(s => s.leagueId === leagueId);
  const { schedules, subscribe: subSchedules, saveSchedule } = useScheduleStore();
  const { events: allEvents, bulkAddEvents, updateEvent, deleteEvent } = useEventStore();
  const allTeams = useTeamStore(s => s.teams);
  const profile = useAuthStore(s => s.profile);
  const uid = useAuthStore(s => s.user?.uid) ?? '';
  const addNotification = useNotificationStore(s => s.addNotification);

  useEffect(() => {
    const unsub = subSchedules(leagueId);
    return unsub;
  }, [leagueId, subSchedules]);

  const leagueTeams = allTeams.filter(t => t.leagueId === leagueId);
  const leagueSchedules = schedules.filter(s => s.leagueId === leagueId);
  const draftSchedule = leagueSchedules.find(s => s.status === 'draft');
  const publishedSchedule = leagueSchedules.find(s => s.status === 'published');
  const draftEvents = draftSchedule ? allEvents.filter(e => e.scheduleId === draftSchedule.id && e.status === 'draft') : [];

  const [seasonStart, setSeasonStart] = useState('');
  const [seasonEnd, setSeasonEnd] = useState('');
  const [gameDuration, setGameDuration] = useState(90);
  const [rounds, setRounds] = useState(2);
  const [minGap, setMinGap] = useState(5);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [showDraft, setShowDraft] = useState(true);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const canManage = profile?.role === 'admin' || profile?.role === 'league_manager';

  function validate() {
    const e: Record<string, string> = {};
    if (!seasonStart) e.seasonStart = 'Required';
    if (!seasonEnd) e.seasonEnd = 'Required';
    if (seasonEnd && seasonStart && seasonEnd <= seasonStart) e.seasonEnd = 'Must be after start';
    if (venues.filter(v => v.isActive).length === 0) e.venues = 'At least one active venue is required';
    if (leagueTeams.length < 2) e.teams = 'At least 2 teams are required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleGenerate() {
    if (!validate()) return;
    setGenerating(true);

    // Delete any existing draft events
    if (draftSchedule) {
      await Promise.all(draftEvents.map(e => deleteEvent(e.id)));
    }

    const scheduleId = draftSchedule?.id ?? crypto.randomUUID();
    const params: ScheduleParameters = {
      seasonStart,
      seasonEnd,
      gameDurationMinutes: gameDuration,
      rounds,
      minGapDays: minGap,
    };

    const { events, conflicts: newConflicts } = generateSchedule(
      leagueTeams,
      venues.filter(v => v.isActive),
      blackouts,
      submissions,
      params,
      scheduleId,
    );

    const now = new Date().toISOString();
    const schedule: LeagueSchedule = {
      id: scheduleId,
      leagueId,
      status: 'draft',
      parameters: params,
      generatedAt: now,
      createdBy: uid,
      createdAt: draftSchedule?.createdAt ?? now,
      updatedAt: now,
    };

    await saveSchedule(schedule);
    if (events.length > 0) await bulkAddEvents(events);
    setConflicts(newConflicts);
    setGenerating(false);
  }

  async function handlePublish() {
    if (!draftSchedule) return;
    setPublishing(true);
    const now = new Date().toISOString();

    // Archive currently published schedule
    if (publishedSchedule) {
      await saveSchedule({ ...publishedSchedule, status: 'archived', updatedAt: now });
    }

    // Publish all draft events
    await Promise.all(draftEvents.map(e => updateEvent({ ...e, status: 'scheduled', updatedAt: now })));

    // Update schedule record
    await saveSchedule({ ...draftSchedule, status: 'published', publishedAt: now, updatedAt: now });

    // Notify all coaches
    for (let i = 0; i < leagueTeams.length; i++) {
      await addNotification({
        id: crypto.randomUUID(),
        type: 'schedule_published',
        title: 'League Schedule Published',
        message: `The schedule for your league has been published. ${draftEvents.length} games have been added to the calendar.`,
        isRead: false,
        createdAt: now,
      });
    }

    setPublishing(false);
    setConfirmPublish(false);
  }

  async function handleUnpublish() {
    if (!publishedSchedule) return;
    const now = new Date().toISOString();
    const publishedEvents = allEvents.filter(e => e.scheduleId === publishedSchedule.id && e.status === 'scheduled');
    await Promise.all(publishedEvents.map(e => updateEvent({ ...e, status: 'draft', updatedAt: now })));
    await saveSchedule({ ...publishedSchedule, status: 'draft', publishedAt: undefined, updatedAt: now });
    for (let i = 0; i < leagueTeams.length; i++) {
      await addNotification({
        id: crypto.randomUUID(),
        type: 'schedule_retracted',
        title: 'League Schedule Retracted',
        message: 'The league schedule has been retracted for revision. Please check back for updates.',
        isRead: false,
        createdAt: now,
      });
    }
  }

  const activeVenues = venues.filter(v => v.isActive);

  return (
    <div className="space-y-4">
      {/* Validation errors */}
      {(errors.venues || errors.teams) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 space-y-1">
          {errors.venues && <p>• {errors.venues}</p>}
          {errors.teams && <p>• {errors.teams}</p>}
        </div>
      )}

      {/* Published schedule status */}
      {publishedSchedule && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-green-600" />
            <span className="text-sm font-medium text-green-800">
              Schedule published · {allEvents.filter(e => e.scheduleId === publishedSchedule.id && e.status === 'scheduled').length} games
            </span>
          </div>
          {canManage && (
            <Button size="sm" variant="secondary" onClick={() => void handleUnpublish()}>Retract</Button>
          )}
        </div>
      )}

      {/* Generator form */}
      {canManage && !publishedSchedule && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">Schedule Parameters</h3>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Season Start" type="date" value={seasonStart} onChange={e => setSeasonStart(e.target.value)} error={errors.seasonStart} />
              <Input label="Season End" type="date" value={seasonEnd} onChange={e => setSeasonEnd(e.target.value)} error={errors.seasonEnd} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Input
                label="Game Duration (min)"
                type="number"
                value={String(gameDuration)}
                onChange={e => setGameDuration(Math.max(1, parseInt(e.target.value, 10) || 90))}
              />
              <Input
                label="Rounds"
                type="number"
                value={String(rounds)}
                onChange={e => setRounds(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
              <Input
                label="Min Days Between Games"
                type="number"
                value={String(minGap)}
                onChange={e => setMinGap(Math.max(0, parseInt(e.target.value, 10) || 0))}
              />
            </div>

            <div className="text-xs text-gray-500 space-y-0.5 pt-1">
              <p>Using {activeVenues.length} active venue{activeVenues.length !== 1 ? 's' : ''} · {leagueTeams.length} teams · {Math.floor(leagueTeams.length * (leagueTeams.length - 1) / 2 * rounds)} fixtures to schedule</p>
            </div>

            <div className="flex gap-2 pt-1">
              {draftSchedule ? (
                <Button variant="secondary" onClick={() => setConfirmRegenerate(true)} disabled={generating}>
                  <Zap size={14} /> Regenerate Draft
                </Button>
              ) : (
                <Button onClick={() => void handleGenerate()} disabled={generating}>
                  <Zap size={14} /> {generating ? 'Generating…' : 'Generate Draft Schedule'}
                </Button>
              )}
              {draftSchedule && (
                <Button onClick={() => setConfirmPublish(true)} disabled={publishing || draftEvents.length === 0}>
                  <Send size={14} /> Publish Schedule
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Conflicts */}
      {conflicts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={15} className="text-amber-600" />
            <p className="text-sm font-semibold text-amber-800">{conflicts.length} unscheduled fixture{conflicts.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="space-y-1">
            {conflicts.map((c, i) => (
              <p key={i} className="text-xs text-amber-700">{c.homeTeam} vs {c.awayTeam} — {c.reason}</p>
            ))}
          </div>
        </div>
      )}

      {/* Draft events preview */}
      {draftSchedule && draftEvents.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-800">
              Draft Schedule — {draftEvents.length} game{draftEvents.length !== 1 ? 's' : ''}
            </p>
            <button
              type="button"
              onClick={() => setShowDraft(v => !v)}
              className="text-xs text-gray-500 flex items-center gap-1 hover:text-gray-800"
            >
              {showDraft ? <><EyeOff size={13} /> Hide</> : <><Eye size={13} /> Show</>}
            </button>
          </div>
          {showDraft && (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {draftEvents
                .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
                .map(e => {
                  const home = allTeams.find(t => t.id === e.homeTeamId);
                  const away = allTeams.find(t => t.id === e.awayTeamId);
                  return (
                    <div key={e.id} className="flex items-center gap-3 py-1.5 text-xs border-b border-gray-50 last:border-0">
                      <span className="text-gray-500 w-24 flex-shrink-0">{format(parseISO(e.date), 'EEE MMM d')}</span>
                      <span className="text-gray-500 w-12 flex-shrink-0">{e.startTime}</span>
                      <span className="flex-1 text-gray-800 font-medium">
                        <span className="inline-flex items-center gap-1">
                          {home && <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: home.color }} />}
                          {home?.name ?? 'TBD'}
                        </span>
                        {' vs '}
                        <span className="inline-flex items-center gap-1">
                          {away && <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: away.color }} />}
                          {away?.name ?? 'TBD'}
                        </span>
                      </span>
                      <span className="text-gray-400 flex-shrink-0">{e.location}</span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmRegenerate}
        onClose={() => setConfirmRegenerate(false)}
        onConfirm={async () => { setConfirmRegenerate(false); await handleGenerate(); }}
        title="Regenerate Draft Schedule"
        message="This will delete all existing draft games and create a new schedule. Published games are not affected."
      />

      <ConfirmDialog
        open={confirmPublish}
        onClose={() => setConfirmPublish(false)}
        onConfirm={() => void handlePublish()}
        title="Publish Schedule"
        message={`Publish ${draftEvents.length} game${draftEvents.length !== 1 ? 's' : ''} to the league calendar? All coaches will be notified.`}
      />
    </div>
  );
}
