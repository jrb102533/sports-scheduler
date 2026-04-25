import { useEffect } from 'react';
import { ChevronUp } from 'lucide-react';
import { ThreadView } from '@/components/messaging/ThreadView';
import { useTeamChatStore } from '@/store/useTeamChatStore';
import { useAuthStore } from '@/store/useAuthStore';

interface TeamChatPanelProps {
  teamId: string;
}

export function TeamChatPanel({ teamId }: TeamChatPanelProps) {
  const uid = useAuthStore(s => s.user?.uid ?? '');
  const profile = useAuthStore(s => s.profile);
  const senderName = profile?.displayName || profile?.email || 'You';
  const messages = useTeamChatStore(s => s.messages);
  const loading = useTeamChatStore(s => s.loading);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useTeamChatStore.getState().subscribe(teamId);
  }, [teamId]);

  function handleLoadOlder() {
    void useTeamChatStore.getState().loadOlder(teamId);
  }

  function handleSend(text: string) {
    return useTeamChatStore.getState().sendMessage(teamId, uid, senderName, text);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Load older button — only shown when there are messages to potentially load */}
      {messages.length > 0 && (
        <div className="flex justify-center py-2 border-b border-gray-100 flex-shrink-0">
          <button
            onClick={handleLoadOlder}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 transition-colors disabled:opacity-40"
          >
            <ChevronUp size={13} />
            Load older messages
          </button>
        </div>
      )}
      <ThreadView
        messages={messages}
        loading={loading}
        currentUid={uid}
        placeholder="Message the team…"
        onSend={handleSend}
      />
    </div>
  );
}
