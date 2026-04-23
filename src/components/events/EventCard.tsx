import { useState } from 'react';
import { MapPin, Clock, AlertTriangle } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EventStatusBadge } from './EventStatusBadge';
import { formatDate, formatTime } from '@/lib/dateUtils';
import { EVENT_TYPE_LABELS, EVENT_TYPE_COLORS, EVENT_TYPE_BADGE_CLASSES } from '@/constants';
import type { ScheduledEvent, Team } from '@/types';
import { useAuthStore, getActiveMembership } from '@/store/useAuthStore';
import { useEventStore } from '@/store/useEventStore';

interface EventCardProps {
  event: ScheduledEvent;
  teams: Team[];
  onClick?: () => void;
}

function RsvpIndicator({ event }: { event: ScheduledEvent; onOpenDetail?: () => void }) {
  const user = useAuthStore(s => s.user);
  const profile = useAuthStore(s => s.profile);
  const updateEvent = useEventStore(s => s.updateEvent);
  const [submitting, setSubmitting] = useState(false);
  const [showButtons, setShowButtons] = useState(false);

  // Never show on completed or cancelled events
  if (event.status === 'completed' || event.status === 'cancelled') return null;

  // Use active membership role so context-switcher is respected
  const role = getActiveMembership(profile)?.role ?? profile?.role;
  const rsvps = event.rsvps ?? [];

  // Coach / admin / league_manager: show going count
  if (role === 'coach' || role === 'admin' || role === 'league_manager') {
    const goingCount = rsvps.filter(r => r.response === 'yes').length;
    if (rsvps.length === 0) return null;
    return (
      <div className="mt-3 pt-2.5 border-t border-gray-100">
        {goingCount > 0
          ? <span className="text-xs text-gray-400">&#10003; {goingCount} going</span>
          : <span className="text-xs text-gray-400">No responses yet</span>
        }
      </div>
    );
  }

  // Player / parent: show their own RSVP status or inline RSVP buttons
  if (role === 'player' || role === 'parent') {
    const uid = user?.uid;
    if (!uid) return null;
    // Prefer the Firestore player doc ID (matches email-link RSVPs); fall back to auth UID
    const playerId = profile?.playerId ?? uid;

    const myRsvp = rsvps.find(r => r.playerId === playerId);

    async function handleRsvp(response: 'yes' | 'no' | 'maybe', e: React.MouseEvent) {
      e.stopPropagation();
      if (submitting) return;
      setSubmitting(true);
      try {
        const now = new Date().toISOString();
        const existingRsvps = event.rsvps ?? [];
        const filtered = existingRsvps.filter(r => r.playerId !== playerId);
        const newRsvp = {
          playerId: playerId,
          name: profile?.displayName ?? '',
          email: profile?.email ?? '',
          response,
          respondedAt: now,
        };
        const updatedEvent = {
          ...event,
          rsvps: [...filtered, newRsvp],
          updatedAt: now,
        };
        await setDoc(doc(db, 'events', event.id), updatedEvent);
        await updateEvent(updatedEvent);
        setShowButtons(false);
      } finally {
        setSubmitting(false);
      }
    }

    if (myRsvp?.response === 'yes') {
      return (
        <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
            &#10003; Going
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setShowButtons(true); }}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Change
          </button>
          {showButtons && (
            <div className="flex gap-1 ml-1" onClick={e => e.stopPropagation()}>
              <button onClick={(e) => void handleRsvp('no', e)} disabled={submitting} className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600 hover:bg-red-200">No</button>
              <button onClick={(e) => void handleRsvp('maybe', e)} disabled={submitting} className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 hover:bg-amber-200">Maybe</button>
            </div>
          )}
        </div>
      );
    }

    if (myRsvp?.response === 'maybe') {
      return (
        <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
            ? Maybe
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setShowButtons(true); }}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Change
          </button>
          {showButtons && (
            <div className="flex gap-1 ml-1" onClick={e => e.stopPropagation()}>
              <button onClick={(e) => void handleRsvp('yes', e)} disabled={submitting} className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200">Yes</button>
              <button onClick={(e) => void handleRsvp('no', e)} disabled={submitting} className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600 hover:bg-red-200">No</button>
            </div>
          )}
        </div>
      );
    }

    if (myRsvp?.response === 'no') {
      return (
        <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">
            &#10007; Can&apos;t make it
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setShowButtons(true); }}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Change
          </button>
          {showButtons && (
            <div className="flex gap-1 ml-1" onClick={e => e.stopPropagation()}>
              <button onClick={(e) => void handleRsvp('yes', e)} disabled={submitting} className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200">Yes</button>
              <button onClick={(e) => void handleRsvp('maybe', e)} disabled={submitting} className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 hover:bg-amber-200">Maybe</button>
            </div>
          )}
        </div>
      );
    }

    // No response yet — show inline Yes / Maybe / No buttons
    if (showButtons) {
      return (
        <div className="mt-3 pt-2.5 border-t border-gray-100" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 mr-1">RSVP:</span>
            <button onClick={(e) => void handleRsvp('yes', e)} disabled={submitting} className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors">Yes</button>
            <button onClick={(e) => void handleRsvp('maybe', e)} disabled={submitting} className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors">Maybe</button>
            <button onClick={(e) => void handleRsvp('no', e)} disabled={submitting} className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-600 hover:bg-red-200 transition-colors">No</button>
            <button onClick={(e) => { e.stopPropagation(); setShowButtons(false); }} className="ml-1 text-xs text-gray-400 hover:text-gray-600">&#10005;</button>
          </div>
        </div>
      );
    }

    return (
      <div className="mt-3 pt-2.5 border-t border-gray-100">
        <button
          onClick={(e) => { e.stopPropagation(); setShowButtons(true); }}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors border border-blue-200"
        >
          RSVP
        </button>
      </div>
    );
  }

  return null;
}

export function EventCard({ event, teams, onClick }: EventCardProps) {
  const homeTeam = teams.find(t => t.id === event.homeTeamId);
  const awayTeam = teams.find(t => t.id === event.awayTeamId);
  const accentColor = EVENT_TYPE_COLORS[event.type] ?? '#6b7280';
  const user = useAuthStore(s => s.user);
  const profile = useAuthStore(s => s.profile);
  const cardUserUid = user?.uid ?? null;
  const showInteractive = cardUserUid !== null && event.status !== 'completed' && event.status !== 'cancelled';

  return (
    <Card className="overflow-hidden" onClick={onClick}>
      <div className="flex">
        {/* Left type accent bar */}
        <div className="w-1 flex-shrink-0" style={{ backgroundColor: accentColor }} />
        <div className="flex-1 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${EVENT_TYPE_BADGE_CLASSES[event.type] ?? 'bg-gray-100 text-gray-600'}`}
                >
                  {EVENT_TYPE_LABELS[event.type]}
                </span>
                <EventStatusBadge status={event.status} />
                {event.disputeStatus === 'open' && (
                  <Badge className="bg-red-100 text-red-700 shrink-0">
                    <AlertTriangle size={10} className="mr-1" />
                    Dispute
                  </Badge>
                )}
              </div>
              <h3 className="font-semibold text-gray-900 truncate">{event.title}</h3>

              {(homeTeam || awayTeam || event.opponentName) && (
                <div className="flex items-center gap-1.5 mt-1">
                  {/* Left side: home team, or opponent name when we are the away team */}
                  {homeTeam ? (
                    <span className="flex items-center gap-1 text-sm text-gray-700">
                      <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: homeTeam.color }} />
                      {homeTeam.name}
                    </span>
                  ) : (awayTeam && event.opponentName) ? (
                    <span className="text-sm text-gray-700">{event.opponentName}</span>
                  ) : null}
                  {/* vs separator */}
                  {(homeTeam || (awayTeam && event.opponentName)) && (awayTeam || event.opponentName) && (
                    <span className="text-xs text-gray-400">vs</span>
                  )}
                  {/* Right side: away team, or opponent name when we are the home team */}
                  {awayTeam ? (
                    <span className="flex items-center gap-1 text-sm text-gray-700">
                      <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: awayTeam.color }} />
                      {awayTeam.name}
                    </span>
                  ) : event.opponentName ? (
                    <span className="text-sm text-gray-700">{event.opponentName}</span>
                  ) : null}
                </div>
              )}

              <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  {formatDate(event.date)} · {formatTime(event.startTime)}
                </span>
                {(event.location || event.fieldName) && (
                  <span className="flex items-center gap-1">
                    <MapPin size={12} />
                    {[event.location, event.fieldName].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>

              {event.result && (
                <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-sm font-bold text-gray-800">
                  {event.result.placement
                    ? event.result.placement
                    : `${event.result.homeScore} – ${event.result.awayScore}`}
                </div>
              )}
            </div>
          </div>

          <RsvpIndicator event={event} onOpenDetail={onClick} />

          {/* Snack status — shown for all authenticated users */}
          {showInteractive && (
            <div className="mt-3 pt-2.5 border-t border-gray-100 space-y-2" onClick={e => e.stopPropagation()}>
              {(event.snackSignups?.length ?? 0) > 0 && (
                <div className="inline-flex items-center gap-1.5 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-full px-3 py-1">
                  <span aria-hidden="true">🍎</span>
                  <span>
                    {event.snackSignups!.length === 1
                      ? `${event.snackSignups![0].name} bringing snacks`
                      : `${event.snackSignups!.length} volunteers bringing snacks`}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
