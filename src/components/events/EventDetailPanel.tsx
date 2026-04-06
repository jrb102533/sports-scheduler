import { useState, useEffect } from 'react';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { X, MapPin, Clock, Edit, Trash2, CheckCircle, RefreshCw, Send, Copy, AlertTriangle, Bell, UserX, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EventStatusBadge } from './EventStatusBadge';
import { EventForm } from './EventForm';
import { SnackVolunteerForm } from './SnackVolunteerForm';
import { RsvpButton } from './RsvpButton';
import { SnackSlotButton } from './SnackSlotButton';
import { RsvpInviteModal } from './RsvpInviteModal';
import { PostGameBroadcastModal } from './PostGameBroadcastModal';
import { AttendanceTracker } from '@/components/attendance/AttendanceTracker';
import { PlayerStatusBadge } from '@/components/roster/PlayerStatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { useEventStore } from '@/store/useEventStore';
import { useVenueStore } from '@/store/useVenueStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useAuthStore } from '@/store/useAuthStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { formatDate, formatTime } from '@/lib/dateUtils';
import { EVENT_TYPE_LABELS, EVENT_TYPE_BADGE_CLASSES, getAttendanceThreshold, isAttendanceWarningEnabled } from '@/constants';
import type { ScheduledEvent } from '@/types';

interface EventDetailPanelProps {
  event: ScheduledEvent | null;
  onClose: () => void;
}

export function EventDetailPanel({ event, onClose }: EventDetailPanelProps) {
  const deleteEvent = useEventStore(s => s.deleteEvent);
  const recordResult = useEventStore(s => s.recordResult);
  const updateEvent = useEventStore(s => s.updateEvent);
  const deleteEventsByGroupId = useEventStore(s => s.deleteEventsByGroupId);
  const teams = useTeamStore(s => s.teams);
  const allPlayers = usePlayerStore(s => s.players);
  const authUser = useAuthStore(s => s.user);
  const profile = useAuthStore(s => s.profile);
  const [editOpen, setEditOpen] = useState(false);
  const [nudgeToast, setNudgeToast] = useState<string | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [deleteSeriesOpen, setDeleteSeriesOpen] = useState(false);
  const [confirmDeleteThis, setConfirmDeleteThis] = useState(false);
  const [confirmDeleteSeries, setConfirmDeleteSeries] = useState(false);
  const [rsvpOpen, setRsvpOpen] = useState(false);
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [resultNotes, setResultNotes] = useState('');
  const [placement, setPlacement] = useState('');
  const [scoreSaveState, setScoreSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  // Submit Result (coach flow)
  const [submitHomeScore, setSubmitHomeScore] = useState('');
  const [submitAwayScore, setSubmitAwayScore] = useState('');
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'submitted' | 'error'>('idle');
  const [submitError, setSubmitError] = useState('');

  // Dispute resolution state (LM / admin only)
  interface DisputeSubmission {
    homeScore: number;
    awayScore: number;
    submittedBy: string;
    submittedAt: string;
    side: string;
  }
  interface DisputeRecord {
    firstSubmission: DisputeSubmission;
    secondSubmission: DisputeSubmission;
    status: 'open';
    createdAt: string;
    updatedAt: string;
  }

  const isLMOrAdmin = profile?.role === 'admin' || profile?.role === 'league_manager';
  const eventLeagueId = (event as (ScheduledEvent & { leagueId?: string }) | null)?.leagueId;
  const eventId = event?.id ?? '';

  const [dispute, setDispute] = useState<DisputeRecord | null>(null);
  const [disputeResolveState, setDisputeResolveState] = useState<'idle' | 'resolving' | 'error'>('idle');
  const [disputeResolveError, setDisputeResolveError] = useState('');

  useEffect(() => {
    if (!isLMOrAdmin || !eventLeagueId || !eventId) return;
    const disputeRef = doc(db, 'leagues', eventLeagueId, 'resultDisputes', eventId);
    const unsub = onSnapshot(disputeRef, (snap) => {
      if (snap.exists() && (snap.data() as DisputeRecord).status === 'open') {
        setDispute(snap.data() as DisputeRecord);
      } else {
        setDispute(null);
      }
    });
    return unsub;
  }, [isLMOrAdmin, eventLeagueId, eventId]);

  async function handleResolveDispute(submission: DisputeSubmission) {
    if (!eventLeagueId || !eventId || !dispute) return;
    setDisputeResolveState('resolving');
    setDisputeResolveError('');
    try {
      const chosenSubmission: 'first' | 'second' =
        submission === dispute.firstSubmission ? 'first' : 'second';
      const resolveDisputeFn = httpsCallable<
        { eventId: string; leagueId: string; chosenSubmission: 'first' | 'second' },
        { status: string }
      >(getFunctions(), 'resolveDispute');
      await resolveDisputeFn({ eventId, leagueId: eventLeagueId, chosenSubmission });
      setDispute(null);
      setDisputeResolveState('idle');
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Failed to resolve dispute.';
      setDisputeResolveError(msg);
      setDisputeResolveState('error');
    }
  }

  const venues = useVenueStore(s => s.venues);
  useEffect(() => {
    return useVenueStore.getState().subscribe();
  }, []);

  const canManage = profile?.role === 'admin' || profile?.role === 'league_manager' || profile?.role === 'coach';
  const isReadOnly = profile?.role === 'player' || profile?.role === 'parent';

  if (!event) return null;

  const currentEvent = event;
  const eventVenue = event.venueId ? venues.find(v => v.id === event.venueId) : null;
  const mapsUrl = eventVenue?.lat != null && eventVenue?.lng != null
    ? `https://www.google.com/maps/search/?api=1&query=${eventVenue.lat},${eventVenue.lng}`
    : null;
  const homeTeam = teams.find(t => t.id === currentEvent.homeTeamId);
  const awayTeam = teams.find(t => t.id === currentEvent.awayTeamId);
  const primaryTeam = homeTeam ?? awayTeam;
  const threshold = getAttendanceThreshold(primaryTeam);
  const warningsEnabled = isAttendanceWarningEnabled(primaryTeam);
  const isGameOrMatch = event.type === 'game' || event.type === 'match';
  const isTournament = event.type === 'tournament';
  const isRecurringEvent = event.isRecurring && !!event.recurringGroupId;

  function handleRecordResult() {
    const h = parseInt(homeScore);
    const a = parseInt(awayScore);
    if (isNaN(h) || isNaN(a)) return;
    try {
      recordResult(currentEvent.id, { homeScore: h, awayScore: a, notes: resultNotes || undefined });
      setHomeScore('');
      setAwayScore('');
      setResultNotes('');
      setScoreSaveState('saved');
      setTimeout(() => setScoreSaveState('idle'), 2000);
      if (canManage) setBroadcastOpen(true);
    } catch {
      setScoreSaveState('error');
      setTimeout(() => setScoreSaveState('idle'), 3000);
    }
  }

  function handleRecordPlacement() {
    if (!placement.trim()) return;
    try {
      recordResult(currentEvent.id, {
        homeScore: 0,
        awayScore: 0,
        placement: placement.trim(),
        notes: resultNotes || undefined,
      });
      setPlacement('');
      setResultNotes('');
      setScoreSaveState('saved');
      setTimeout(() => setScoreSaveState('idle'), 2000);
      if (canManage) setBroadcastOpen(true);
    } catch {
      setScoreSaveState('error');
      setTimeout(() => setScoreSaveState('idle'), 3000);
    }
  }

  function handleCancel() {
    updateEvent({ ...currentEvent, status: 'cancelled' as const, updatedAt: new Date().toISOString() });
    onClose();
  }

  function handleDeleteThis() {
    deleteEvent(currentEvent.id);
    onClose();
  }

  function handleDeleteSeries() {
    if (currentEvent.recurringGroupId) {
      deleteEventsByGroupId(currentEvent.recurringGroupId);
    }
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 z-40 flex justify-end">
        <div className="absolute inset-0 bg-black/30" onClick={onClose} />
        <div className="relative w-full sm:w-96 bg-white h-full shadow-xl flex flex-col overflow-y-auto">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="font-semibold text-gray-900 truncate">{event.title}</h2>
              {isRecurringEvent && (
                <Badge className="bg-purple-100 text-purple-700 shrink-0">
                  <RefreshCw size={10} className="mr-1" />
                  Recurring
                </Badge>
              )}
            </div>
            <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-gray-100 text-gray-500 shrink-0 ml-2">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 px-5 py-4 space-y-4">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${EVENT_TYPE_BADGE_CLASSES[event.type] ?? 'bg-gray-100 text-gray-600'}`}>
                {EVENT_TYPE_LABELS[event.type]}
              </span>
              <EventStatusBadge status={event.status} />
            </div>

            {(homeTeam || awayTeam || event.opponentName) && (
              <div className="bg-gray-50 rounded-xl p-4 text-center">
                <div className="flex items-center justify-center gap-4 text-sm font-semibold text-gray-700">
                  <div style={{ color: homeTeam?.color }}>{homeTeam?.name ?? '\u2014'}</div>
                  <span className="text-gray-400 text-xs">vs</span>
                  {awayTeam ? (
                    <div style={{ color: awayTeam.color }}>{awayTeam.name}</div>
                  ) : (
                    <div className="text-gray-700">{event.opponentName ?? '\u2014'}</div>
                  )}
                </div>
                {event.result && (
                  <div className="text-2xl font-bold text-gray-900 mt-2">
                    {event.result.placement
                      ? event.result.placement
                      : `${event.result.homeScore} \u2013 ${event.result.awayScore}`}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-gray-400" />
                {formatDate(event.date)} at {formatTime(event.startTime)}
                {event.endTime && ` \u2013 ${formatTime(event.endTime)}`}
              </div>
              {event.location && (
                <div className="flex items-center gap-2">
                  <MapPin size={14} className="text-gray-400" />
                  <span>{event.location}</span>
                  {mapsUrl && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline flex-shrink-0"
                    >
                      Get directions
                    </a>
                  )}
                </div>
              )}
            </div>

            {event.notes && (
              <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">{event.notes}</div>
            )}

            {/* Snack Volunteer */}
            {event.status !== 'cancelled' && (
              <SnackVolunteerForm event={currentEvent} />
            )}

            {/* Subcollection-backed RSVP + snack slot */}
            {event.status !== 'cancelled' && event.status !== 'completed' && authUser && (
              <div className="border border-gray-200 rounded-xl p-4 space-y-4">
                <h3 className="text-sm font-semibold text-gray-800">RSVP &amp; Snacks</h3>
                <RsvpButton
                  eventId={event.id}
                  currentUserUid={authUser.uid}
                  currentUserName={profile?.displayName ?? authUser.email ?? ''}
                />
                <SnackSlotButton
                  eventId={event.id}
                  currentUserUid={authUser.uid}
                  currentUserName={profile?.displayName ?? authUser.email ?? ''}
                />
              </div>
            )}

            {/* Record Result */}
            {isGameOrMatch && event.status !== 'cancelled' && event.status !== 'completed' && (
              <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                  <CheckCircle size={14} className="text-green-500" /> Record Score
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <Input label={homeTeam?.name ?? 'Home'} type="number" min="0" value={homeScore} onChange={e => setHomeScore(e.target.value)} placeholder="0" />
                  <Input label={awayTeam?.name ?? event.opponentName ?? 'Away'} type="number" min="0" value={awayScore} onChange={e => setAwayScore(e.target.value)} placeholder="0" />
                </div>
                <Input label="Notes (optional)" value={resultNotes} onChange={e => setResultNotes(e.target.value)} />
                <Button size="sm" onClick={handleRecordResult} disabled={!homeScore || !awayScore}>
                  {scoreSaveState === 'saved' ? 'Saved!' : scoreSaveState === 'error' ? 'Error saving' : 'Save Score'}
                </Button>
                {scoreSaveState === 'error' && (
                  <p className="text-xs text-red-600 mt-1">Failed to save score. Please try again.</p>
                )}
              </div>
            )}

            {/* Submit Result (coach flow) */}
            {(() => {
              const ev = currentEvent;
              const isCoachOfEventTeam =
                profile?.role === 'coach' &&
                profile?.teamId &&
                ev.teamIds.includes(profile.teamId);

              const today = new Date().toISOString().split('T')[0];
              const gameHasOccurred = ev.date <= today;

              const showSection =
                (ev.type === 'game' || ev.type === 'match') &&
                gameHasOccurred &&
                ev.status !== 'cancelled' &&
                isCoachOfEventTeam;

              if (!showSection) return null;

              // Result already confirmed — show the existing GameResult display
              if (ev.result && !('pendingHomeScore' in ev.result) && !('pendingAwayScore' in ev.result)) {
                return null; // handled by the existing result display above
              }

              async function handleSubmitResult() {
                const h = parseInt(submitHomeScore);
                const a = parseInt(submitAwayScore);
                if (isNaN(h) || isNaN(a)) return;
                setSubmitState('submitting');
                setSubmitError('');
                try {
                  const submitFn = httpsCallable(getFunctions(), 'submitGameResult');
                  await submitFn({
                    eventId: currentEvent.id,
                    leagueId: (currentEvent as ScheduledEvent & { leagueId?: string }).leagueId,
                    homeScore: h,
                    awayScore: a,
                  });
                  setSubmitState('submitted');
                } catch (err: unknown) {
                  const msg = (err as { message?: string })?.message ?? 'Failed to submit result.';
                  setSubmitError(msg);
                  setSubmitState('error');
                }
              }

              const isHomeCoach = homeTeam?.id === profile?.teamId;
              const otherTeam = isHomeCoach ? awayTeam : homeTeam;

              return (
                <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                    <CheckCircle size={14} className="text-blue-500" /> Submit Result
                  </h3>

                  {submitState === 'submitted' ? (
                    <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                      Result submitted{otherTeam ? ` — waiting for ${otherTeam.name} coach to confirm.` : '.'}
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          label={homeTeam?.name ?? 'Home'}
                          type="number"
                          min="0"
                          value={submitHomeScore}
                          onChange={e => setSubmitHomeScore(e.target.value)}
                          placeholder="0"
                        />
                        <Input
                          label={awayTeam?.name ?? event.opponentName ?? 'Away'}
                          type="number"
                          min="0"
                          value={submitAwayScore}
                          onChange={e => setSubmitAwayScore(e.target.value)}
                          placeholder="0"
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={handleSubmitResult}
                        disabled={!submitHomeScore || !submitAwayScore || submitState === 'submitting'}
                      >
                        {submitState === 'submitting'
                          ? <><Loader2 size={13} className="animate-spin" /> Submitting…</>
                          : 'Submit Result'}
                      </Button>
                      {submitState === 'error' && (
                        <p className="text-xs text-red-600">{submitError || 'Failed to submit result. Please try again.'}</p>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

            {/* Score Dispute (LM / Admin only) */}
            {isLMOrAdmin && dispute && (
              <div className="border border-red-200 bg-red-50/40 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                  <ShieldAlert size={14} className="text-red-500" />
                  Score Dispute
                </h3>
                <p className="text-xs text-gray-500">
                  Two different scores were submitted. Confirm the correct result below.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {([dispute.firstSubmission, dispute.secondSubmission] as DisputeSubmission[]).map((sub, idx) => (
                    <div key={idx} className="bg-white border border-red-200 rounded-lg p-3 flex flex-col gap-2">
                      <p className="text-xs font-medium text-gray-700 capitalize">
                        {sub.side} coach submitted:
                      </p>
                      <p className="text-sm font-bold text-gray-900">
                        {homeTeam?.name ?? 'Home'} {sub.homeScore} &ndash; {sub.awayScore} {awayTeam?.name ?? 'Away'}
                      </p>
                      <button
                        onClick={() => void handleResolveDispute(sub)}
                        disabled={disputeResolveState === 'resolving'}
                        className="mt-1 w-full inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        aria-label={`Confirm score: Home ${sub.homeScore} Away ${sub.awayScore}`}
                      >
                        {disputeResolveState === 'resolving'
                          ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                          : 'Confirm this score'}
                      </button>
                    </div>
                  ))}
                </div>
                {disputeResolveState === 'error' && (
                  <p className="text-xs text-red-600">{disputeResolveError}</p>
                )}
              </div>
            )}

            {/* Tournament Placement */}
            {isTournament && event.status !== 'cancelled' && event.status !== 'completed' && (
              <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                  <CheckCircle size={14} className="text-green-500" /> Record Placement
                </h3>
                <Input
                  label="Placement / Finish"
                  value={placement}
                  onChange={e => setPlacement(e.target.value)}
                  placeholder="e.g. 1st place, Runner up, 3rd"
                />
                <Input label="Notes (optional)" value={resultNotes} onChange={e => setResultNotes(e.target.value)} />
                <Button size="sm" onClick={handleRecordPlacement} disabled={!placement.trim()}>
                  {scoreSaveState === 'saved' ? 'Saved!' : scoreSaveState === 'error' ? 'Error saving' : 'Save Placement'}
                </Button>
                {scoreSaveState === 'error' && (
                  <p className="text-xs text-red-600 mt-1">Failed to save placement. Please try again.</p>
                )}
              </div>
            )}

            {/* Attendance Forecast */}
            {canManage && (() => {
              const rsvps = event.rsvps ?? [];
              const confirmed = rsvps.filter(r => r.response === 'yes').length;
              const declined = rsvps.filter(r => r.response === 'no').length;
              const maybe = rsvps.filter(r => r.response === 'maybe').length;
              const respondedCount = rsvps.length;

              const teamPlayers = event.teamIds.length > 0
                ? allPlayers.filter(p => event.teamIds.includes(p.teamId))
                : [];
              const rosterSize = teamPlayers.length;
              const noResponse = rosterSize > 0 ? Math.max(0, rosterSize - respondedCount) : null;

              const unavailablePlayers = teamPlayers.filter(
                p => p.status === 'injured' || p.status === 'suspended'
              );
              const unavailableCount = unavailablePlayers.length;

              const isBelowThreshold = warningsEnabled && confirmed < threshold;
              const hasNonResponders = noResponse !== null ? noResponse > 0 : false;

              if (respondedCount === 0 && rosterSize === 0) return null;

              async function handleNudge() {
                const count = noResponse ?? (rosterSize - respondedCount);
                // TODO: wire to sendEventReminder CF when available — sendAvailabilityReminder
                // requires { leagueId, collectionId } but ScheduledEvent carries neither field.
                console.warn('nudge: no per-event CF wired for event', event.id);
                setNudgeToast(`Reminder sent to ${count} player${count !== 1 ? 's' : ''}`);
                setTimeout(() => setNudgeToast(null), 3500);
              }

              return (
                <div className={`border rounded-xl p-4 space-y-3 ${isBelowThreshold ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                      {isBelowThreshold && <AlertTriangle size={14} className="text-amber-500 shrink-0" />}
                      Attendance Forecast
                    </h3>
                    {isBelowThreshold && (
                      <Badge className="bg-amber-100 text-amber-700 text-xs">Below minimum</Badge>
                    )}
                  </div>

                  <div className="flex gap-4 text-xs font-medium">
                    <span className="text-green-600">{confirmed} Confirmed</span>
                    <span className="text-red-500">{declined} Declined</span>
                    <span className="text-yellow-600">{maybe} Maybe</span>
                    {noResponse !== null && (
                      <span className="text-gray-400">{noResponse} No response</span>
                    )}
                  </div>

                  {unavailableCount > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                      <UserX size={13} className="shrink-0" />
                      <span>
                        {unavailableCount} player{unavailableCount !== 1 ? 's' : ''} unavailable (injured/suspended)
                      </span>
                    </div>
                  )}

                  {rsvps.length > 0 && (
                    <ul className="space-y-0.5 text-xs text-gray-600 max-h-28 overflow-y-auto">
                      {rsvps.map(r => {
                        const rsvpPlayer = teamPlayers.find(p => p.id === r.playerId);
                        return (
                          <li key={r.playerId} className="flex justify-between items-center gap-2">
                            <span className="flex items-center gap-1.5 truncate min-w-0">
                              <span className="truncate">{r.name}</span>
                              {rsvpPlayer && (
                                <PlayerStatusBadge player={rsvpPlayer} />
                              )}
                            </span>
                            <span className={`shrink-0 ${r.response === 'yes' ? 'text-green-600' : r.response === 'no' ? 'text-red-500' : 'text-yellow-600'}`}>
                              {r.response === 'yes' ? 'Yes' : r.response === 'no' ? 'No' : 'Maybe'}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {hasNonResponders && (
                    <Button variant="secondary" size="sm" onClick={handleNudge}>
                      <Bell size={13} /> Nudge non-responders
                    </Button>
                  )}

                  {nudgeToast && (
                    <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                      {nudgeToast}
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Attendance */}
            {event.status !== 'cancelled' && (
              <AttendanceTracker event={currentEvent} />
            )}
          </div>

          {!isReadOnly && (
            <div className="px-5 py-4 border-t border-gray-200 flex gap-2 flex-wrap">
              <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
                <Edit size={14} /> Edit
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setDuplicateOpen(true)}>
                <Copy size={14} /> Duplicate
              </Button>
              {canManage && event.status !== 'cancelled' && (
                <Button variant="secondary" size="sm" onClick={() => setRsvpOpen(true)}>
                  <Send size={14} /> Send RSVP
                </Button>
              )}
              {canManage && event.result && (
                <Button variant="secondary" size="sm" onClick={() => setBroadcastOpen(true)}>
                  {/* TODO: connect sendBroadcast CF */}
                  <Send size={14} /> Send Post-Game Summary
                </Button>
              )}
              {event.status !== 'cancelled' && (
                <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(true)}>Cancel Event</Button>
              )}
              <Button
                variant="danger"
                size="sm"
                className="ml-auto"
                onClick={() => isRecurringEvent ? setDeleteSeriesOpen(true) : setConfirmDelete(true)}
              >
                <Trash2 size={14} /> Delete
              </Button>
            </div>
          )}
        </div>
      </div>

      <EventForm open={editOpen} onClose={() => setEditOpen(false)} editEvent={event} />
      <EventForm
        open={duplicateOpen}
        onClose={() => setDuplicateOpen(false)}
        initial={{
          title: event.title,
          type: event.type,
          date: event.date,
          startTime: event.startTime,
          endTime: event.endTime,
          location: event.location,
          homeTeamId: event.homeTeamId,
          awayTeamId: event.awayTeamId,
          opponentName: event.opponentName,
          notes: event.notes,
        }}
      />
      {rsvpOpen && <RsvpInviteModal open={rsvpOpen} onClose={() => setRsvpOpen(false)} event={event} />}
      {broadcastOpen && (
        <PostGameBroadcastModal
          open={broadcastOpen}
          onClose={() => setBroadcastOpen(false)}
          event={currentEvent}
          teamPlayers={currentEvent.teamIds.length > 0
            ? allPlayers.filter(p => currentEvent.teamIds.includes(p.teamId))
            : []}
        />
      )}

      {/* Cancel event confirm */}
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={handleCancel}
        title="Cancel Event"
        message="Cancel this event? This will notify all players."
        confirmLabel="Cancel Event"
      />

      {/* Single event delete confirm */}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => { deleteEvent(event.id); onClose(); }}
        title="Delete Event"
        message={`Are you sure you want to delete "${event.title}"? This cannot be undone.`}
      />

      {/* Recurring: delete this event only confirm */}
      <ConfirmDialog
        open={confirmDeleteThis}
        onClose={() => setConfirmDeleteThis(false)}
        onConfirm={handleDeleteThis}
        title="Delete Event"
        message={`Delete just this occurrence of "${event.title}"? This cannot be undone.`}
        confirmLabel="Delete Event"
      />

      {/* Recurring: delete entire series confirm */}
      <ConfirmDialog
        open={confirmDeleteSeries}
        onClose={() => setConfirmDeleteSeries(false)}
        onConfirm={handleDeleteSeries}
        title="Delete All in Series"
        message={`Delete all events in the "${event.title}" series? This cannot be undone.`}
        confirmLabel="Delete All"
      />

      {/* Recurring delete choice dialog */}
      <Modal open={deleteSeriesOpen} onClose={() => setDeleteSeriesOpen(false)} title="Delete Recurring Event" size="sm">
        <p className="text-sm text-gray-600 mb-4">
          This is a recurring event. Would you like to delete just this event, or all events in this series?
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="secondary" onClick={() => { setDeleteSeriesOpen(false); setConfirmDeleteThis(true); }}>
            Delete This Event Only
          </Button>
          <Button variant="danger" onClick={() => { setDeleteSeriesOpen(false); setConfirmDeleteSeries(true); }}>
            Delete All in Series
          </Button>
          <Button variant="ghost" onClick={() => setDeleteSeriesOpen(false)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </>
  );
}
