import { MessageCircle } from 'lucide-react';
import type { DmThread } from '@/types';

interface DmListProps {
  threads: DmThread[];
  loading: boolean;
  currentUid: string;
  activeThreadId: string | null;
  onSelectThread: (thread: DmThread) => void;
}

export function DmList({ threads, loading, currentUid, activeThreadId, onSelectThread }: DmListProps) {
  if (loading) {
    return <p className="text-sm text-gray-400 p-4 text-center">Loading conversations…</p>;
  }

  if (threads.length === 0) {
    return (
      <div className="p-6 text-center">
        <MessageCircle size={28} className="text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No conversations yet</p>
        <p className="text-xs text-gray-400 mt-1">Select a team member below to start a DM</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {threads.map(thread => {
        const otherUid = thread.participants.find(uid => uid !== currentUid) ?? '';
        const otherName = thread.participantNames[otherUid] ?? 'Unknown';
        const isActive = thread.id === activeThreadId;

        return (
          <button
            key={thread.id}
            onClick={() => onSelectThread(thread)}
            className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors ${isActive ? 'bg-blue-50' : ''}`}
          >
            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 text-sm font-bold text-blue-700">
              {otherName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{otherName}</p>
              {thread.lastMessage && (
                <p className="text-xs text-gray-500 truncate">{thread.lastMessage}</p>
              )}
            </div>
            {thread.lastMessageAt && (
              <span className="text-[10px] text-gray-400 flex-shrink-0">
                {new Date(thread.lastMessageAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
