import { useState } from 'react';
import { useCollectionStore } from '@/store/useCollectionStore';
import {
  SLOT_MORNING_START,
  SLOT_MORNING_END,
  SLOT_AFTERNOON_START,
  SLOT_AFTERNOON_END,
  SLOT_EVENING_START,
  SLOT_EVENING_END,
} from '@/lib/coverageUtils';
import type { CoachAvailabilityResponse } from '@/types';

interface Props {
  leagueId: string;
  collectionId: string;
  dueDate: string;
  coachUid: string;
  coachName: string;
  teamId: string;
  existingResponse?: CoachAvailabilityResponse;
  onClose: () => void;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Block = 'morning' | 'afternoon' | 'evening';

const BLOCKS: { id: Block; label: string; defaultStart: string; defaultEnd: string }[] = [
  { id: 'morning',   label: 'Morning',   defaultStart: SLOT_MORNING_START,   defaultEnd: SLOT_MORNING_END   },
  { id: 'afternoon', label: 'Afternoon', defaultStart: SLOT_AFTERNOON_START, defaultEnd: SLOT_AFTERNOON_END },
  { id: 'evening',   label: 'Evening',   defaultStart: SLOT_EVENING_START,   defaultEnd: SLOT_EVENING_END   },
];

interface DayBlock {
  available: boolean;
  startTime: string;
  endTime: string;
  customised: boolean; // true if user drilled into precise times
}

type GridState = Record<number, Record<Block, DayBlock>>;

function buildDefaultGrid(): GridState {
  const grid: GridState = {};
  for (let d = 0; d < 7; d++) {
    grid[d] = {} as Record<Block, DayBlock>;
    for (const b of BLOCKS) {
      grid[d][b.id] = { available: true, startTime: b.defaultStart, endTime: b.defaultEnd, customised: false };
    }
  }
  return grid;
}

function gridToWindows(grid: GridState) {
  const windows: CoachAvailabilityResponse['weeklyWindows'] = [];
  for (let d = 0; d < 7; d++) {
    for (const b of BLOCKS) {
      const cell = grid[d][b.id];
      windows.push({
        dayOfWeek: d,
        startTime: cell.startTime,
        endTime: cell.endTime,
        available: cell.available,
      });
    }
  }
  return windows;
}

export function CoachAvailabilityModal({
  leagueId,
  collectionId,
  dueDate,
  coachUid,
  coachName,
  teamId,
  existingResponse,
  onClose,
}: Props) {
  const { submitResponse } = useCollectionStore();

  const [grid, setGrid] = useState<GridState>(() => {
    if (existingResponse) {
      const g = buildDefaultGrid();
      for (const w of existingResponse.weeklyWindows) {
        const block = BLOCKS.find(b => b.defaultStart === w.startTime);
        if (block && g[w.dayOfWeek] !== undefined) {
          g[w.dayOfWeek][block.id] = {
            available: w.available,
            startTime: block.defaultStart,
            endTime: block.defaultEnd,
            customised: false,
          };
        }
      }
      return g;
    }
    return buildDefaultGrid();
  });

  const [dateOverrides, setDateOverrides] = useState<CoachAvailabilityResponse['dateOverrides']>(
    existingResponse?.dateOverrides ?? []
  );
  const [newOverrideStart, setNewOverrideStart] = useState('');
  const [newOverrideEnd, setNewOverrideEnd] = useState('');
  const [newOverrideReason, setNewOverrideReason] = useState('');
  const [customising, setCustomising] = useState<{ day: number; block: Block } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function toggleCell(day: number, block: Block) {
    setGrid(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [block]: { ...prev[day][block], available: !prev[day][block].available },
      },
    }));
  }

  function applyCustomTime(day: number, block: Block, startTime: string, endTime: string) {
    setGrid(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [block]: { ...prev[day][block], startTime, endTime, customised: true },
      },
    }));
    setCustomising(null);
  }

  function addOverride() {
    if (!newOverrideStart || !newOverrideEnd || newOverrideStart > newOverrideEnd) return;
    setDateOverrides(prev => [
      ...prev,
      { start: newOverrideStart, end: newOverrideEnd, available: false, reason: newOverrideReason || undefined },
    ]);
    setNewOverrideStart('');
    setNewOverrideEnd('');
    setNewOverrideReason('');
  }

  function removeOverride(idx: number) {
    setDateOverrides(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
    setSaving(true);
    setError('');
    try {
      await submitResponse(leagueId, collectionId, {
        coachUid,
        coachName,
        teamId,
        weeklyWindows: gridToWindows(grid),
        dateOverrides,
      });
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const availableCount = Object.values(grid).reduce((acc, day) =>
    acc + Object.values(day).filter(c => c.available).length, 0
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold text-gray-900">Submit Game Availability</h2>
          <p className="text-sm text-gray-500 mt-1">
            Tap a block to mark it unavailable. Due {new Date(dueDate).toLocaleDateString()}.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Weekly grid */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-800">Weekly Availability</h3>
              <span className="text-xs text-gray-500">{availableCount} of 21 blocks available</span>
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-8 gap-1 mb-1">
              <div /> {/* empty corner */}
              {DAYS.map(d => (
                <div key={d} className="text-center text-xs font-medium text-gray-500">{d}</div>
              ))}
            </div>

            {/* Rows */}
            {BLOCKS.map(block => (
              <div key={block.id} className="grid grid-cols-8 gap-1 mb-1">
                <div className="flex items-center text-xs text-gray-500 pr-1">{block.label}</div>
                {Array.from({ length: 7 }, (_, d) => {
                  const cell = grid[d][block.id];
                  return (
                    <div key={d} className="relative group">
                      <button
                        onClick={() => toggleCell(d, block.id)}
                        className={`w-full h-10 rounded text-xs font-medium transition-colors ${
                          cell.available
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-red-100 text-red-600 hover:bg-red-200'
                        }`}
                      >
                        {cell.available ? '✓' : '✗'}
                      </button>
                      {cell.available && (
                        <button
                          onClick={() => setCustomising({ day: d, block: block.id })}
                          className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 text-white rounded-full text-xs hidden group-hover:flex items-center justify-center"
                          title="Set precise time"
                        >
                          ✎
                        </button>
                      )}
                      {cell.customised && (
                        <div className="absolute bottom-0 left-0 right-0 text-center text-xs text-blue-600 truncate px-0.5">
                          {cell.startTime}–{cell.endTime}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            <p className="text-xs text-gray-400 mt-2">
              Green = available · Red = unavailable · Hover to set precise times
            </p>
          </div>

          {/* Precise time customiser */}
          {customising && (
            <div className="bg-blue-50 rounded-xl p-4 space-y-3">
              <p className="text-sm font-medium text-blue-800">
                Set precise time for {DAY_FULL[customising.day]}{' '}
                {BLOCKS.find(b => b.id === customising.block)?.label}
              </p>
              <div className="flex gap-3 items-center">
                <div>
                  <label className="text-xs text-gray-600">From</label>
                  <input
                    type="time"
                    defaultValue={grid[customising.day][customising.block].startTime}
                    id="custom-start"
                    className="block mt-1 border rounded px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600">To</label>
                  <input
                    type="time"
                    defaultValue={grid[customising.day][customising.block].endTime}
                    id="custom-end"
                    className="block mt-1 border rounded px-2 py-1 text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const start = (document.getElementById('custom-start') as HTMLInputElement).value;
                    const end = (document.getElementById('custom-end') as HTMLInputElement).value;
                    applyCustomTime(customising.day, customising.block, start, end);
                  }}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm"
                >
                  Apply
                </button>
                <button
                  onClick={() => setCustomising(null)}
                  className="px-3 py-1.5 border rounded-lg text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Date-specific overrides */}
          <div>
            <h3 className="font-semibold text-gray-800 mb-3">Date Exceptions</h3>
            <p className="text-xs text-gray-500 mb-3">
              Add specific dates when you are unavailable regardless of the weekly schedule above.
            </p>

            {dateOverrides.length > 0 && (
              <div className="space-y-2 mb-4">
                {dateOverrides.map((o, i) => (
                  <div key={i} className="flex items-center justify-between bg-red-50 rounded-lg px-3 py-2">
                    <div>
                      <span className="text-sm font-medium text-red-700">
                        {o.start === o.end ? o.start : `${o.start} – ${o.end}`}
                      </span>
                      {o.reason && <span className="text-xs text-gray-500 ml-2">({o.reason})</span>}
                    </div>
                    <button
                      onClick={() => removeOverride(i)}
                      className="text-red-400 hover:text-red-600 text-lg leading-none"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-600">From</label>
                  <input
                    type="date"
                    value={newOverrideStart}
                    onChange={e => setNewOverrideStart(e.target.value)}
                    className="block w-full mt-1 border rounded px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-600">To</label>
                  <input
                    type="date"
                    value={newOverrideEnd}
                    min={newOverrideStart}
                    onChange={e => setNewOverrideEnd(e.target.value)}
                    className="block w-full mt-1 border rounded px-2 py-1 text-sm"
                  />
                </div>
              </div>
              <input
                type="text"
                placeholder="Reason (optional)"
                value={newOverrideReason}
                onChange={e => setNewOverrideReason(e.target.value)}
                className="w-full border rounded px-2 py-1 text-sm"
              />
              <button
                onClick={addOverride}
                disabled={!newOverrideStart || !newOverrideEnd}
                className="px-3 py-1.5 bg-gray-700 text-white rounded-lg text-sm disabled:opacity-40"
              >
                + Add Exception
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        {error && <p className="px-6 text-sm text-red-600">{error}</p>}
        <div className="p-6 border-t flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 border rounded-xl text-sm">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Submit Availability'}
          </button>
        </div>
      </div>
    </div>
  );
}
