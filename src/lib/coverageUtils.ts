import type { CoachAvailabilityResponse } from '@/types';

export interface HeatmapDay {
  label: string;
  dayOfWeek: number;
}

export interface HeatmapSlot {
  label: string;
  start: string;
  end: string;
}

export const HEATMAP_DAYS: HeatmapDay[] = [
  { label: 'Mon', dayOfWeek: 1 },
  { label: 'Tue', dayOfWeek: 2 },
  { label: 'Wed', dayOfWeek: 3 },
  { label: 'Thu', dayOfWeek: 4 },
  { label: 'Fri', dayOfWeek: 5 },
  { label: 'Sat', dayOfWeek: 6 },
  { label: 'Sun', dayOfWeek: 0 },
];

export const HEATMAP_SLOTS: HeatmapSlot[] = [
  { label: 'Morning',   start: '06:00', end: '12:00' },
  { label: 'Afternoon', start: '12:00', end: '17:00' },
  { label: 'Evening',   start: '17:00', end: '23:59' },
];

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function windowOverlapsSlot(
  windowStart: string,
  windowEnd: string,
  slotStart: string,
  slotEnd: string,
): boolean {
  const ws = timeToMinutes(windowStart);
  const we = timeToMinutes(windowEnd);
  const ss = timeToMinutes(slotStart);
  const se = timeToMinutes(slotEnd);
  return ws < se && we > ss;
}

export interface CellCoverage {
  available: number;
  missingTeams: string[];
}

export function getCellCoverage(
  dayOfWeek: number,
  slot: HeatmapSlot,
  responses: CoachAvailabilityResponse[],
  allTeamIds: string[],
  teamNameById: Record<string, string>,
): CellCoverage {
  const coachesAvailable: string[] = [];
  const teamsWithCoverage = new Set<string>();

  for (const response of responses) {
    const coversSlot = response.weeklyWindows.some(
      w =>
        w.dayOfWeek === dayOfWeek &&
        w.available &&
        windowOverlapsSlot(w.startTime, w.endTime, slot.start, slot.end),
    );
    if (coversSlot) {
      coachesAvailable.push(response.coachUid);
      teamsWithCoverage.add(response.teamId);
    }
  }

  const missingTeamIds = allTeamIds.filter(id => !teamsWithCoverage.has(id));
  const missingTeams = missingTeamIds
    .map(id => teamNameById[id] ?? id)
    .filter((name, i, arr) => arr.indexOf(name) === i);

  return { available: coachesAvailable.length, missingTeams };
}

export interface TopSlot {
  dayLabel: string;
  slotLabel: string;
  ratio: number;
}

export function getTopCoverageSlots(
  responses: CoachAvailabilityResponse[],
  allTeamIds: string[],
  teamNameById: Record<string, string>,
  topN = 2,
): TopSlot[] {
  if (responses.length === 0) return [];

  const ranked: TopSlot[] = [];

  for (const day of HEATMAP_DAYS) {
    for (const slot of HEATMAP_SLOTS) {
      const cell = getCellCoverage(day.dayOfWeek, slot, responses, allTeamIds, teamNameById);
      ranked.push({
        dayLabel: day.label,
        slotLabel: slot.label,
        ratio: cell.available / responses.length,
      });
    }
  }

  ranked.sort((a, b) => b.ratio - a.ratio);
  return ranked.slice(0, topN).filter(s => s.ratio > 0);
}
