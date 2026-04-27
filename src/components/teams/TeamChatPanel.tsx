import { useEffect } from 'react';
import { ThreadView } from '@/components/messaging/ThreadView';
import { useTeamChatStore } from '@/store/useTeamChatStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useTeamStore } from '@/store/useTeamStore';
import { markTeamRead } from '@/lib/messagingUnread';

interface TeamChatPanelProps {
  /** The team whose chat to render. Subscription is set up on mount. */
  teamId: string;
}

/**
 * Standalone chat panel for a single team.
 *
 * Designed to be lazy-mounted from `TeamDetailPage`'s Chat tab — the
 * onSnapshot subscription is created on mount and torn down on unmount, so
 * users who never open the Chat tab pay zero Firestore reads for chat.
 *
 * Marks the team as read whenever a fresh snapshot arrives, using the team's
 * denormalized `lastMessageAt` so the read pointer matches the most recent
 * known server message. This clears the unread dot on TeamsPage / Chat tab
 * label without any extra round-trip.
 */
export function TeamChatPanel({ teamId }: TeamChatPanelProps) {
  const uid = useAuthStore(s => s.user?.uid ?? '');
  const profile = useAuthStore(s => s.profile);
  const senderName = profile?.displayName || profile?.email || 'You';

  const messages = useTeamChatStore(s => s.messages);
  const loading = useTeamChatStore(s => s.loading);
  const loadingOlder = useTeamChatStore(s => s.loadingOlder);
  const reachedStart = useTeamChatStore(s => s.reachedStart);
  const sendMessage = useTeamChatStore(s => s.sendMessage);

  // Read the denormalized lastMessageAt so we can update the local read
  // pointer to it (rather than `now`) when the user views the chat. Falls
  // back to undefined cleanly when the team doc lacks the denorm — in that
  // case `markTeamRead` records the current time as a safe default.
  const teamLastMessageAt = useTeamStore(s => s.teams.find(t => t.id === teamId)?.lastMessageAt);

  // Subscribe to chat on mount, unsubscribe on unmount or teamId change.
  // The store's subscribe() handles state reset internally.
  useEffect(() => {
    return useTeamChatStore.getState().subscribe(teamId);
  }, [teamId]);

  // Mark the team as read whenever the user is looking at it AND we know the
  // current lastMessageAt. Re-fires whenever lastMessageAt changes (i.e., a
  // new message arrives while the panel is open) so the user remains "caught
  // up" without a manual click.
  useEffect(() => {
    markTeamRead(teamId, teamLastMessageAt);
  }, [teamId, teamLastMessageAt]);

  const showLoadOlder = !loading && !reachedStart && messages.length > 0;

  return (
    <div className="flex flex-col h-full">
      {showLoadOlder && (
        <div className="flex justify-center py-2 border-b border-gray-100 bg-white flex-shrink-0">
          <button
            type="button"
            onClick={() => useTeamChatStore.getState().loadOlder()}
            disabled={loadingOlder}
            className="text-xs text-blue-600 font-medium hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingOlder ? 'Loading…' : 'Load older messages'}
          </button>
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        <ThreadView
          messages={messages}
          loading={loading}
          currentUid={uid}
          placeholder="Message the team…"
          onSend={text => sendMessage(teamId, uid, senderName, text)}
        />
      </div>
    </div>
  );
}
