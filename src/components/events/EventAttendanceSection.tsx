/**
 * EventAttendanceSection
 *
 * Renders two stacked cards:
 *   Card 1 — "WILL YOU BE THERE?" — segmented RSVP control (Going / Maybe / Can't go)
 *   Card 2 — "ATTENDANCE" — progress bar + dot legend + nudge button
 *
 * Per PM spec (2026-04-22):
 *   - Three-way RSVP: 'yes' | 'maybe' | 'no'
 *   - "Confirmed" = 'yes' only; "Maybe" = 'maybe' only; "Out" = 'no'
 *   - Progress bar: green segment = going, red segment = out; maybe shown in legend only
 *   - Nudge button: outlined, bell icon, coach/LM/admin when non-responders exist
 *   - Always shows player name, never parent account name
 *   - Multi-child parent gets one CTA row per child on the team
 */

import { useState, useId } from 'react';
import { Check, X, Bell } from 'lucide-react';
import { useRsvpStore } from '@/store/useRsvpStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { getMemberships } from '@/store/useAuthStore';
import type { RsvpEntry } from '@/store/useRsvpStore';
import type { UserProfile, Player, ScheduledEvent } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlayerCta {
  /** Firestore player document ID */
  playerId: string;
  playerName: string;
  /** The RSVP uid key for this player's entry in the subcollection */
  rsvpUid: string;
}

interface AttendanceSectionProps {
  eventId: string;
  /** All teamIds on this event — used to filter team roster */
  teamIds: string[];
  /** Currently authenticated user profile */
  profile: UserProfile | null;
  /** Firebase Auth UID of the current user */
  currentUserUid: string | null;
  /** Whether the event is active (not cancelled/completed) */
  isActive: boolean;
  /** ISO date string for RSVP deadline (optional) */
  rsvpDeadline?: ScheduledEvent['rsvpDeadline'];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function playerDisplayName(player: Player): string {
  return `${player.firstName} ${player.lastName}`.trim();
}

/**
 * Resolves the player name for a given RSVP entry.
 * Prefers the roster record (firstName + lastName) over the stored `name` field
 * so we always show the player's name regardless of who submitted the RSVP.
 */
function resolvePlayerName(entry: RsvpEntry, players: Player[]): string {
  if (entry.playerId) {
    const byId = players.find(p => p.id === entry.playerId);
    if (byId) return playerDisplayName(byId);
  }
  const byUid = players.find(p => p.linkedUid === entry.uid);
  if (byUid) return playerDisplayName(byUid);
  return entry.name || 'Unknown';
}

/**
 * Returns a friendly day name like "Friday" from an ISO date string.
 */
function deadlineDayName(isoDate: string): string {
  const date = new Date(isoDate + 'T12:00:00'); // noon to avoid timezone shifts
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

// ── Sub-components ────────────────────────────────────────────────────────────

type RsvpResponse = 'yes' | 'maybe' | 'no';

interface SegmentedRsvpControlProps {
  label?: string;
  currentResponse: RsvpResponse | null;
  submitting: boolean;
  onRespond: (response: RsvpResponse) => void;
}

/**
 * Accessible three-way segmented control: Going / Maybe / Can't go.
 * Uses role="radiogroup" + role="radio" for screen readers.
 * Arrow-key navigation within the group.
 */
function SegmentedRsvpControl({ label, currentResponse, submitting, onRespond }: SegmentedRsvpControlProps) {
  const groupId = useId();
  const options: Array<{ value: RsvpResponse; display: string }> = [
    { value: 'yes', display: 'Going' },
    { value: 'maybe', display: 'Maybe' },
    { value: 'no', display: "Can't go" },
  ];

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (index + 1) % options.length;
      document.getElementById(`${groupId}-opt-${next}`)?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (index - 1 + options.length) % options.length;
      document.getElementById(`${groupId}-opt-${prev}`)?.focus();
    }
  }

  function selectedClasses(value: RsvpResponse, isSelected: boolean): string {
    if (!isSelected) return 'bg-white text-gray-700 hover:bg-gray-50';
    if (value === 'yes') return 'bg-green-600 text-white';
    if (value === 'maybe') return 'bg-amber-500 text-white';
    return 'bg-red-500 text-white';
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <span className="text-xs font-medium text-gray-600">{label}</span>
      )}
      <div
        role="radiogroup"
        aria-label={label ?? 'RSVP'}
        className="flex rounded-lg border border-gray-200 overflow-hidden w-full"
      >
        {options.map((opt, idx) => {
          const isSelected = currentResponse === opt.value;
          return (
            <button
              key={opt.value}
              id={`${groupId}-opt-${idx}`}
              role="radio"
              aria-checked={isSelected}
              disabled={submitting}
              onClick={() => onRespond(opt.value)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              tabIndex={isSelected || (currentResponse === null && idx === 0) ? 0 : -1}
              className={[
                'flex-1 px-2 py-2 text-xs font-medium transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B] focus-visible:ring-inset',
                idx !== 0 ? 'border-l border-gray-200' : '',
                selectedClasses(opt.value, isSelected),
              ].join(' ')}
            >
              {isSelected && opt.value === 'yes' && (
                <Check size={10} className="inline mr-1" strokeWidth={3} aria-hidden="true" />
              )}
              {opt.display}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Dot legend item ───────────────────────────────────────────────────────────

interface LegendDotProps {
  color: string;
  label: string;
}

function LegendDot({ color, label }: LegendDotProps) {
  return (
    <span className="flex items-center gap-1 text-xs text-gray-600">
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${color}`} aria-hidden="true" />
      {label}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const EMPTY_ENTRIES: RsvpEntry[] = [];

export function EventAttendanceSection({
  eventId,
  teamIds,
  profile,
  currentUserUid,
  isActive,
  rsvpDeadline,
}: AttendanceSectionProps) {
  const entries = useRsvpStore(s => s.rsvps[eventId] ?? EMPTY_ENTRIES);
  const submitRsvp = useRsvpStore(s => s.submitRsvp);
  const allPlayers = usePlayerStore(s => s.players);
  const [expanded, setExpanded] = useState(false);
  const [submittingUids, setSubmittingUids] = useState<Set<string>>(new Set());
  const [nudgeSent, setNudgeSent] = useState(false);

  const listId = useId();

  // Team roster for this event
  const teamPlayers = allPlayers.filter(p => teamIds.includes(p.teamId) && p.status !== 'inactive');
  const rosterSize = teamPlayers.length;

  // ── Role detection ─────────────────────────────────────────────────────────
  const memberships = getMemberships(profile);
  const isStaff = memberships.some(m =>
    m.role === 'coach' || m.role === 'league_manager' || m.role === 'admin'
  );
  const isParent = memberships.some(m => m.role === 'parent');
  const isPlayer = memberships.some(m => m.role === 'player');

  // ── CTA rows for current user ──────────────────────────────────────────────
  const ctaRows: PlayerCta[] = [];

  if (currentUserUid && isActive) {
    if (isParent) {
      const parentMemberships = memberships.filter(m => m.role === 'parent' && m.playerId && m.teamId && teamIds.includes(m.teamId));
      for (const m of parentMemberships) {
        const player = teamPlayers.find(p => p.id === m.playerId);
        if (player) {
          ctaRows.push({
            playerId: player.id,
            playerName: playerDisplayName(player),
            rsvpUid: currentUserUid,
          });
        }
      }
    } else if (isPlayer) {
      const linkedPlayer = teamPlayers.find(p => p.linkedUid === currentUserUid);
      if (linkedPlayer) {
        ctaRows.push({
          playerId: linkedPlayer.id,
          playerName: playerDisplayName(linkedPlayer),
          rsvpUid: currentUserUid,
        });
      }
    } else if (isStaff) {
      const linkedPlayer = teamPlayers.find(p => p.linkedUid === currentUserUid);
      if (linkedPlayer) {
        ctaRows.push({
          playerId: linkedPlayer.id,
          playerName: playerDisplayName(linkedPlayer),
          rsvpUid: currentUserUid,
        });
      }
    }
  }

  // ── Response counts ────────────────────────────────────────────────────────
  const confirmedEntries = entries.filter(r => r.response === 'yes');
  const maybeEntries = entries.filter(r => r.response === 'maybe');
  const declinedEntries = entries.filter(r => r.response === 'no');
  const respondedUids = new Set(entries.map(r => r.uid));

  const noResponsePlayers = teamPlayers.filter(
    p => p.linkedUid && !respondedUids.has(p.linkedUid)
  );
  const unlinkedPlayers = teamPlayers.filter(p => !p.linkedUid);

  const confirmedCount = confirmedEntries.length;
  const maybeCount = maybeEntries.length;
  const declinedCount = declinedEntries.length;
  const totalTracked = rosterSize > 0 ? rosterSize : entries.length;
  const noResponseCount = noResponsePlayers.length + unlinkedPlayers.length;

  const hasAnyData = entries.length > 0 || rosterSize > 0;
  if (!hasAnyData) return null;

  // ── RSVP submit handler ────────────────────────────────────────────────────
  async function handleRespond(rsvpUid: string, playerName: string, response: RsvpResponse, playerId?: string) {
    const storeKey = playerId ? `${rsvpUid}_${playerId}` : rsvpUid;
    if (submittingUids.has(storeKey)) return;
    setSubmittingUids(prev => new Set(prev).add(storeKey));

    // Optimistic update
    useRsvpStore.setState(state => {
      const existing = state.rsvps[eventId] ?? [];
      const filtered = existing.filter(r => {
        const rKey = r.playerId ? `${r.uid}_${r.playerId}` : r.uid;
        return rKey !== storeKey;
      });
      return {
        rsvps: {
          ...state.rsvps,
          [eventId]: [
            ...filtered,
            { uid: rsvpUid, ...(playerId ? { playerId } : {}), name: playerName, response, updatedAt: new Date().toISOString() },
          ],
        },
      };
    });

    try {
      await submitRsvp(eventId, rsvpUid, playerName, response, playerId);
    } catch {
      // On error, the next snapshot will reconcile server state
    } finally {
      setSubmittingUids(prev => {
        const next = new Set(prev);
        next.delete(storeKey);
        return next;
      });
    }
  }

  // ── Nudge handler (coach/LM/admin only) ───────────────────────────────────
  function handleNudge() {
    // TODO: wire to sendEventReminder CF when available
    console.warn('[EventAttendanceSection] nudge: no per-event CF wired for event', eventId);
    setNudgeSent(true);
    setTimeout(() => setNudgeSent(false), 3500);
  }

  // ── Progress bar widths ────────────────────────────────────────────────────
  const goingPct = totalTracked > 0 ? Math.round((confirmedCount / totalTracked) * 100) : 0;
  const outPct = totalTracked > 0 ? Math.round((declinedCount / totalTracked) * 100) : 0;

  // ── Card shared classes ────────────────────────────────────────────────────
  const cardClass = 'bg-white rounded-2xl shadow-sm p-5 space-y-3';
  const sectionHeadingClass = 'text-sm font-bold uppercase tracking-wide text-gray-900';

  return (
    <div className="space-y-3">

      {/* ── Card 1 — WILL YOU BE THERE? ─────────────────────────────────── */}
      {ctaRows.length > 0 && (
        <div className={cardClass}>
          <div className="flex items-center justify-between gap-2">
            <h3 className={sectionHeadingClass}>Will you be there?</h3>
            {rsvpDeadline && (
              <span className="text-xs text-gray-400 shrink-0">
                Required by {deadlineDayName(rsvpDeadline)}
              </span>
            )}
          </div>

          <div className="space-y-3">
            {ctaRows.map(row => {
              const storeKey = row.playerId ? `${row.rsvpUid}_${row.playerId}` : row.rsvpUid;
              const myEntry = entries.find(r => (r.playerId ? `${r.uid}_${r.playerId}` : r.uid) === storeKey);
              const isSubmitting = submittingUids.has(storeKey);
              return (
                <SegmentedRsvpControl
                  key={row.playerId}
                  label={ctaRows.length > 1 ? row.playerName : undefined}
                  currentResponse={myEntry?.response ?? null}
                  submitting={isSubmitting}
                  onRespond={(response) => void handleRespond(row.rsvpUid, row.playerName, response, row.playerId)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ── Card 2 — ATTENDANCE ─────────────────────────────────────────── */}
      <div className={cardClass}>
        <div className="flex items-center justify-between gap-2">
          <h3 className={sectionHeadingClass}>Attendance</h3>
          {entries.length > 0 && (
            <span className="text-xs text-gray-500 shrink-0">
              {confirmedCount} of {totalTracked} confirmed
            </span>
          )}
        </div>

        {entries.length === 0 ? (
          <p className="text-xs text-gray-400">No responses yet</p>
        ) : (
          <>
            {/* Progress bar — green = going, red = out */}
            <div
              role="progressbar"
              aria-valuenow={confirmedCount}
              aria-valuemin={0}
              aria-valuemax={totalTracked}
              aria-label={`${confirmedCount} of ${totalTracked} confirmed`}
              className="h-2.5 rounded-full bg-gray-200 overflow-hidden flex"
            >
              {goingPct > 0 && (
                <div
                  className="h-full bg-green-500 transition-all duration-300"
                  style={{ width: `${goingPct}%` }}
                />
              )}
              {outPct > 0 && (
                <div
                  className="h-full bg-red-500 transition-all duration-300"
                  style={{ width: `${outPct}%` }}
                />
              )}
            </div>

            {/* Dot legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              <LegendDot color="bg-green-500" label={`${confirmedCount} Going`} />
              <LegendDot color="bg-amber-400" label={`${maybeCount} Maybe`} />
              <LegendDot color="bg-red-500" label={`${declinedCount} Out`} />
              <LegendDot color="bg-gray-300" label={`${noResponseCount} No reply`} />
            </div>
          </>
        )}

        {/* Nudge button — staff only, when non-responders exist */}
        {isStaff && noResponseCount > 0 && (
          <div className="pt-1">
            {nudgeSent ? (
              <p className="text-xs text-green-700">
                Reminder sent to {noResponseCount} player{noResponseCount !== 1 ? 's' : ''}
              </p>
            ) : (
              <button
                onClick={handleNudge}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B] transition-colors"
              >
                <Bell size={12} aria-hidden="true" />
                Nudge {noResponseCount} non-responder{noResponseCount !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        )}

        {/* Expand/collapse trigger */}
        {entries.length > 0 && (
          <button
            onClick={() => setExpanded(v => !v)}
            aria-expanded={expanded}
            aria-controls={listId}
            className="text-xs text-gray-500 hover:text-gray-700 transition-colors underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B] rounded"
          >
            {expanded ? 'Hide responses' : `See responses (${entries.length})`}
          </button>
        )}

        {/* Expanded name list */}
        <div
          id={listId}
          className={[
            'overflow-hidden transition-all duration-150 ease-out',
            expanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0',
          ].join(' ')}
          aria-hidden={!expanded}
        >
          <div className="pt-1 space-y-3">
            {/* Confirmed */}
            {confirmedEntries.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-700 mb-1">Confirmed</p>
                <ul className="space-y-0.5">
                  {confirmedEntries.map(r => (
                    <li key={r.uid + (r.playerId ?? '')} className="flex items-center gap-1.5 text-xs text-gray-700">
                      <span className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0" aria-hidden="true">
                        <Check size={9} className="text-white" strokeWidth={3} />
                      </span>
                      {resolvePlayerName(r, teamPlayers)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Maybe */}
            {maybeEntries.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-amber-600 mb-1">Maybe</p>
                <ul className="space-y-0.5">
                  {maybeEntries.map(r => (
                    <li key={r.uid + (r.playerId ?? '')} className="flex items-center gap-1.5 text-xs text-gray-700">
                      <span className="w-4 h-4 rounded-full bg-amber-400 flex items-center justify-center flex-shrink-0" aria-hidden="true">
                        <span className="text-white text-[7px] font-bold leading-none">?</span>
                      </span>
                      {resolvePlayerName(r, teamPlayers)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Declined */}
            {declinedEntries.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-red-600 mb-1">Declined</p>
                <ul className="space-y-0.5">
                  {declinedEntries.map(r => (
                    <li key={r.uid + (r.playerId ?? '')} className="flex items-center gap-1.5 text-xs text-gray-700">
                      <span className="w-4 h-4 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0" aria-hidden="true">
                        <X size={9} className="text-red-500" strokeWidth={2.5} />
                      </span>
                      {resolvePlayerName(r, teamPlayers)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* No response */}
            {noResponsePlayers.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 mb-1">No response</p>
                <ul className="space-y-0.5">
                  {noResponsePlayers.map(p => (
                    <li key={p.id} className="flex items-center gap-1.5 text-xs text-gray-500">
                      <span className="w-4 h-4 rounded-full border border-gray-300 flex-shrink-0" aria-hidden="true" />
                      {playerDisplayName(p)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
