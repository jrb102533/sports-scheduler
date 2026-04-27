import { useAuthStore } from '@/store/useAuthStore';
import { DmPanel } from '@/components/messaging/DmPanel';

/**
 * Direct-Messages-only surface. Team chat now lives on TeamDetailPage's
 * Chat tab; announcements are launched from the team header. This route
 * (`/messaging`) is reserved for 1:1 coach-led DMs.
 */
export function MessagingPage() {
  const profile = useAuthStore(s => s.profile);
  const user = useAuthStore(s => s.user);

  if (!user || !profile) {
    return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  }

  const myName = profile.displayName || profile.email || 'You';

  return (
    <div className="flex flex-col h-[calc(100vh-160px)] min-h-[400px] bg-gray-50">
      <h1 className="text-lg font-semibold text-gray-900 px-4 py-3 border-b border-gray-100 bg-white">
        Direct Messages
      </h1>
      <div className="flex-1 overflow-hidden">
        <DmPanel myUid={user.uid} myName={myName} />
      </div>
    </div>
  );
}
