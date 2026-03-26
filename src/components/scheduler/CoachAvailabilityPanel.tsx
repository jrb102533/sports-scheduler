import { useEffect, useState } from 'react';
import { Plus, Trash2, CheckCircle2, Clock, Send } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useCoachAvailabilityStore } from '@/store/useCoachAvailabilityStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { format, parseISO } from 'date-fns';
import type { LeagueAvailabilityRequest, CoachAvailability, DateRange } from '@/types';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  leagueId: string;
}

export function CoachAvailabilityPanel({ leagueId }: Props) {
  const { requests, submissions, subscribeRequests, subscribeSubmissions, addRequest, updateRequest, saveSubmission } = useCoachAvailabilityStore();
  const allTeams = useTeamStore(s => s.teams);
  const profile = useAuthStore(s => s.profile);
  const uid = useAuthStore(s => s.user?.uid) ?? '';
  const addNotification = useNotificationStore(s => s.addNotification);

  useEffect(() => {
    const u1 = subscribeRequests(leagueId);
    const u2 = subscribeSubmissions(leagueId);
    return () => { u1(); u2(); };
  }, [leagueId, subscribeRequests, subscribeSubmissions]);

  const leagueTeams = allTeams.filter(t => t.leagueId === leagueId);
  const activeRequest = requests.find(r => r.leagueId === leagueId && r.status === 'open');
  const isAdmin = profile?.role === 'admin' || profile?.role === 'league_manager';
  const isCoach = profile?.role === 'coach';

  // Coach's own team in this league
  const myTeam = isCoach ? leagueTeams.find(t => t.coachId === uid) : undefined;
  const mySubmission = myTeam ? submissions.find(s => s.teamId === myTeam.id && s.leagueId === leagueId) : undefined;

  // --- League Manager: Create Request ---
  const [reqFormOpen, setReqFormOpen] = useState(false);
  const [seasonStart, setSeasonStart] = useState('');
  const [seasonEnd, setSeasonEnd] = useState('');
  const [deadline, setDeadline] = useState('');
  const [reqErrors, setReqErrors] = useState<Record<string, string>>({});
  const [reqSaving, setReqSaving] = useState(false);

  function validateRequest() {
    const e: Record<string, string> = {};
    if (!seasonStart) e.seasonStart = 'Required';
    if (!seasonEnd) e.seasonEnd = 'Required';
    if (!deadline) e.deadline = 'Required';
    if (seasonEnd && seasonStart && seasonEnd <= seasonStart) e.seasonEnd = 'Must be after start';
    if (deadline && seasonEnd && deadline > seasonEnd) e.deadline = 'Must be before season end';
    setReqErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSendRequest() {
    if (!validateRequest()) return;
    setReqSaving(true);
    const now = new Date().toISOString();
    const req: LeagueAvailabilityRequest = {
      id: crypto.randomUUID(),
      leagueId,
      seasonStart,
      seasonEnd,
      deadline,
      status: 'open',
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
    };
    await addRequest(req);
    // Notify all coaches in the league
    for (const team of leagueTeams) {
      if (!team.coachId) continue;
      await addNotification({
        id: crypto.randomUUID(),
        type: 'availability_request',
        title: 'Availability Request',
        message: `Please submit your team's availability for the upcoming season. Deadline: ${format(parseISO(deadline), 'MMM d, yyyy')}.`,
        isRead: false,
        createdAt: now,
      });
    }
    setReqSaving(false);
    setReqFormOpen(false);
  }

  async function handleCloseRequest() {
    if (!activeRequest) return;
    await updateRequest({ ...activeRequest, status: 'closed', updatedAt: new Date().toISOString() });
  }

  async function handleReopenRequest() {
    const closedReq = requests.find(r => r.leagueId === leagueId && r.status === 'closed');
    if (!closedReq) return;
    await updateRequest({ ...closedReq, status: 'open', updatedAt: new Date().toISOString() });
  }

  // --- Coach: Submit Availability ---
  const [subFormOpen, setSubFormOpen] = useState(false);
  const [unavailable, setUnavailable] = useState<DateRange[]>(mySubmission?.unavailableDates ?? []);
  const [preferred, setPreferred] = useState<DateRange[]>(mySubmission?.preferredDates ?? []);
  const [prefDays, setPrefDays] = useState<number[]>(mySubmission?.preferredDaysOfWeek ?? []);
  const [prefTimeStart, setPrefTimeStart] = useState(mySubmission?.preferredTimeStart ?? '');
  const [prefTimeEnd, setPrefTimeEnd] = useState(mySubmission?.preferredTimeEnd ?? '');
  const [subSaving, setSubSaving] = useState(false);

  function openSubForm() {
    setUnavailable(mySubmission?.unavailableDates ?? []);
    setPreferred(mySubmission?.preferredDates ?? []);
    setPrefDays(mySubmission?.preferredDaysOfWeek ?? []);
    setPrefTimeStart(mySubmission?.preferredTimeStart ?? '');
    setPrefTimeEnd(mySubmission?.preferredTimeEnd ?? '');
    setSubFormOpen(true);
  }

  function addDateRange(setter: React.Dispatch<React.SetStateAction<DateRange[]>>) {
    setter(prev => [...prev, { startDate: '', endDate: '' }]);
  }

  function updateDateRange(setter: React.Dispatch<React.SetStateAction<DateRange[]>>, i: number, patch: Partial<DateRange>) {
    setter(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  function removeDateRange(setter: React.Dispatch<React.SetStateAction<DateRange[]>>, i: number) {
    setter(prev => prev.filter((_, idx) => idx !== i));
  }

  function toggleDay(day: number) {
    setPrefDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  }

  async function handleSaveSubmission() {
    if (!myTeam || !activeRequest) return;
    setSubSaving(true);
    const now = new Date().toISOString();
    const sub: CoachAvailability = {
      id: `${leagueId}_${myTeam.id}`,
      leagueId,
      teamId: myTeam.id,
      coachId: uid,
      requestId: activeRequest.id,
      unavailableDates: unavailable.filter(r => r.startDate && r.endDate),
      preferredDates: preferred.filter(r => r.startDate && r.endDate),
      preferredDaysOfWeek: prefDays,
      preferredTimeStart: prefTimeStart || undefined,
      preferredTimeEnd: prefTimeEnd || undefined,
      submittedAt: mySubmission?.submittedAt ?? now,
      updatedAt: now,
    };
    await saveSubmission(sub);
    setSubSaving(false);
    setSubFormOpen(false);
  }

  // Response summary for LM view
  const respondedTeamIds = new Set(submissions.map(s => s.teamId));
  const teamsWithCoach = leagueTeams.filter(t => t.coachId);

  return (
    <div className="space-y-4">
      {/* League Manager view */}
      {isAdmin && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-800">Availability Request</h3>
            {!activeRequest && !requests.some(r => r.leagueId === leagueId && r.status === 'closed') && (
              <Button size="sm" onClick={() => setReqFormOpen(true)}><Send size={14} /> Send Request</Button>
            )}
            {activeRequest && (
              <Button size="sm" variant="secondary" onClick={() => void handleCloseRequest()}>Close Submissions</Button>
            )}
            {!activeRequest && requests.some(r => r.leagueId === leagueId && r.status === 'closed') && (
              <Button size="sm" variant="secondary" onClick={() => void handleReopenRequest()}>Re-open</Button>
            )}
          </div>

          {!activeRequest && !requests.some(r => r.leagueId === leagueId) ? (
            <p className="text-sm text-gray-400">No request sent yet. Send a request to collect coach availability.</p>
          ) : (
            <div>
              {activeRequest && (
                <p className="text-xs text-gray-500 mb-3">
                  Open · Season {format(parseISO(activeRequest.seasonStart), 'MMM d')}–{format(parseISO(activeRequest.seasonEnd), 'MMM d, yyyy')} · Deadline {format(parseISO(activeRequest.deadline), 'MMM d, yyyy')}
                </p>
              )}
              {requests.find(r => r.leagueId === leagueId && r.status === 'closed') && !activeRequest && (
                <p className="text-xs text-amber-600 mb-3">Submissions closed.</p>
              )}
              {teamsWithCoach.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-gray-600 mb-2">Responses ({respondedTeamIds.size}/{teamsWithCoach.length})</p>
                  {teamsWithCoach.map(team => {
                    const sub = submissions.find(s => s.teamId === team.id);
                    return (
                      <div key={team.id} className="flex items-center gap-2 text-sm">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: team.color }} />
                        <span className="flex-1 text-gray-700">{team.name}</span>
                        {sub ? (
                          <span className="flex items-center gap-1 text-xs text-green-600">
                            <CheckCircle2 size={12} /> Submitted
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-gray-400">
                            <Clock size={12} /> Pending
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Coach view */}
      {isCoach && myTeam && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-800">Your Availability</h3>
            {activeRequest && (
              <Button size="sm" onClick={openSubForm}>
                {mySubmission ? <><CheckCircle2 size={14} /> Update</> : <><Plus size={14} /> Submit</>}
              </Button>
            )}
          </div>
          {!activeRequest ? (
            <p className="text-sm text-gray-400">No availability request is currently open for this league.</p>
          ) : mySubmission ? (
            <div className="text-xs text-gray-500 space-y-1">
              <p className="text-green-600 font-medium">Submitted {format(parseISO(mySubmission.submittedAt ?? mySubmission.updatedAt), 'MMM d, yyyy')}</p>
              <p>{mySubmission.unavailableDates.length} unavailable period{mySubmission.unavailableDates.length !== 1 ? 's' : ''}</p>
              <p>{mySubmission.preferredDaysOfWeek.length > 0 ? `Preferred days: ${mySubmission.preferredDaysOfWeek.map(d => DAY_LABELS[d]).join(', ')}` : 'No day preferences set'}</p>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Deadline: {format(parseISO(activeRequest.deadline), 'MMM d, yyyy')}. Please submit your availability.</p>
          )}
        </div>
      )}

      {/* Create Request Modal */}
      <Modal open={reqFormOpen} onClose={() => setReqFormOpen(false)} title="Send Availability Request" size="sm">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Season Start" type="date" value={seasonStart} onChange={e => setSeasonStart(e.target.value)} error={reqErrors.seasonStart} />
            <Input label="Season End" type="date" value={seasonEnd} onChange={e => setSeasonEnd(e.target.value)} error={reqErrors.seasonEnd} />
          </div>
          <Input label="Submission Deadline" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} error={reqErrors.deadline} />
          <p className="text-xs text-gray-500">An in-app notification will be sent to all coaches in this league.</p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setReqFormOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleSendRequest()} disabled={reqSaving}>
              {reqSaving ? 'Sending…' : 'Send Request'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Coach Submission Modal */}
      <Modal open={subFormOpen} onClose={() => setSubFormOpen(false)} title="Submit Your Availability" size="md">
        <div className="space-y-5">
          {/* Unavailable dates */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Unavailable Dates <span className="text-xs text-gray-400">(hard — scheduler will not schedule on these)</span></label>
              <Button size="sm" variant="secondary" onClick={() => addDateRange(setUnavailable)}><Plus size={13} /> Add</Button>
            </div>
            <div className="space-y-2">
              {unavailable.map((r, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Input label="Start" type="date" value={r.startDate} onChange={e => updateDateRange(setUnavailable, i, { startDate: e.target.value })} />
                  <Input label="End" type="date" value={r.endDate} onChange={e => updateDateRange(setUnavailable, i, { endDate: e.target.value })} />
                  <Input label="Note (opt.)" value={r.note ?? ''} onChange={e => updateDateRange(setUnavailable, i, { note: e.target.value })} placeholder="e.g. Tournament" />
                  <button type="button" onClick={() => removeDateRange(setUnavailable, i)} className="mb-0.5 p-2 text-red-400 hover:text-red-600 rounded"><Trash2 size={14} /></button>
                </div>
              ))}
              {unavailable.length === 0 && <p className="text-xs text-gray-400">None added</p>}
            </div>
          </div>

          {/* Preferred days */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">Preferred Days <span className="text-xs text-gray-400">(optional)</span></label>
            <div className="flex gap-2 flex-wrap">
              {DAY_LABELS.map((day, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${prefDays.includes(i) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          {/* Preferred time window */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">Preferred Time Window <span className="text-xs text-gray-400">(optional)</span></label>
            <div className="flex gap-3">
              <Input label="From" type="time" value={prefTimeStart} onChange={e => setPrefTimeStart(e.target.value)} />
              <Input label="To" type="time" value={prefTimeEnd} onChange={e => setPrefTimeEnd(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setSubFormOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleSaveSubmission()} disabled={subSaving}>
              {subSaving ? 'Saving…' : mySubmission ? 'Update Availability' : 'Submit Availability'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
