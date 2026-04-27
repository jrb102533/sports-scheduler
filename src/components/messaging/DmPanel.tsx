import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronLeft } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ThreadView } from '@/components/messaging/ThreadView';
import { DmList } from '@/components/messaging/DmList';
import { useTeamStore } from '@/store/useTeamStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useDmStore, dmThreadId } from '@/store/useDmStore';
import {
  filterCoachLedThreads,
  filterCoachLedContacts,
  findCoachLedTeamId,
} from '@/lib/dmCoachLed';
import { markThreadRead } from '@/lib/messagingUnread';
import type { DmThread, UserProfile } from '@/types';

interface DmContact {
  uid: string;
  name: string;
}

interface DmPanelProps {
  myUid: string;
  myName: string;
}

export function DmPanel({ myUid, myName }: DmPanelProps) {
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
  const [contacts, setContacts] = useState<DmContact[]>([]);
  const [showNewDm, setShowNewDm] = useState(false);

  useEffect(() => {
    return useDmStore.getState().subscribeThreads(myUid);
  }, [myUid]);

  // Stable signature of relevant teams. We re-resolve contacts only when the
  // set of teams the user is affiliated with changes — not on every render.
  const myTeamsKey = useMemo(() => {
    if (!profile) return '';
    return allTeams
      .filter(t => {
        if (profile.role === 'admin') return true;
        if (t.coachId === myUid) return true;
        if (t.coachIds?.includes(myUid)) return true;
        return players.some(p =>
          p.teamId === t.id && (p.parentUid === myUid || p.linkedUid === myUid),
        );
      })
      .map(t => t.id)
      .sort()
      .join(',');
  }, [allTeams, players, profile, myUid]);

  // Build the candidate UID list from team.coaches denorm + roster, then
  // filter through coach-led rules. Falls back to per-uid getDoc only when
  // the denorm map is missing a name (graceful degradation per ADR-014).
  useEffect(() => {
    if (!myTeamsKey) return;
    const teamIds = new Set(myTeamsKey.split(',').filter(Boolean));
    const myTeams = allTeams.filter(t => teamIds.has(t.id));

    const candidateUids = new Set<string>();
    const nameMap = new Map<string, string>();

    for (const t of myTeams) {
      if (t.coachId) candidateUids.add(t.coachId);
      t.coachIds?.forEach(id => candidateUids.add(id));
      if (t.coaches) {
        for (const [uid, info] of Object.entries(t.coaches)) {
          candidateUids.add(uid);
          if (info?.name) nameMap.set(uid, info.name);
        }
      }
    }
    for (const p of players) {
      if (!teamIds.has(p.teamId)) continue;
      if (p.parentUid) {
        candidateUids.add(p.parentUid);
        const parentName = p.parentContact?.parentName;
        if (parentName) nameMap.set(p.parentUid, parentName);
      }
      if (p.linkedUid) {
        candidateUids.add(p.linkedUid);
        const fullName = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim();
        if (fullName) nameMap.set(p.linkedUid, fullName);
      }
    }

    const allowed = filterCoachLedContacts(
      [...candidateUids],
      myUid,
      myTeams,
      players,
    );
    if (allowed.length === 0) {
      setContacts([]);
      return;
    }

    const missing = allowed.filter(uid => !nameMap.has(uid));
    if (missing.length === 0) {
      setContacts(allowed.map(uid => ({ uid, name: nameMap.get(uid)! })));
      return;
    }

    Promise.all(missing.map(uid => getDoc(doc(db, 'users', uid))))
      .then(snaps => {
        snaps.forEach(d => {
          if (d.exists()) {
            const u = d.data() as UserProfile;
            if (u.uid && u.displayName) nameMap.set(u.uid, u.displayName);
          }
        });
        setContacts(
          allowed
            .filter(uid => nameMap.has(uid))
            .map(uid => ({ uid, name: nameMap.get(uid)! })),
        );
      })
      .catch(err => console.error('[DmPanel] resolve names:', err));
  }, [myTeamsKey, allTeams, players, myUid]);

  const visibleThreads = useMemo(
    () => filterCoachLedThreads(threads, myUid, allTeams, players),
    [threads, myUid, allTeams, players],
  );

  function openThread(thread: DmThread) {
    markThreadRead(thread.id, thread.lastMessageAt);
    setActiveThread(thread);
    setShowNewDm(false);
    useDmStore.getState().subscribeMessages(thread.id);
  }

  function openNewDmWith(contact: DmContact) {
    const threadId = dmThreadId(myUid, contact.uid);
    const existing = threads.find(t => t.id === threadId);
    if (existing) {
      openThread(existing);
      return;
    }
    const synthetic: DmThread = {
      id: threadId,
      participants: [myUid, contact.uid].sort() as [string, string],
      participantNames: { [myUid]: myName, [contact.uid]: contact.name },
      lastMessage: '',
      lastMessageAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    markThreadRead(threadId, synthetic.lastMessageAt);
    setActiveThread(synthetic);
    setShowNewDm(false);
    useDmStore.getState().subscribeMessages(threadId);
  }

  const otherUid = activeThread
    ? activeThread.participants.find(uid => uid !== myUid) ?? ''
    : '';
  const otherName = activeThread
    ? activeThread.participantNames[otherUid] ?? 'Unknown'
    : '';

  // Lock teamId at thread-open time. Used for SEC-71 rule on every send.
  const activeTeamId = useMemo(() => {
    if (!activeThread) return null;
    return findCoachLedTeamId(myUid, otherUid, allTeams, players);
  }, [activeThread, myUid, otherUid, allTeams, players]);

  const lastSeenStampRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeThread) return;
    if (messages.length === 0) return;
    const last = messages[messages.length - 1].createdAt;
    if (last !== lastSeenStampRef.current) {
      lastSeenStampRef.current = last;
      markThreadRead(activeThread.id, last);
    }
  }, [activeThread, messages]);

  return (
    <div className="flex flex-col h-full">
      {activeThread ? (
        <>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-white">
            <button
              onClick={() => setActiveThread(null)}
              className="text-gray-500 hover:text-gray-800"
              aria-label="Back to thread list"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700">
              {otherName.charAt(0).toUpperCase()}
            </div>
            <span className="font-medium text-gray-900">{otherName}</span>
          </div>
          <div className="flex-1 overflow-hidden">
            {activeTeamId ? (
              <ThreadView
                messages={messages}
                loading={loadingMessages}
                currentUid={myUid}
                placeholder={`Message ${otherName}…`}
                onSend={text => sendDm(myUid, myName, otherUid, otherName, text, activeTeamId)}
              />
            ) : (
              <div className="p-6 text-center text-sm text-gray-500">
                This conversation is no longer available.
              </div>
            )}
          </div>
        </>
      ) : showNewDm ? (
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-white">
            <button
              onClick={() => setShowNewDm(false)}
              className="text-gray-500 hover:text-gray-800"
              aria-label="Back to thread list"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="font-medium text-gray-900">New Message</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {contacts.length === 0 ? (
              <p className="text-sm text-gray-400 p-6 text-center">
                No coaches available to message.
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {contacts.map(c => (
                  <button
                    key={c.uid}
                    onClick={() => openNewDmWith(c)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm font-medium text-gray-900">{c.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
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
              threads={visibleThreads}
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
