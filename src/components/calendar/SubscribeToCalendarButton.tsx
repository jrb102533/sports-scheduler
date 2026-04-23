import { useState } from 'react';
import { CalendarDays, Copy, Check } from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

interface Props {
  teamId?: string;
}

export function SubscribeToCalendarButton({ teamId }: Props) {
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [copiedTeam, setCopiedTeam] = useState(false);
  const [copiedPersonal, setCopiedPersonal] = useState(false);

  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string;
  const teamFeedUrl = teamId
    ? `https://us-central1-${projectId}.cloudfunctions.net/exportTeamSchedule?teamId=${teamId}`
    : null;

  async function handleOpenSync() {
    setSyncModalOpen(true);
    if (feedUrl) return; // already loaded
    setLoadingFeed(true);
    setFeedError(null);
    try {
      const functions = getFunctions();
      const getUrl = httpsCallable<unknown, { url: string }>(functions, 'getCalendarFeedUrl');
      const result = await getUrl({});
      setFeedUrl(result.data.url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load feed URL.';
      setFeedError(message);
    } finally {
      setLoadingFeed(false);
    }
  }

  function webcalUrl(url: string) {
    return url.replace(/^https?:\/\//, 'webcal://');
  }

  async function handleCopyTeam() {
    if (!teamFeedUrl) return;
    await navigator.clipboard.writeText(webcalUrl(teamFeedUrl));
    setCopiedTeam(true);
    setTimeout(() => setCopiedTeam(false), 2000);
  }

  async function handleCopyPersonal() {
    if (!feedUrl) return;
    await navigator.clipboard.writeText(webcalUrl(feedUrl));
    setCopiedPersonal(true);
    setTimeout(() => setCopiedPersonal(false), 2000);
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={handleOpenSync}
        aria-label="Subscribe to calendar"
      >
        <CalendarDays size={16} />
        Sync Calendar
      </Button>

      <Modal
        open={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        title="Subscribe to Calendar"
        size="sm"
      >
        <div className="space-y-4">
          {/* Team Schedule section — only shown when teamId is provided */}
          {teamFeedUrl && (
            <>
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800">Team Schedule</p>
                  <p className="text-xs text-gray-500 mt-0.5">Share this link with anyone on the team.</p>
                </div>

                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1.5">Team calendar feed:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 truncate text-gray-700 select-all">
                      {webcalUrl(teamFeedUrl)}
                    </code>
                    <button
                      onClick={() => void handleCopyTeam()}
                      aria-label={copiedTeam ? 'Copied' : 'Copy team feed URL'}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      {copiedTeam ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                      {copiedTeam ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                <a
                  href={webcalUrl(teamFeedUrl)}
                  className="block w-full text-center px-4 py-2.5 rounded-lg bg-[#1B3A6B] text-white text-sm font-medium hover:bg-[#f97316] transition-colors"
                >
                  Open in Apple Calendar
                </a>
              </div>

              <hr className="border-gray-200" />
            </>
          )}

          {/* Personal Schedule section */}
          <div className="space-y-3">
            {teamFeedUrl && (
              <div>
                <p className="text-sm font-semibold text-gray-800">My Personal Schedule</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Your personal feed stays in sync as events are added or changed in First Whistle.
                </p>
              </div>
            )}

            {!teamFeedUrl && (
              <p className="text-sm text-gray-500">
                Your personal feed stays in sync as events are added or changed in First Whistle.
              </p>
            )}

            {loadingFeed && (
              <p className="text-sm text-gray-400 py-2">Loading your feed URL…</p>
            )}

            {feedError && (
              <p className="text-sm text-red-500">{feedError}</p>
            )}

            {feedUrl && (
              <>
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1.5">Your personal calendar feed:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 truncate text-gray-700 select-all">
                      {webcalUrl(feedUrl)}
                    </code>
                    <button
                      onClick={() => void handleCopyPersonal()}
                      aria-label={copiedPersonal ? 'Copied' : 'Copy feed URL'}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      {copiedPersonal ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                      {copiedPersonal ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                <a
                  href={webcalUrl(feedUrl)}
                  className="block w-full text-center px-4 py-2.5 rounded-lg bg-[#1B3A6B] text-white text-sm font-medium hover:bg-[#f97316] transition-colors"
                >
                  Open in Apple Calendar
                </a>

                <div className="text-sm text-gray-500 space-y-1.5 bg-gray-50 rounded-lg p-3">
                  <p className="font-medium text-gray-700">Google Calendar</p>
                  <p>Settings → Add calendar → <strong>From URL</strong> → paste the link above.</p>
                </div>

                <p className="text-xs text-gray-400">
                  Events sync automatically as changes are made in First Whistle.
                </p>
              </>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
