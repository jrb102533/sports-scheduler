import { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { clsx } from 'clsx';
import { Pencil } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useTeamStore } from '@/store/useTeamStore';
import { useEventStore } from '@/store/useEventStore';
import { useAuthStore, hasRole, isManagerOfLeague } from '@/store/useAuthStore';
import { computeStandings, firestoreToStandingRow } from '@/lib/standingsUtils';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { StandingsDocument, TeamStandingRow, ManualRankOverride } from '@/types';

// ─── RankBadge ────────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return (
    <span className="w-6 h-6 rounded-full bg-amber-400 text-white text-xs font-bold flex items-center justify-center">1</span>
  );
  if (rank === 2) return (
    <span className="w-6 h-6 rounded-full bg-gray-300 text-gray-700 text-xs font-bold flex items-center justify-center">2</span>
  );
  if (rank === 3) return (
    <span className="w-6 h-6 rounded-full bg-orange-300 text-white text-xs font-bold flex items-center justify-center">3</span>
  );
  return <span className="text-gray-400 text-xs w-6 text-center">{rank}</span>;
}

// ─── OverrideModal ────────────────────────────────────────────────────────────

interface OverrideModalState {
  teamId: string;
  teamName: string;
  currentOverride: ManualRankOverride | null;
  teamCount: number;
}

interface OverrideModalProps {
  state: OverrideModalState;
  leagueId: string;
  seasonId: string;
  onClose: () => void;
}

function OverrideModal({ state, leagueId, seasonId, onClose }: OverrideModalProps) {
  const [rankValue, setRankValue] = useState<string>(
    state.currentOverride ? String(state.currentOverride.rank) : ''
  );
  const [note, setNote] = useState(state.currentOverride?.note ?? '');
  const [scope, setScope] = useState<'display' | 'seeding'>(
    state.currentOverride?.scope ?? 'display'
  );
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const parsedRank = parseInt(rankValue, 10);
    if (!rankValue || isNaN(parsedRank) || parsedRank < 1 || parsedRank > state.teamCount) {
      setError(`Rank must be a number between 1 and ${state.teamCount}.`);
      return;
    }
    if (!note.trim()) {
      setError('A reason for the override is required.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const overrideStandingRankFn = httpsCallable<
        {
          leagueId: string;
          seasonId: string;
          teamId: string;
          override: { rank: number; note: string; scope: 'display' | 'seeding' } | null;
        },
        { status: string }
      >(getFunctions(), 'overrideStandingRank');
      await overrideStandingRankFn({
        leagueId,
        seasonId,
        teamId: state.teamId,
        override: { rank: parsedRank, note: note.trim(), scope },
      });
      onClose();
    } catch {
      setError('Failed to save override. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setClearing(true);
    try {
      const overrideStandingRankFn = httpsCallable<
        {
          leagueId: string;
          seasonId: string;
          teamId: string;
          override: { rank: number; note: string; scope: 'display' | 'seeding' } | null;
        },
        { status: string }
      >(getFunctions(), 'overrideStandingRank');
      await overrideStandingRankFn({
        leagueId,
        seasonId,
        teamId: state.teamId,
        override: null,
      });
      onClose();
    } catch {
      setError('Failed to clear override. Please try again.');
    } finally {
      setClearing(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Override Rank — ${state.teamName}`} size="sm">
      <div className="space-y-4">
        {/* Rank position */}
        <div className="flex flex-col gap-1">
          <label htmlFor="override-rank" className="text-sm font-medium text-gray-700">
            Rank position
          </label>
          <input
            id="override-rank"
            type="number"
            min={1}
            max={state.teamCount}
            value={rankValue}
            onChange={e => setRankValue(e.target.value)}
            placeholder={`1 – ${state.teamCount}`}
            className="w-full px-3 py-2 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Note */}
        <div className="flex flex-col gap-1">
          <label htmlFor="override-note" className="text-sm font-medium text-gray-700">
            Reason for override <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <textarea
            id="override-note"
            rows={3}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. Forfeit applied per league rules section 4.2"
            className="w-full px-3 py-2 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          />
        </div>

        {/* Scope */}
        <fieldset>
          <legend className="text-sm font-medium text-gray-700 mb-1.5">Scope</legend>
          <div className="flex flex-col gap-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="override-scope"
                value="display"
                checked={scope === 'display'}
                onChange={() => setScope('display')}
                className="mt-0.5"
              />
              <span className="text-sm text-gray-700">
                <span className="font-medium">Display only</span>
                <span className="block text-xs text-gray-500">Affects the standings table UI only</span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="override-scope"
                value="seeding"
                checked={scope === 'seeding'}
                onChange={() => setScope('seeding')}
                className="mt-0.5"
              />
              <span className="text-sm text-gray-700">
                <span className="font-medium">Display + Seeding</span>
                <span className="block text-xs text-gray-500">Also affects playoff bracket seeding</span>
              </span>
            </label>
          </div>
        </fieldset>

        {/* Error */}
        {error && (
          <p role="alert" className="text-sm text-red-600">{error}</p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div>
            {state.currentOverride && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClear}
                disabled={clearing || saving}
                className="text-red-600 hover:bg-red-50"
              >
                {clearing ? 'Clearing…' : 'Clear override'}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={saving || clearing}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || clearing}>
              {saving ? 'Saving…' : 'Save override'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── StandingsTable ───────────────────────────────────────────────────────────

interface StandingsTableProps {
  teamIds?: string[];
  leagueId?: string;
  seasonId?: string;
}

// Firestore document shape augmented with the override during the snapshot read
interface StandingsDocWithOverride {
  row: TeamStandingRow;
  rank: number;
  override: ManualRankOverride | undefined;
}

export function StandingsTable({ teamIds, leagueId, seasonId }: StandingsTableProps = {}) {
  const allTeams = useTeamStore(s => s.teams);
  const events = useEventStore(s => s.events);
  const profile = useAuthStore(s => s.profile);

  const [firestoreEntries, setFirestoreEntries] = useState<StandingsDocWithOverride[] | null>(null);
  const [loadingFirestore, setLoadingFirestore] = useState(false);

  const useFirestore = Boolean(leagueId && seasonId);

  useEffect(() => {
    if (!useFirestore || !leagueId || !seasonId) return;

    setLoadingFirestore(true);

    const standingsRef = collection(db, 'leagues', leagueId, 'seasons', seasonId, 'standings');
    const unsub = onSnapshot(
      standingsRef,
      (snap) => {
        const entries: StandingsDocWithOverride[] = snap.docs.map((d) => {
          const data = d.data() as StandingsDocument;
          const team = allTeams.find(t => t.id === data.teamId);
          return {
            row: firestoreToStandingRow(data, team?.name ?? data.teamId, team?.color ?? '#6b7280'),
            // Use manualRankOverride.rank when present, otherwise fall back to computed rank
            rank: data.manualRankOverride?.rank ?? data.rank,
            override: data.manualRankOverride,
          };
        });
        // Sort by the effective (possibly overridden) rank
        entries.sort((a, b) => a.rank - b.rank);
        setFirestoreEntries(entries);
        setLoadingFirestore(false);
      },
      () => {
        setLoadingFirestore(false);
      },
    );

    return unsub;
  }, [useFirestore, leagueId, seasonId, allTeams]);

  const canOverride = useFirestore && (
    hasRole(profile, 'admin') ||
    (leagueId != null && isManagerOfLeague(profile, leagueId))
  );
  const [modalState, setModalState] = useState<OverrideModalState | null>(null);

  // ── Firestore path ──

  if (useFirestore) {
    if (loadingFirestore) {
      return (
        <p className="text-sm text-gray-400 py-8 text-center" aria-busy="true">
          Loading standings…
        </p>
      );
    }

    if (!firestoreEntries || firestoreEntries.length === 0) {
      return <p className="text-sm text-gray-500 py-8 text-center">No results recorded yet.</p>;
    }

    const displayEntries = teamIds
      ? firestoreEntries.filter(e => teamIds.includes(e.row.teamId))
      : firestoreEntries;

    return (
      <>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase w-10"></th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Team</th>
                <th className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase">GP</th>
                <th className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase">W</th>
                <th className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase">L</th>
                <th className="hidden sm:table-cell px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase">T</th>
                <th className="hidden md:table-cell px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase">PF</th>
                <th className="hidden md:table-cell px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase">PA</th>
                <th className="hidden sm:table-cell px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Diff</th>
                <th className="px-2 py-3 text-center text-xs font-semibold text-gray-800 uppercase">Pts</th>
                {canOverride && (
                  <th className="px-2 py-3 w-8" aria-label="Override actions"></th>
                )}
              </tr>
            </thead>
            <tbody>
              {displayEntries.map(({ row, rank, override }, i) => (
                <tr
                  key={row.teamId}
                  className={clsx(
                    'border-b border-gray-100 hover:bg-gray-50 transition-colors group',
                    i === 0 && 'bg-amber-50/40'
                  )}
                >
                  {/* Rank */}
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <RankBadge rank={rank} />
                      {override && (
                        <span
                          title={`Manual override: ${override.note}`}
                          aria-label={`Manually overridden. Reason: ${override.note}`}
                          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700 flex-shrink-0 cursor-default"
                        >
                          <Pencil size={9} aria-hidden="true" />
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Team */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: row.teamColor }} />
                      <span className={clsx('font-medium text-gray-900 text-sm', i === 0 && 'font-semibold')}>{row.teamName}</span>
                    </div>
                  </td>

                  <td className="px-2 py-3 text-center text-gray-600 text-sm">{row.gamesPlayed}</td>
                  <td className="px-2 py-3 text-center text-green-600 font-medium text-sm">{row.wins}</td>
                  <td className="px-2 py-3 text-center text-red-500 font-medium text-sm">{row.losses}</td>
                  <td className="hidden sm:table-cell px-2 py-3 text-center text-gray-500 text-sm">{row.ties}</td>
                  <td className="hidden md:table-cell px-2 py-3 text-center text-gray-600 text-sm">{row.pointsFor}</td>
                  <td className="hidden md:table-cell px-2 py-3 text-center text-gray-600 text-sm">{row.pointsAgainst}</td>
                  <td className="hidden sm:table-cell px-2 py-3 text-center text-gray-600 text-sm">{row.pointsDiff > 0 ? `+${row.pointsDiff}` : row.pointsDiff}</td>
                  <td className="px-2 py-3 text-center font-bold text-gray-900 text-sm">{row.points}</td>

                  {/* Override button — LM/Admin only, revealed on row hover */}
                  {canOverride && (
                    <td className="px-2 py-3 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setModalState({
                            teamId: row.teamId,
                            teamName: row.teamName,
                            currentOverride: override ?? null,
                            teamCount: displayEntries.length,
                          })
                        }
                        aria-label={`Override rank for ${row.teamName}`}
                        className={clsx(
                          'p-1.5 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500',
                          'opacity-0 group-hover:opacity-100 focus:opacity-100',
                          override
                            ? 'opacity-100 text-amber-600 hover:text-amber-700 hover:bg-amber-50'
                            : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                        )}
                      >
                        <Pencil size={13} aria-hidden="true" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {modalState && leagueId && seasonId && (
          <OverrideModal
            state={modalState}
            leagueId={leagueId}
            seasonId={seasonId}
            onClose={() => setModalState(null)}
          />
        )}
      </>
    );
  }

  // ── Local computed path (no leagueId/seasonId) ──

  const teams = teamIds ? allTeams.filter(t => teamIds.includes(t.id)) : allTeams;
  const rows = computeStandings(events, teams);

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500 py-8 text-center">No teams yet. Add teams to see standings.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50/60">
            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase w-10"></th>
            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Team</th>
            <th className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase">GP</th>
            <th className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase">W</th>
            <th className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase">L</th>
            <th className="hidden sm:table-cell px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase">T</th>
            <th className="hidden md:table-cell px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase">PF</th>
            <th className="hidden md:table-cell px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase">PA</th>
            <th className="hidden sm:table-cell px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Diff</th>
            <th className="px-2 py-3 text-center text-xs font-semibold text-gray-800 uppercase">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.teamId}
              className={clsx(
                'border-b border-gray-100 hover:bg-gray-50 transition-colors',
                i === 0 && 'bg-amber-50/40'
              )}
            >
              <td className="px-3 py-3">
                <div className="flex items-center justify-center">
                  <RankBadge rank={i + 1} />
                </div>
              </td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: row.teamColor }} />
                  <span className={clsx('font-medium text-gray-900 text-sm', i === 0 && 'font-semibold')}>{row.teamName}</span>
                </div>
              </td>
              <td className="px-2 py-3 text-center text-gray-600 text-sm">{row.gamesPlayed}</td>
              <td className="px-2 py-3 text-center text-green-600 font-medium text-sm">{row.wins}</td>
              <td className="px-2 py-3 text-center text-red-500 font-medium text-sm">{row.losses}</td>
              <td className="hidden sm:table-cell px-2 py-3 text-center text-gray-500 text-sm">{row.ties}</td>
              <td className="hidden md:table-cell px-2 py-3 text-center text-gray-600 text-sm">{row.pointsFor}</td>
              <td className="hidden md:table-cell px-2 py-3 text-center text-gray-600 text-sm">{row.pointsAgainst}</td>
              <td className="hidden sm:table-cell px-2 py-3 text-center text-gray-600 text-sm">{row.pointsDiff > 0 ? `+${row.pointsDiff}` : row.pointsDiff}</td>
              <td className="px-2 py-3 text-center font-bold text-gray-900 text-sm">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
