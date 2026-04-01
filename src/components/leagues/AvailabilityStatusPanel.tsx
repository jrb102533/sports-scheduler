import { useEffect, useState, useRef } from 'react';
import { Bell, Calendar, ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useCollectionStore } from '@/store/useCollectionStore';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoachInfo {
  uid: string;
  name: string;
  teamId: string;
  teamName: string;
  hasAccount: boolean;
}

interface Props {
  leagueId: string;
  coaches: CoachInfo[];
  onClose: () => void;
  onSendReminder: (coachUids: string[]) => Promise<void>;
}

type ResponseStatus = 'responded' | 'pending' | 'no_account';

interface ResponseSummary {
  coachUid: string;
  coachName: string;
  teamName: string;
  status: ResponseStatus;
  submittedAt?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Mon–Sun order (dayOfWeek: 1–6, 0)
const HEATMAP_DAYS: { label: string; dayOfWeek: number }[] = [
  { label: 'Mon', dayOfWeek: 1 },
  { label: 'Tue', dayOfWeek: 2 },
  { label: 'Wed', dayOfWeek: 3 },
  { label: 'Thu', dayOfWeek: 4 },
  { label: 'Fri', dayOfWeek: 5 },
  { label: 'Sat', dayOfWeek: 6 },
  { label: 'Sun', dayOfWeek: 0 },
];

const HEATMAP_SLOTS: { label: string; start: string; end: string }[] = [
  { label: 'Morning',   start: '06:00', end: '12:00' },
  { label: 'Afternoon', start: '12:00', end: '17:00' },
  { label: 'Evening',   start: '17:00', end: '23:59' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDueDate(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getDueDateCountdown(isoDate: string): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(isoDate);
  due.setHours(0, 0, 0, 0);
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'Overdue';
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  return `Due in ${diffDays} days`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function windowOverlapsSlot(
  windowStart: string,
  windowEnd: string,
  slotStart: string,
  slotEnd: string
): boolean {
  const ws = timeToMinutes(windowStart);
  const we = timeToMinutes(windowEnd);
  const ss = timeToMinutes(slotStart);
  const se = timeToMinutes(slotEnd);
  return ws < se && we > ss;
}

function coverageClass(ratio: number, hasAny: boolean): string {
  if (!hasAny) return 'bg-gray-100';
  if (ratio >= 0.8) return 'bg-green-200';
  if (ratio >= 0.5) return 'bg-yellow-200';
  if (ratio >= 0.2) return 'bg-orange-200';
  return 'bg-red-200';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AvailabilityStatusPanel({ leagueId, coaches, onClose: _onClose, onSendReminder }: Props) {
  const activeCollection = useCollectionStore(s => s.activeCollection);
  const responses = useCollectionStore(s => s.responses);
  const loadCollection = useCollectionStore(s => s.loadCollection);
  const closeCollection = useCollectionStore(s => s.closeCollection);
  const reopenCollection = useCollectionStore(s => s.reopenCollection);

  // ── Reopen date picker state ─────────────────────────────────────────────────
  const [showReopenPicker, setShowReopenPicker] = useState(false);
  const [reopenDate, setReopenDate] = useState('');
  const [reopenError, setReopenError] = useState('');

  // ── Reminder state ───────────────────────────────────────────────────────────
  const [showReminderConfirm, setShowReminderConfirm] = useState(false);
  const [reminderSent, setReminderSent] = useState(false);
  const [reminderSending, setReminderSending] = useState(false);

  // ── Heatmap tooltip state ────────────────────────────────────────────────────
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    available: number;
    total: number;
    missingTeams: string[];
  } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // ── Toast state ──────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load collection on mount ─────────────────────────────────────────────────
  useEffect(() => {
    const unsub = loadCollection(leagueId);
    return () => unsub();
  }, [leagueId, loadCollection]);

  // ── Dismiss tooltip on outside click ────────────────────────────────────────
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        setTooltip(null);
      }
    }
    if (tooltip) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [tooltip]);

  // ── Toast auto-dismiss ───────────────────────────────────────────────────────
  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  // ─── Derived: response summaries ────────────────────────────────────────────

  const respondedSet = new Set(responses.map(r => r.coachUid));

  const summaries: ResponseSummary[] = coaches.map((coach) => {
    const response = responses.find(r => r.coachUid === coach.uid);
    if (response) {
      return {
        coachUid: coach.uid,
        coachName: coach.name,
        teamName: coach.teamName,
        status: 'responded',
        submittedAt: response.submittedAt,
      };
    }
    return {
      coachUid: coach.uid,
      coachName: coach.name,
      teamName: coach.teamName,
      status: coach.hasAccount ? 'pending' : 'no_account',
    };
  });

  const respondedCount = summaries.filter(s => s.status === 'responded').length;
  const pendingCoaches = summaries.filter(s => s.status === 'pending');

  // ─── Derived: heatmap data ───────────────────────────────────────────────────

  // respondedResponses: only coaches who submitted
  const respondedResponses = responses.filter(r => respondedSet.has(r.coachUid));
  const totalRespondents = respondedResponses.length;

  // For each cell, find coaches available and which teams lack coverage
  function getCellData(dayOfWeek: number, slot: { start: string; end: string }) {
    const coachesAvailable: string[] = [];
    const teamsWithCoverage = new Set<string>();

    for (const response of respondedResponses) {
      const coversSlot = response.weeklyWindows.some(
        w =>
          w.dayOfWeek === dayOfWeek &&
          w.available &&
          windowOverlapsSlot(w.startTime, w.endTime, slot.start, slot.end)
      );
      if (coversSlot) {
        coachesAvailable.push(response.coachUid);
        teamsWithCoverage.add(response.teamId);
      }
    }

    const allTeamIds = new Set(coaches.map(c => c.teamId));
    const missingTeamIds = [...allTeamIds].filter(id => !teamsWithCoverage.has(id));
    const missingTeams = missingTeamIds
      .map(id => coaches.find(c => c.teamId === id)?.teamName ?? id)
      // Deduplicate team names (multiple coaches per team)
      .filter((name, i, arr) => arr.indexOf(name) === i);

    return { available: coachesAvailable.length, missingTeams };
  }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  async function handleCloseEarly() {
    if (!activeCollection) return;
    await closeCollection(leagueId, activeCollection.id);
    showToast('Collection closed.');
  }

  async function handleReopen() {
    if (!activeCollection || !reopenDate) return;
    const today = new Date().toISOString().split('T')[0];
    if (reopenDate <= today) {
      setReopenError('New due date must be in the future.');
      return;
    }
    setReopenError('');
    await reopenCollection(leagueId, activeCollection.id, reopenDate);
    setShowReopenPicker(false);
    setReopenDate('');
    showToast('Collection reopened.');
  }

  function handleSendReminder() {
    const uids = pendingCoaches.map(c => c.coachUid);
    setReminderSending(true);
    onSendReminder(uids)
      .then(() => {
        setReminderSent(true);
        showToast(`Reminder sent to ${uids.length} coach${uids.length !== 1 ? 'es' : ''}.`);
      })
      .finally(() => {
        setReminderSending(false);
      });
  }

  // ─── Early returns ───────────────────────────────────────────────────────────

  if (!activeCollection) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <Calendar size={40} className="text-gray-300 mb-3" />
        <p className="text-sm font-medium text-gray-500">No active availability collection</p>
        <p className="text-xs text-gray-400 mt-1">Start a collection from the Schedule Wizard.</p>
      </div>
    );
  }

  const isOpen = activeCollection.status === 'open';
  const isClosed = activeCollection.status === 'closed';
  const minReopenDate = new Date(Date.now() + 86_400_000).toISOString().split('T')[0];

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="relative flex flex-col gap-6">

      {/* ── Toast ─────────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-3 animate-fade-in"
        >
          <span>{toast}</span>
          <button
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
            className="text-gray-400 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Header: status + due date + action ────────────────────────────────── */}
      <section aria-labelledby="collection-header">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isOpen ? 'success' : 'warning'}>
              {isOpen ? 'Open' : 'Closed'}
            </Badge>
            <span className="text-sm text-gray-600">
              {isClosed
                ? `Closed ${activeCollection.closedAt ? formatDueDate(activeCollection.closedAt) : ''}`
                : `${formatDueDate(activeCollection.dueDate)} · ${getDueDateCountdown(activeCollection.dueDate)}`}
            </span>
          </div>

          {/* Close Early / Reopen button */}
          <div className="flex items-center gap-2">
            {isOpen && (
              <Button variant="secondary" size="sm" onClick={handleCloseEarly}>
                Close Early
              </Button>
            )}
            {isClosed && (
              <div className="relative">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowReopenPicker(prev => !prev)}
                  aria-expanded={showReopenPicker}
                  aria-haspopup="true"
                >
                  Reopen
                  <ChevronDown size={14} className={showReopenPicker ? 'rotate-180 transition-transform' : 'transition-transform'} />
                </Button>

                {showReopenPicker && (
                  <div
                    role="dialog"
                    aria-label="Choose new due date"
                    className="absolute right-0 top-full mt-2 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-4 w-64"
                  >
                    <p className="text-xs font-medium text-gray-700 mb-2">New due date</p>
                    <input
                      type="date"
                      value={reopenDate}
                      min={minReopenDate}
                      onChange={e => { setReopenDate(e.target.value); setReopenError(''); }}
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1B3A6B] mb-2"
                    />
                    {reopenError && (
                      <p role="alert" className="text-xs text-red-600 mb-2">{reopenError}</p>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setShowReopenPicker(false); setReopenError(''); setReopenDate(''); }}
                      >
                        Cancel
                      </Button>
                      <Button variant="primary" size="sm" disabled={!reopenDate} onClick={handleReopen}>
                        Confirm
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Response list ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="responses-header">
        <div className="flex items-center justify-between mb-3">
          <h3 id="responses-header" className="text-sm font-semibold text-gray-900">
            Coach Responses
          </h3>
          <span className="text-xs text-gray-500">
            {respondedCount} of {coaches.length} responded
          </span>
        </div>

        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 overflow-hidden" role="list">
          {summaries.map(summary => (
            <li key={summary.coachUid} className="flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition-colors">
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium text-gray-900 truncate">{summary.coachName}</span>
                <span className="text-xs text-gray-500 truncate">{summary.teamName}</span>
              </div>

              <div className="flex flex-col items-end gap-1 ml-4 shrink-0">
                {summary.status === 'responded' && (
                  <>
                    <Badge variant="success">Responded</Badge>
                    {summary.submittedAt && (
                      <span className="text-xs text-gray-400">
                        {new Date(summary.submittedAt).toLocaleDateString('en-AU', {
                          day: 'numeric', month: 'short',
                        })}
                      </span>
                    )}
                  </>
                )}
                {summary.status === 'pending' && (
                  <Badge variant="warning">Pending</Badge>
                )}
                {summary.status === 'no_account' && (
                  <span
                    title="No app account — handle manually"
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 cursor-help"
                    aria-label="No app account — handle manually"
                  >
                    No account
                  </span>
                )}
              </div>
            </li>
          ))}

          {summaries.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-gray-400">
              No coaches found for this league.
            </li>
          )}
        </ul>
      </section>

      {/* ── Send Reminder ─────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-700 font-medium">Send reminder</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {pendingCoaches.length > 0
                ? `${pendingCoaches.length} coach${pendingCoaches.length !== 1 ? 'es' : ''} haven't responded yet`
                : isClosed
                  ? 'Collection is closed'
                  : 'All coaches have responded'}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={pendingCoaches.length === 0 || isClosed || reminderSent || reminderSending}
            onClick={() => setShowReminderConfirm(true)}
            aria-label={`Send reminder to ${pendingCoaches.length} pending coaches`}
          >
            <Bell size={14} />
            {reminderSent ? 'Sent' : 'Send Reminder'}
          </Button>
        </div>
      </section>

      {/* ── Coverage Heatmap ──────────────────────────────────────────────────── */}
      <section aria-labelledby="heatmap-header">
        <h3 id="heatmap-header" className="text-sm font-semibold text-gray-900 mb-1">
          Coach Availability Coverage
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          Based on {totalRespondents} response{totalRespondents !== 1 ? 's' : ''} received so far.
          Tap a cell for details.
        </p>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3" aria-hidden="true">
          {[
            { cls: 'bg-green-200', label: '≥ 80%' },
            { cls: 'bg-yellow-200', label: '50–79%' },
            { cls: 'bg-orange-200', label: '20–49%' },
            { cls: 'bg-red-200', label: '< 20%' },
            { cls: 'bg-gray-100 border border-gray-200', label: 'No data' },
          ].map(({ cls, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded-sm ${cls}`} />
              <span className="text-xs text-gray-500">{label}</span>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <table className="w-full min-w-[420px] border-collapse text-xs" role="grid" aria-label="Availability coverage heatmap">
            <thead>
              <tr>
                <th scope="col" className="w-20 pb-2 text-left font-medium text-gray-400 pr-2" />
                {HEATMAP_DAYS.map(d => (
                  <th
                    key={d.dayOfWeek}
                    scope="col"
                    className="pb-2 font-medium text-gray-500 text-center"
                  >
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HEATMAP_SLOTS.map(slot => (
                <tr key={slot.label}>
                  <th
                    scope="row"
                    className="text-left font-medium text-gray-500 pr-2 py-1 whitespace-nowrap"
                  >
                    {slot.label}
                  </th>
                  {HEATMAP_DAYS.map(d => {
                    const cell = getCellData(d.dayOfWeek, slot);
                    const ratio = totalRespondents > 0 ? cell.available / totalRespondents : 0;
                    const cls = coverageClass(ratio, totalRespondents > 0);
                    const label = totalRespondents > 0
                      ? `${d.label} ${slot.label}: ${cell.available} of ${totalRespondents} coaches available`
                      : `${d.label} ${slot.label}: no responses yet`;

                    return (
                      <td key={d.dayOfWeek} className="p-1 text-center">
                        <button
                          type="button"
                          aria-label={label}
                          className={`w-full h-8 rounded-md ${cls} hover:ring-2 hover:ring-offset-1 hover:ring-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#1B3A6B] transition-shadow`}
                          onClick={e => {
                            const rect = (e.target as HTMLElement).getBoundingClientRect();
                            setTooltip({
                              x: rect.left + rect.width / 2,
                              y: rect.top,
                              available: cell.available,
                              total: totalRespondents,
                              missingTeams: cell.missingTeams,
                            });
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Heatmap Tooltip (portal-style fixed) ─────────────────────────────── */}
      {tooltip && (
        <div
          ref={tooltipRef}
          role="tooltip"
          style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y - 8,
            transform: 'translate(-50%, -100%)',
            zIndex: 60,
          }}
          className="bg-gray-900 text-white text-xs rounded-xl px-3 py-2.5 shadow-xl max-w-[220px] w-max pointer-events-none"
        >
          {tooltip.total === 0 ? (
            <p>No responses yet.</p>
          ) : (
            <>
              <p className="font-semibold mb-1">
                {tooltip.available} of {tooltip.total} coaches available
              </p>
              {tooltip.missingTeams.length > 0 ? (
                <>
                  <p className="text-gray-400 mb-0.5">Teams without coverage:</p>
                  <ul className="list-none space-y-0.5">
                    {tooltip.missingTeams.map(t => (
                      <li key={t} className="text-gray-200">{t}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-gray-400">All teams covered.</p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Reminder confirm dialog ───────────────────────────────────────────── */}
      <ConfirmDialog
        open={showReminderConfirm}
        onClose={() => setShowReminderConfirm(false)}
        onConfirm={handleSendReminder}
        title="Send reminder"
        message={`Send reminder to ${pendingCoaches.length} coach${pendingCoaches.length !== 1 ? 'es' : ''} who haven't responded?`}
        confirmLabel="Send"
      />
    </div>
  );
}
