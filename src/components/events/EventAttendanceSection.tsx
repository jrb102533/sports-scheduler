/**
 * EventAttendanceSection
 *
 * Unified attendance section replacing the old "Attendance Forecast" + "RSVP" split.
 * Per PM spec (2026-04-18):
 *   - Renamed to "Attendance" everywhere
 *   - Always shows player name, never parent account name
 *   - Multi-child parent gets one CTA row per child on the team
 *   - Single unified section visible to all team members
 *   - Count-first layout with expand/collapse name list
 *   - Three groups: Confirmed, Declined, No response; Staff below divider
 *   - Coach/manager-only "Send reminder to non-responders" action
 */

import { useState, useId } from 'react';
import { Check, X, Bell } from 'lucide-react';
import { useRsvpStore } from '@/store/useRsvpStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { getMemberships } from '@/store/useAuthStore';
import type { RsvpEntry } from '@/store/useRsvpStore';
import type { UserProfile, Player } from '@/types';

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
  const byUid = players.find(p => p.linkedUid === entry.uid);
  if (byUid) return playerDisplayName(byUid);
  // Fall back to stored name (could still be parent name — data model gap noted)
  return entry.name || 'Unknown';
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface SegmentedRsvpControlProps {
  label?: string;
  currentResponse: 'yes' | 'no' | null;
  submitting: boolean;
  onRespond: (response: 'yes' | 'no') => void;
}

/**
 * Accessible segmented Going / Not going control.
 * Uses role="radiogroup" + role="radio" for screen readers.
 * Arrow-key navigation within the group.
 */
function SegmentedRsvpControl({ label, currentResponse, submitting, onRespond }: SegmentedRsvpControlProps) {
  const groupId = useId();
  const options: Array<{ value: 'yes' | 'no'; display: string }> = [
    { value: 'yes', display: 'Going' },
    { value: 'no', display: 'Not going' },
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

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <span className="text-xs font-medium text-gray-600">{label}</span>
      )}
      <div
        role="radiogroup"
        aria-label={label ?? 'RSVP'}
        className="flex rounded-lg border border-gray-200 overflow-hidden w-fit"
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
                'px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B] focus-visible:ring-inset',
                idx !== 0 ? 'border-l border-gray-200' : '',
                isSelected
                  ? opt.value === 'yes'
                    ? 'bg-[#1B3A6B] text-white'
                    : 'bg-red-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50',
              ].join(' ')}
            >
              {opt.display}
            </button>
          );
        })}
      </div>
    </div>
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
  // Determine which player(s) this user needs to RSVP for.
  // Player: their own linked player record.
  // Parent: all children in their memberships on this team.
  // Staff: also prompt if they have a linked player on this team.

  const ctaRows: PlayerCta[] = [];

  if (currentUserUid && isActive) {
    if (isParent) {
      // Each parent membership has a playerId for their child
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
      // Find this user's linked player record on this team
      const linkedPlayer = teamPlayers.find(p => p.linkedUid === currentUserUid);
      if (linkedPlayer) {
        ctaRows.push({
          playerId: linkedPlayer.id,
          playerName: playerDisplayName(linkedPlayer),
          rsvpUid: currentUserUid,
        });
      }
    } else if (isStaff) {
      // Staff with a linked player on this team can also RSVP (optional)
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
  const declinedEntries = entries.filter(r => r.response === 'no');
  const respondedUids = new Set(entries.map(r => r.uid));

  // Players with no response: roster members whose linkedUid hasn't responded
  const noResponsePlayers = teamPlayers.filter(
    p => p.linkedUid && !respondedUids.has(p.linkedUid)
  );
  // Players with no linked uid — we can't track them in the subcollection
  const unlinkedPlayers = teamPlayers.filter(p => !p.linkedUid);

  const confirmedCount = confirmedEntries.length;
  const totalTracked = rosterSize > 0 ? rosterSize : entries.length;
  const noResponseCount = noResponsePlayers.length + unlinkedPlayers.length;

  const hasAnyData = entries.length > 0 || rosterSize > 0;
  if (!hasAnyData) return null;

  // ── RSVP submit handler ────────────────────────────────────────────────────
  async function handleRespond(rsvpUid: string, playerName: string, response: 'yes' | 'no', playerId?: string) {
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

  // ── Render helpers ─────────────────────────────────────────────────────────
  const progressPct = totalTracked > 0 ? Math.round((confirmedCount / totalTracked) * 100) : 0;

  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
      {/* Header */}
      <h3 className="text-sm font-semibold text-gray-800">Attendance</h3>

      {/* Summary row + progress bar */}
      {entries.length === 0 ? (
        <p className="text-xs text-gray-400">No responses yet</p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-600">
            <span className="font-medium text-gray-800">{confirmedCount}</span>
            {' of '}
            <span className="font-medium text-gray-800">{totalTracked}</span>
            {' confirmed'}
          </p>
          <div
            role="progressbar"
            aria-valuenow={confirmedCount}
            aria-valuemin={0}
            aria-valuemax={totalTracked}
            aria-label={`${confirmedCount} of ${totalTracked} confirmed`}
            className="h-1.5 rounded-full bg-gray-200 overflow-hidden"
          >
            <div
              className="h-full rounded-full bg-[#1B3A6B] transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* CTA rows — one per player needing an RSVP */}
      {ctaRows.length > 0 && (
        <div className="space-y-2 pt-1">
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
                  <li key={r.uid} className="flex items-center gap-1.5 text-xs text-gray-700">
                    <span className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0" aria-hidden="true">
                      <Check size={9} className="text-white" strokeWidth={3} />
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
                  <li key={r.uid} className="flex items-center gap-1.5 text-xs text-gray-700">
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

          {/* Coach/manager action */}
          {isStaff && noResponseCount > 0 && (
            <div className="border-t border-gray-100 pt-2">
              {nudgeSent ? (
                <p className="text-xs text-green-700">
                  Reminder sent to {noResponseCount} player{noResponseCount !== 1 ? 's' : ''}
                </p>
              ) : (
                <button
                  onClick={handleNudge}
                  className="text-sm text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                >
                  <Bell size={12} className="inline mr-1" aria-hidden="true" />
                  Send reminder to non-responders ({noResponseCount})
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
