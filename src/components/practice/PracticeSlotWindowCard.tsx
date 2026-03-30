import { useState } from 'react';
import { ChevronDown, ChevronUp, MapPin, Clock } from 'lucide-react';
import { PracticeSlotOccurrenceRow } from './PracticeSlotOccurrenceRow';
import type { PracticeSlotWindow, PracticeSlotSignup } from '@/types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  window: PracticeSlotWindow;
  signups: PracticeSlotSignup[];
  leagueId: string;
  seasonId: string;
  coachTeam: { id: string; name: string } | null;
  canManage: boolean;
  onAddBlackout?: (windowId: string, date: string) => void;
}

/**
 * Compute upcoming occurrence dates for a window starting from today,
 * up to 8 weeks out (or effectiveEnd, whichever comes first).
 */
function getOccurrences(window: PracticeSlotWindow): string[] {
  const blackouts = new Set(window.blackoutDates);
  const results: string[] = [];

  if (window.oneOffDate) {
    if (!blackouts.has(window.oneOffDate)) results.push(window.oneOffDate);
    return results;
  }

  if (window.dayOfWeek === null) return results;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(window.effectiveEnd + 'T00:00:00');
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + 56); // 8 weeks

  const start = new Date(window.effectiveStart + 'T00:00:00');
  const cur = start > today ? new Date(start) : new Date(today);

  // Advance to the first matching day of week on or after cur
  const diff = (window.dayOfWeek - cur.getDay() + 7) % 7;
  cur.setDate(cur.getDate() + diff);

  while (cur <= end && cur <= cutoff) {
    const iso = cur.toISOString().slice(0, 10);
    if (!blackouts.has(iso)) results.push(iso);
    cur.setDate(cur.getDate() + 7);
  }

  return results;
}

export function PracticeSlotWindowCard({
  window,
  signups,
  leagueId,
  seasonId,
  coachTeam,
  canManage,
  onAddBlackout,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const occurrences = getOccurrences(window);
  const dayLabel = window.oneOffDate
    ? new Date(window.oneOffDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
    : window.dayOfWeek !== null
    ? `${DAY_NAMES[window.dayOfWeek]}s`
    : '';

  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    paused: 'bg-amber-100 text-amber-700',
    archived: 'bg-gray-100 text-gray-500',
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Card header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-gray-900">{window.name}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[window.status]}`}>
              {window.status}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 flex-wrap">
            <span className="flex items-center gap-1">
              <MapPin size={11} /> {window.venueName}{window.fieldName ? ` — ${window.fieldName}` : ''}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={11} /> {dayLabel} {window.startTime}–{window.endTime}
            </span>
            <span>Capacity: {window.capacity}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
          <span className="text-xs text-gray-400">{occurrences.length} upcoming</span>
          {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </button>

      {/* Occurrences */}
      {expanded && (
        <div className="px-4 pb-3 border-t border-gray-100 bg-gray-50">
          {occurrences.length === 0 ? (
            <p className="text-xs text-gray-400 py-3">No upcoming occurrences in the next 8 weeks.</p>
          ) : (
            occurrences.map(date => {
              const occSignups = signups.filter(
                s => s.windowId === window.id && s.occurrenceDate === date && s.status !== 'cancelled',
              );
              return (
                <PracticeSlotOccurrenceRow
                  key={date}
                  leagueId={leagueId}
                  seasonId={seasonId}
                  windowId={window.id}
                  windowName={window.name}
                  occurrenceDate={date}
                  capacity={window.capacity}
                  signups={occSignups}
                  coachTeam={coachTeam}
                  canManage={canManage}
                  onAddBlackout={onAddBlackout ? (d) => onAddBlackout(window.id, d) : undefined}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
