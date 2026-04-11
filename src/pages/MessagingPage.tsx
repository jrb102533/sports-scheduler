import { useState, useEffect } from 'react';
import { MessageSquare, Phone, Users, AlertCircle, Mail, CheckCircle, XCircle, Shield, MessageCircle, ChevronLeft } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { ThreadView } from '@/components/messaging/ThreadView';
import { DmList } from '@/components/messaging/DmList';
import { useTeamStore } from '@/store/useTeamStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useAuthStore, getActiveMembership, isMemberOfTeam } from '@/store/useAuthStore';
import { useTeamChatStore } from '@/store/useTeamChatStore';
import { useDmStore, dmThreadId } from '@/store/useDmStore';
import { functions, db } from '@/lib/firebase';
import { FEATURE_SMS } from '@/lib/features';
import type { Player, Team, UserProfile, DmThread } from '@/types';


type Channel = 'sms' | 'email';
type SendState = 'idle' | 'sending' | 'success' | 'error';
type MainTab = 'chat' | 'dms' | 'broadcast';

const sendSms = httpsCallable<{ to: string[]; message: string }, { sent: number; failed: number; errors: string[] }>(
  functions, 'sendSms'
);

const sendEmailFn = httpsCallable<{ to: string[]; subject: string; message: string; teamIds?: string[] }, { sent: number; failed: number; errors: string[] }>(functions, 'sendEmail');

const roleColors: Record<string, string> = {
  admin: 'text-purple-600 bg-purple-50',
  league_manager: 'text-indigo-600 bg-indigo-50',
  coach: 'text-blue-600 bg-blue-50',
  player: 'text-green-600 bg-green-50',
  parent: 'text-orange-600 bg-orange-50',
};

// ── Team Chat ────────────────────────────────────────────────────────────────

function TeamChatPanel({ teamId }: { teamId: string }) {
  const uid = useAuthStore(s => s.user?.uid ?? '');
  const profile = useAuthStore(s => s.profile);
  const senderName = profile?.displayName || profile?.email || 'You';
  const messages = useTeamChatStore(s => s.messages);
  const loading = useTeamChatStore(s => s.loading);
  const subscribe = useTeamChatStore(s => s.subscribe);
  const sendMessage = useTeamChatStore(s => s.sendMessage);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useTeamChatStore.getState().subscribe(teamId);
  }, [teamId]);

  // suppress unused warning — subscribe used via getState() above
  void subscribe;

  return (
    <div className="flex flex-col h-full">
      <ThreadView
        messages={messages}
        loading={loading}
        currentUid={uid}
        placeholder="Message the team…"
        onSend={text => sendMessage(teamId, uid, senderName, text)}
      />
    </div>
  );
}

// ── Direct Messages ──────────────────────────────────────────────────────────

function DmPanel({ myUid, myName }: { myUid: string; myName: string }) {
  const allTeams = useTeamStore(s => s.teams);
  const players = usePlayerStore(s => s.players);
  const profile = useAuthStore(s => s.profile);
  const threads = useDmStore(s => s.threads);
  const messages = useDmStore(s => s.messages);
  const activeThreadId = useDmStore(s => s.activeThreadId);
  const loadingThreads = useDmStore(s => s.loadingThreads);
  const loadingMessages = useDmStore(s => s.loadingMessages);
  const sendDm = useDmStore(s => s.sendDm);

  const [activeThread, setActiveThread] = useState<DmThread | null>(null);
  const [teamMembers, setTeamMembers] = useState<UserProfile[]>([]);
  const [showNewDm, setShowNewDm] = useState(false);

  // Subscribe to thread list
  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useDmStore.getState().subscribeThreads(myUid);
  }, [myUid]);

  // Load team members for the DM picker.
  // Uses player.linkedUid (always set) + team coachIds to find all user accounts
  // on the same team — avoids relying on the legacy profile.teamId scalar which
  // is absent for multi-membership users added via the invite flow.
  useEffect(() => {
    if (!profile || allTeams.length === 0) return;

    const myTeamIds = new Set(
      allTeams
        .filter(t => isMemberOfTeam(profile, t.id) || profile.role === 'admin')
        .map(t => t.id)
    );
    if (myTeamIds.size === 0) return;

    // Collect all UIDs reachable from these teams:
    // 1. Players with a linked user account
    const linkedUids = new Set<string>(
      players
        .filter(p => myTeamIds.has(p.teamId) && p.linkedUid)
        .map(p => p.linkedUid!)
    );
    // 2. Coaches from the team documents
    allTeams
      .filter(t => myTeamIds.has(t.id))
      .forEach(t => {
        if (t.coachId) linkedUids.add(t.coachId);
        t.coachIds?.forEach(id => linkedUids.add(id));
      });
    // Exclude self
    linkedUids.delete(myUid);

    if (linkedUids.size === 0) return;

    // Batch-load user profiles directly by document ID (uid === docId in /users)
    Promise.all([...linkedUids].map(uid => getDoc(doc(db, 'users', uid))))
      .then(snaps => {
        const members: UserProfile[] = snaps
          .filter(d => d.exists())
          .map(d => d.data() as UserProfile)
          .filter(u => u.uid && u.displayName);
        setTeamMembers(members);
      })
      .catch(err => console.error('[DmPanel] load members:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUid, allTeams.length, players.length]);

  function openThread(thread: DmThread) {
    setActiveThread(thread);
    setShowNewDm(false);
    useDmStore.getState().subscribeMessages(thread.id);
  }

  function openNewDmWith(member: UserProfile) {
    const threadId = dmThreadId(myUid, member.uid);
    // Check if thread already exists
    const existing = threads.find(t => t.id === threadId);
    if (existing) {
      openThread(existing);
    } else {
      // Synthetic thread for UI (no Firestore doc yet; created on first send)
      const synthetic: DmThread = {
        id: threadId,
        participants: [myUid, member.uid].sort() as [string, string],
        participantNames: { [myUid]: myName, [member.uid]: member.displayName },
        lastMessage: '',
        lastMessageAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setActiveThread(synthetic);
      setShowNewDm(false);
      useDmStore.getState().subscribeMessages(threadId);
    }
  }

  const otherName = activeThread
    ? (activeThread.participantNames[activeThread.participants.find(uid => uid !== myUid) ?? ''] ?? 'Unknown')
    : '';

  return (
    <div className="flex flex-col h-full">
      {/* Thread selected — show back button + messages */}
      {activeThread ? (
        <>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-white">
            <button onClick={() => setActiveThread(null)} className="text-gray-500 hover:text-gray-800">
              <ChevronLeft size={20} />
            </button>
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700">
              {otherName.charAt(0).toUpperCase()}
            </div>
            <span className="font-medium text-gray-900">{otherName}</span>
          </div>
          <div className="flex-1 overflow-hidden">
            <ThreadView
              messages={messages}
              loading={loadingMessages}
              currentUid={myUid}
              placeholder={`Message ${otherName}…`}
              onSend={async text => {
                const otherUid = activeThread.participants.find(uid => uid !== myUid) ?? '';
                const otherDisplayName = activeThread.participantNames[otherUid] ?? 'Unknown';
                await sendDm(myUid, myName, otherUid, otherDisplayName, text);
              }}
            />
          </div>
        </>
      ) : showNewDm ? (
        /* New DM — pick a member */
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-white">
            <button onClick={() => setShowNewDm(false)} className="text-gray-500 hover:text-gray-800">
              <ChevronLeft size={20} />
            </button>
            <span className="font-medium text-gray-900">New Message</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {teamMembers.length === 0 ? (
              <p className="text-sm text-gray-400 p-6 text-center">No team members found</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {teamMembers.map(member => (
                  <button
                    key={member.uid}
                    onClick={() => openNewDmWith(member)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700">
                      {member.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{member.displayName}</p>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${roleColors[member.role] ?? 'text-gray-600 bg-gray-100'}`}>
                        {member.role.replace('_', ' ')}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Thread list */
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white">
            <span className="font-medium text-gray-900">Direct Messages</span>
            <button
              onClick={() => setShowNewDm(true)}
              className="text-xs text-blue-600 font-medium hover:underline"
            >
              + New
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <DmList
              threads={threads}
              loading={loadingThreads}
              currentUid={myUid}
              activeThreadId={activeThreadId}
              onSelectThread={openThread}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Broadcast (existing) ─────────────────────────────────────────────────────

function BroadcastPanel() {
  const allTeams = useTeamStore(s => s.teams);
  const players = usePlayerStore(s => s.players);
  const profile = useAuthStore(s => s.profile);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [platformUsers, setPlatformUsers] = useState<UserProfile[]>([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [channel, setChannel] = useState<Channel>(FEATURE_SMS ? 'sms' : 'email');
  const [sendState, setSendState] = useState<SendState>('idle');
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; errors: string[] } | null>(null);

  const isAdmin = profile?.role === 'admin';

  const teams: Team[] = isAdmin
    ? allTeams
    : allTeams.filter(t =>
        t.createdBy === profile?.uid ||
        t.coachId === profile?.uid ||
        t.coachIds?.includes(profile?.uid ?? '') ||
        t.id === profile?.teamId
      );

  useEffect(() => {
    if (!isAdmin) return;
    getDocs(collection(db, 'users')).then(snap => {
      const users = snap.docs.map(d => d.data() as UserProfile).filter(u => u.uid !== profile?.uid);
      setPlatformUsers(users);
    });
  }, [isAdmin, profile?.uid]);

  const playersForChannel = (ch: Channel) =>
    players.filter(p =>
      teams.some(t => t.id === p.teamId) &&
      (ch === 'sms'
        ? !!(p.parentContact?.parentPhone || p.parentContact2?.parentPhone)
        : !!(p.email || p.parentContact?.parentEmail || p.parentContact2?.parentEmail))
    );

  const eligiblePlayers = playersForChannel(channel);
  const eligiblePlatformUsers = platformUsers.filter(u => u.email);

  function togglePlayer(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleUser(uid: string) {
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  }

  function selectTeam(teamId: string) {
    const teamPlayerIds = eligiblePlayers.filter(p => p.teamId === teamId).map(p => p.id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allSelected = teamPlayerIds.every(id => next.has(id));
      if (allSelected) {
        teamPlayerIds.forEach(id => next.delete(id));
      } else {
        teamPlayerIds.forEach(id => next.add(id));
      }
      return next;
    });
  }

  function selectAllPlatformUsers() {
    const allUids = eligiblePlatformUsers.map(u => u.uid);
    setSelectedUserIds(prev => {
      const allSelected = allUids.every(uid => prev.has(uid));
      if (allSelected) return new Set();
      return new Set(allUids);
    });
  }

  function switchChannel(ch: Channel) {
    setChannel(ch);
    setSendState('idle');
    setSendResult(null);
    setSubject('');
    setSelectedIds(new Set());
    setSelectedUserIds(new Set());
  }

  const selectedPlayers: Player[] = players.filter(p => selectedIds.has(p.id));
  const selectedPlatformUsers: UserProfile[] = platformUsers.filter(u => selectedUserIds.has(u.uid));

  const phones = [
    ...new Set(
      selectedPlayers.flatMap(p =>
        [p.parentContact?.parentPhone, p.parentContact2?.parentPhone].filter(Boolean) as string[]
      )
    ),
  ];

  const playerEmailAddresses = [
    ...new Set(
      selectedPlayers.flatMap(p =>
        [p.email, p.parentContact?.parentEmail, p.parentContact2?.parentEmail].filter(Boolean) as string[]
      )
    ),
  ];

  const userEmailAddresses = selectedPlatformUsers.map(u => u.email).filter(Boolean) as string[];
  const emailAddresses = [...new Set([...playerEmailAddresses, ...userEmailAddresses])];
  const totalSelectedCount = selectedPlayers.length + selectedPlatformUsers.length;

  const canSend = channel === 'sms'
    ? phones.length > 0 && message.trim().length > 0
    : emailAddresses.length > 0 && subject.trim().length > 0 && message.trim().length > 0;

  async function handleSendEmail() {
    if (!canSend || sendState === 'sending') return;
    setSendState('sending');
    setSendResult(null);
    try {
      const selectedTeamIds = [...new Set(selectedPlayers.map(p => p.teamId).filter(Boolean))];
      const result = await sendEmailFn({ to: emailAddresses, subject: subject.trim(), message: message.trim(), teamIds: selectedTeamIds });
      setSendResult(result.data);
      setSendState(result.data.failed === 0 ? 'success' : 'error');
      if (result.data.failed === 0) {
        setMessage('');
        setSubject('');
        setSelectedIds(new Set());
        setSelectedUserIds(new Set());
      }
    } catch (e: unknown) {
      setSendResult({ sent: 0, failed: emailAddresses.length, errors: [(e as Error).message] });
      setSendState('error');
    }
  }

  async function handleSendSms() {
    if (!canSend || sendState === 'sending') return;
    setSendState('sending');
    setSendResult(null);
    try {
      const result = await sendSms({ to: phones, message: message.trim() });
      setSendResult(result.data);
      setSendState(result.data.failed === 0 ? 'success' : 'error');
      if (result.data.failed === 0) {
        setMessage('');
        setSelectedIds(new Set());
        setSelectedUserIds(new Set());
      }
    } catch (e: unknown) {
      setSendResult({ sent: 0, failed: phones.length, errors: [(e as Error).message] });
      setSendState('error');
    }
  }

  const allPlatformUsersSelected = eligiblePlatformUsers.length > 0 && eligiblePlatformUsers.every(u => selectedUserIds.has(u.uid));

  return (
    <div className="p-4 sm:p-6">
      {FEATURE_SMS && (
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          <button
            onClick={() => switchChannel('sms')}
            className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${channel === 'sms' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}
          >
            <MessageSquare size={14} /> SMS
          </button>
          <button
            onClick={() => switchChannel('email')}
            className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${channel === 'email' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}
          >
            <Mail size={14} /> Email
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Users size={16} className="text-blue-500" /> Recipients
          </h2>

          {eligiblePlayers.length === 0 && (!isAdmin || eligiblePlatformUsers.length === 0) ? (
            <Card className="p-4 sm:p-6 text-center">
              <AlertCircle size={28} className="text-gray-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-600">No contacts yet</p>
              <p className="text-xs text-gray-400 mt-1">
                {channel === 'sms'
                  ? 'Add parent phone numbers to players in their roster to enable SMS.'
                  : 'Add player or parent email addresses to enable email messaging.'}
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {teams.map(team => {
                const teamPlayers = eligiblePlayers.filter(p => p.teamId === team.id);
                if (teamPlayers.length === 0) return null;
                const allSelected = teamPlayers.every(p => selectedIds.has(p.id));
                return (
                  <Card key={team.id} className="overflow-hidden">
                    <div
                      className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 cursor-pointer hover:bg-gray-50"
                      onClick={() => selectTeam(team.id)}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: team.color }} />
                        <span className="text-sm font-semibold text-gray-800">{team.name}</span>
                        <span className="text-xs text-gray-400">({teamPlayers.length})</span>
                      </div>
                      <span className="text-xs text-blue-500">{allSelected ? 'Deselect all' : 'Select all'}</span>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {teamPlayers.map(player => (
                        <label key={player.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(player.id)}
                            onChange={() => togglePlayer(player.id)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-900">{player.firstName} {player.lastName}</p>
                            {channel === 'sms' ? (
                              <p className="text-xs text-gray-500 flex items-center gap-1">
                                <Phone size={10} />
                                {[player.parentContact?.parentPhone, player.parentContact2?.parentPhone].filter(Boolean).join(' · ')}
                              </p>
                            ) : (
                              <p className="text-xs text-gray-500 flex items-center gap-1 truncate">
                                <Mail size={10} />
                                {[player.email, player.parentContact?.parentEmail, player.parentContact2?.parentEmail].filter(Boolean).join(', ')}
                              </p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </Card>
                );
              })}

              {isAdmin && channel === 'email' && eligiblePlatformUsers.length > 0 && (
                <Card className="overflow-hidden">
                  <div
                    className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 cursor-pointer hover:bg-gray-50"
                    onClick={selectAllPlatformUsers}
                  >
                    <div className="flex items-center gap-2">
                      <Shield size={13} className="text-purple-500" />
                      <span className="text-sm font-semibold text-gray-800">Platform Users</span>
                      <span className="text-xs text-gray-400">({eligiblePlatformUsers.length})</span>
                    </div>
                    <span className="text-xs text-blue-500">{allPlatformUsersSelected ? 'Deselect all' : 'Select all'}</span>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {eligiblePlatformUsers.map(user => (
                      <label key={user.uid} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={selectedUserIds.has(user.uid)}
                          onChange={() => toggleUser(user.uid)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-gray-900">{user.displayName}</p>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${roleColors[user.role] ?? 'text-gray-600 bg-gray-100'}`}>
                              {user.role.replace('_', ' ')}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 flex items-center gap-1 truncate">
                            <Mail size={10} /> {user.email}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>

        <div>
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            {channel === 'sms'
              ? <><MessageSquare size={16} className="text-green-500" /> Message</>
              : <><Mail size={16} className="text-blue-500" /> Message</>}
          </h2>
          <Card className="p-4 space-y-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">
                {totalSelectedCount === 0
                  ? 'No recipients selected'
                  : channel === 'sms'
                    ? `${phones.length} recipient${phones.length !== 1 ? 's' : ''} selected`
                    : `${emailAddresses.length} email address${emailAddresses.length !== 1 ? 'es' : ''} (${totalSelectedCount} recipient${totalSelectedCount !== 1 ? 's' : ''})`}
              </p>
              {totalSelectedCount > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {selectedPlayers.map(p => (
                    <span key={p.id} className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                      {p.parentContact?.parentName || `${p.firstName} ${p.lastName}`}
                    </span>
                  ))}
                  {selectedPlatformUsers.map(u => (
                    <span key={u.uid} className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded-full">
                      {u.displayName}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {channel === 'email' && (
              <Input
                label="Subject"
                type="text"
                placeholder="e.g. Practice cancelled Saturday"
                value={subject}
                onChange={e => { setSubject(e.target.value); if (sendState !== 'idle') setSendState('idle'); }}
              />
            )}
            <div>
              <Textarea
                label="Message"
                rows={6}
                placeholder="Type your message here..."
                value={message}
                className="resize-none"
                onChange={e => { setMessage(e.target.value); if (sendState !== 'idle') setSendState('idle'); }}
              />
              {channel === 'sms' && (
                <p className="text-xs text-gray-400 mt-1 text-right">{message.length}/160 chars</p>
              )}
            </div>

            {sendResult && (
              <div className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${sendState === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {sendState === 'success'
                  ? <CheckCircle size={16} className="mt-0.5 shrink-0" />
                  : <XCircle size={16} className="mt-0.5 shrink-0" />}
                <div>
                  <p className="font-medium">
                    {sendState === 'success'
                      ? `Sent to ${sendResult.sent} recipient${sendResult.sent !== 1 ? 's' : ''}`
                      : `${sendResult.sent} sent, ${sendResult.failed} failed`}
                  </p>
                  {sendResult.errors.length > 0 && (
                    <ul className="mt-1 text-xs space-y-0.5">
                      {sendResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {channel === 'sms' ? (
                <Button
                  className="w-full"
                  disabled={!canSend || sendState === 'sending'}
                  onClick={handleSendSms}
                >
                  <MessageSquare size={15} />
                  {sendState === 'sending' ? 'Sending…' : `Send SMS${phones.length > 0 ? ` to ${phones.length}` : ''}`}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  disabled={!canSend || sendState === 'sending'}
                  onClick={handleSendEmail}
                >
                  <Mail size={15} />
                  {sendState === 'sending' ? 'Sending…' : canSend ? `Send Email to ${emailAddresses.length} recipient${emailAddresses.length !== 1 ? 's' : ''}` : 'Select recipients to send'}
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function MessagingPage() {
  const user = useAuthStore(s => s.user);
  const profile = useAuthStore(s => s.profile);
  const allTeams = useTeamStore(s => s.teams);

  const uid = user?.uid ?? '';
  const displayName = profile?.displayName || profile?.email || '';
  const isCoachOrAdmin = profile?.role === 'admin' || profile?.role === 'coach' || profile?.role === 'league_manager';

  // Active team for group chat — use primary membership's teamId
  const activeMembership = profile ? getActiveMembership(profile) : null;
  const activeTeamId =
    activeMembership?.teamId ??
    profile?.teamId ??
    allTeams[0]?.id ??
    null;

  const [tab, setTab] = useState<MainTab>('chat');

  // Default non-coaches/admins away from broadcast tab
  useEffect(() => {
    if (!isCoachOrAdmin && tab === 'broadcast') {
      setTab('chat');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCoachOrAdmin]);

  const tabs: { id: MainTab; label: string; icon: React.ReactNode }[] = [
    { id: 'chat', label: 'Team Chat', icon: <Users size={14} /> },
    { id: 'dms', label: 'Direct Messages', icon: <MessageCircle size={14} /> },
    ...(isCoachOrAdmin
      ? [{ id: 'broadcast' as MainTab, label: 'Broadcast', icon: <Mail size={14} /> }]
      : []),
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex gap-0 border-b border-gray-200 bg-white px-2 sm:px-4 flex-shrink-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-3 text-sm font-medium transition-colors flex items-center gap-1.5 border-b-2 ${
              tab === t.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'chat' && (
          activeTeamId
            ? <TeamChatPanel teamId={activeTeamId} />
            : (
              <div className="flex items-center justify-center h-full text-sm text-gray-400">
                No team found. Join a team to access team chat.
              </div>
            )
        )}
        {tab === 'dms' && uid && (
          <DmPanel myUid={uid} myName={displayName} />
        )}
        {tab === 'broadcast' && isCoachOrAdmin && (
          <BroadcastPanel />
        )}
      </div>
    </div>
  );
}
