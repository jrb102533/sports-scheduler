import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useCollectionStore } from '@/store/useCollectionStore';
import type { CoachAvailabilityResponse } from '@/types';

interface Props {
  leagueId: string;
  collectionId: string;
  dueDate: string;
  coachUid: string;
  coachName: string;
  teamId: string;
  existingResponse?: CoachAvailabilityResponse;
  onSuccess: () => void;
}

type Block = 'morning' | 'afternoon' | 'evening';

const GRID_DAYS: { label: string; dayOfWeek: number }[] = [
  { label: 'Mon', dayOfWeek: 1 },
  { label: 'Tue', dayOfWeek: 2 },
  { label: 'Wed', dayOfWeek: 3 },
  { label: 'Thu', dayOfWeek: 4 },
  { label: 'Fri', dayOfWeek: 5 },
  { label: 'Sat', dayOfWeek: 6 },
  { label: 'Sun', dayOfWeek: 0 },
];

const BLOCKS: { id: Block; label: string; startTime: string; endTime: string }[] = [
  { id: 'morning',   label: 'Morning',   startTime: '06:00', endTime: '12:00' },
  { id: 'afternoon', label: 'Afternoon', startTime: '12:00', endTime: '17:00' },
  { id: 'evening',   label: 'Evening',   startTime: '17:00', endTime: '22:00' },
];

type GridState = Record<number, Record<Block, boolean>>;

function buildDefaultGrid(): GridState {
  const grid: GridState = {};
  for (const day of GRID_DAYS) {
    grid[day.dayOfWeek] = { morning: true, afternoon: true, evening: true };
  }
  return grid;
}

function initGridFromResponse(response: CoachAvailabilityResponse): GridState {
  const grid = buildDefaultGrid();
  for (const w of response.weeklyWindows) {
    const block = BLOCKS.find(b => b.startTime === w.startTime);
    if (block && grid[w.dayOfWeek] !== undefined) {
      grid[w.dayOfWeek][block.id] = w.available;
    }
  }
  return grid;
}

function gridToWindows(grid: GridState): CoachAvailabilityResponse['weeklyWindows'] {
  const windows: CoachAvailabilityResponse['weeklyWindows'] = [];
  for (const day of GRID_DAYS) {
    for (const block of BLOCKS) {
      windows.push({
        dayOfWeek: day.dayOfWeek,
        startTime: block.startTime,
        endTime: block.endTime,
        available: grid[day.dayOfWeek][block.id],
      });
    }
  }
  return windows;
}

function daysUntil(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(isoDate);
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function CoachAvailabilityForm({
  leagueId,
  collectionId,
  dueDate,
  coachUid,
  coachName,
  teamId,
  existingResponse,
  onSuccess,
}: Props) {
  const { submitResponse } = useCollectionStore();

  const [grid, setGrid] = useState<GridState>(() =>
    existingResponse ? initGridFromResponse(existingResponse) : buildDefaultGrid()
  );

  const [dateOverrides, setDateOverrides] = useState<CoachAvailabilityResponse['dateOverrides']>(
    existingResponse?.dateOverrides ?? []
  );
  const [overrideStart, setOverrideStart] = useState('');
  const [overrideEnd, setOverrideEnd] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  function toggleCell(dayOfWeek: number, block: Block) {
    setGrid(prev => ({
      ...prev,
      [dayOfWeek]: {
        ...prev[dayOfWeek],
        [block]: !prev[dayOfWeek][block],
      },
    }));
  }

  function addOverride() {
    if (!overrideStart || !overrideEnd || overrideStart > overrideEnd) return;
    setDateOverrides(prev => [
      ...prev,
      { start: overrideStart, end: overrideEnd, available: false, reason: overrideReason || undefined },
    ]);
    setOverrideStart('');
    setOverrideEnd('');
    setOverrideReason('');
  }

  function removeOverride(index: number) {
    setDateOverrides(prev => prev.filter((_, i) => i !== index));
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
      setSaved(true);
      onSuccess();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const daysLeft = daysUntil(dueDate);
  const dueDateLabel = new Date(dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const isUpdating = !!existingResponse;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-gray-500">
          Due {dueDateLabel}
          {daysLeft > 0 ? ` · ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining` : ' · Today'}
        </p>
        <p className="text-xs text-gray-400 mt-1">
          Tap a block to mark it unavailable. All blocks are available by default.
        </p>
      </div>

      {/* Weekly availability grid */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Weekly Availability</h3>

        <div className="overflow-x-auto">
          <div className="min-w-[480px]">
            {/* Column headers */}
            <div className="grid grid-cols-8 gap-1 mb-1">
              <div />
              {GRID_DAYS.map(d => (
                <div key={d.dayOfWeek} className="text-center text-xs font-medium text-gray-500 py-1">
                  {d.label}
                </div>
              ))}
            </div>

            {/* Block rows */}
            {BLOCKS.map(block => (
              <div key={block.id} className="grid grid-cols-8 gap-1 mb-1">
                <div className="flex items-center text-xs text-gray-400 pr-1 leading-tight">
                  {block.label}
                </div>
                {GRID_DAYS.map(day => {
                  const available = grid[day.dayOfWeek][block.id];
                  return (
                    <button
                      key={day.dayOfWeek}
                      onClick={() => toggleCell(day.dayOfWeek, block.id)}
                      className={`h-9 rounded text-xs font-medium transition-colors ${
                        available
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-red-100 text-red-600 hover:bg-red-200'
                      }`}
                      aria-label={`${day.label} ${block.label}: ${available ? 'available' : 'unavailable'}`}
                    >
                      {available ? '✓' : '✗'}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-gray-400 mt-2">Green = available · Red = unavailable</p>
      </div>

      {/* Date-specific exceptions */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Date Exceptions</h3>
        <p className="text-xs text-gray-400 mb-3">
          Add specific date ranges when you are unavailable regardless of the weekly schedule above.
        </p>

        {dateOverrides.length > 0 && (
          <div className="space-y-2 mb-3">
            {dateOverrides.map((o, i) => (
              <div key={i} className="flex items-center justify-between bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                <div>
                  <span className="text-sm font-medium text-red-700">
                    {o.start === o.end ? o.start : `${o.start} – ${o.end}`}
                  </span>
                  {o.reason && <span className="text-xs text-gray-500 ml-2">({o.reason})</span>}
                </div>
                <button
                  onClick={() => removeOverride(i)}
                  className="p-1 text-red-400 hover:text-red-600 rounded"
                  aria-label="Remove exception"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="bg-gray-50 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">From</label>
              <input
                type="date"
                value={overrideStart}
                onChange={e => setOverrideStart(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">To</label>
              <input
                type="date"
                value={overrideEnd}
                min={overrideStart}
                onChange={e => setOverrideEnd(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <input
            type="text"
            placeholder="Reason (optional)"
            value={overrideReason}
            onChange={e => setOverrideReason(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={addOverride}
            disabled={!overrideStart || !overrideEnd || overrideStart > overrideEnd}
          >
            + Add Exception
          </Button>
        </div>
      </div>

      {/* Privacy note */}
      <p className="text-xs text-gray-400">
        Your availability is only visible to the league manager.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button
        variant="primary"
        onClick={handleSubmit}
        disabled={saving || saved}
        className="w-full"
      >
        {saving ? 'Saving…' : isUpdating ? 'Update My Availability' : 'Submit My Availability'}
      </Button>
    </div>
  );
}
