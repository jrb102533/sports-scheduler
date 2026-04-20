import { useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { Select } from '@/components/ui/Select';
import { useDivisionStore } from '@/store/useDivisionStore';
import type { Division } from '@/types';

interface Props {
  division: Division;
  leagueId: string;
}

const FORMAT_OPTIONS: { value: string; label: string }[] = [
  { value: 'single_round_robin', label: 'Single Round Robin' },
  { value: 'double_round_robin', label: 'Double Round Robin' },
];

export function DivisionScheduleSetupCard({ division, leagueId }: Props) {
  const [format, setFormat] = useState<Division['format']>(division.format ?? undefined);
  const [gamesPerTeam, setGamesPerTeam] = useState<string>(
    division.gamesPerTeam !== undefined ? String(division.gamesPerTeam) : ''
  );
  const [matchDuration, setMatchDuration] = useState<string>(
    division.matchDurationMinutes !== undefined ? String(division.matchDurationMinutes) : ''
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const persist = useCallback(async (patch: Partial<Pick<Division, 'format' | 'gamesPerTeam' | 'matchDurationMinutes'>>) => {
    setSaveError(null);
    setIsSaving(true);
    try {
      await useDivisionStore.getState().updateDivision(leagueId, division.id, patch);
      setSavedAt(Date.now());
    } catch (err) {
      console.error('[DivisionScheduleSetupCard] save failed:', err);
      setSaveError('Failed to save — please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [leagueId, division.id]);

  function handleFormatChange(value: string) {
    const next = value as Division['format'];
    setFormat(next);
    void persist({ format: next });
  }

  function handleGamesBlur() {
    const n = parseInt(gamesPerTeam, 10);
    if (!gamesPerTeam || isNaN(n) || n < 1 || n > 50) return;
    void persist({ gamesPerTeam: n });
  }

  function handleDurationBlur() {
    const n = parseInt(matchDuration, 10);
    if (!matchDuration || isNaN(n) || n < 20 || n > 180) return;
    void persist({ matchDurationMinutes: n });
  }

  const showSaved = savedAt !== null && !isSaving && !saveError;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-gray-900">{division.name}</h4>
        <div className="flex items-center gap-1.5 h-5">
          {isSaving && (
            <span className="text-xs text-gray-400">Saving…</span>
          )}
          {showSaved && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 size={13} />
              Saved
            </span>
          )}
          {saveError && (
            <span className="flex items-center gap-1 text-xs text-red-600">
              <AlertCircle size={13} />
              {saveError}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Select
          label="Format"
          value={format ?? ''}
          options={FORMAT_OPTIONS}
          placeholder="Select format"
          onChange={e => handleFormatChange(e.target.value)}
          disabled={isSaving}
          aria-label={`Format for ${division.name}`}
        />

        <div className="flex flex-col gap-1">
          <label
            htmlFor={`games-${division.id}`}
            className="text-sm font-medium text-gray-700"
          >
            Games per team
          </label>
          <input
            id={`games-${division.id}`}
            type="number"
            min={1}
            max={50}
            value={gamesPerTeam}
            onChange={e => setGamesPerTeam(e.target.value)}
            onBlur={handleGamesBlur}
            disabled={isSaving}
            placeholder="e.g. 10"
            aria-label={`Games per team for ${division.name}`}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-60"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor={`duration-${division.id}`}
            className="text-sm font-medium text-gray-700"
          >
            Match duration
          </label>
          <div className="flex items-center gap-2">
            <input
              id={`duration-${division.id}`}
              type="number"
              min={20}
              max={180}
              value={matchDuration}
              onChange={e => setMatchDuration(e.target.value)}
              onBlur={handleDurationBlur}
              disabled={isSaving}
              placeholder="e.g. 90"
              aria-label={`Match duration in minutes for ${division.name}`}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-60"
            />
            <span className="text-sm text-gray-500 whitespace-nowrap">min</span>
          </div>
        </div>
      </div>
    </div>
  );
}
