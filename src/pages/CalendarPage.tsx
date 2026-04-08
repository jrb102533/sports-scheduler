import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, CalendarDays, X, Copy, Check } from 'lucide-react';
import { CalendarGrid, formatMonthYear, dateToISO } from '@/components/calendar/CalendarGrid';
import { EventForm } from '@/components/events/EventForm';
import { EventDetailPanel } from '@/components/events/EventDetailPanel';
import { Button } from '@/components/ui/Button';
import { useEventStore } from '@/store/useEventStore';
import { useTeamStore } from '@/store/useTeamStore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import type { ScheduledEvent } from '@/types';

export function CalendarPage() {
  const events = useEventStore(s => s.events);
  const teams = useTeamStore(s => s.teams);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [formOpen, setFormOpen] = useState(false);
  const [formDate, setFormDate] = useState<string | undefined>();
  const [selectedEvent, setSelectedEvent] = useState<ScheduledEvent | null>(null);

  // Calendar sync state
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  function handleDayClick(date: Date) {
    setFormDate(dateToISO(date));
    setFormOpen(true);
  }

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
    } catch (err: any) {
      setFeedError(err?.message ?? 'Failed to load feed URL.');
    } finally {
      setLoadingFeed(false);
    }
  }

  function webcalUrl(url: string) {
    return url.replace(/^https?:\/\//, 'webcal://');
  }

  async function handleCopy() {
    if (!feedUrl) return;
    await navigator.clipboard.writeText(webcalUrl(feedUrl));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={prevMonth}><ChevronLeft size={16} /></Button>
          <h2 className="text-lg font-semibold text-gray-900 w-44 text-center">{formatMonthYear(new Date(year, month))}</h2>
          <Button variant="secondary" size="sm" onClick={nextMonth}><ChevronRight size={16} /></Button>
          <Button variant="ghost" size="sm" onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}>Today</Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleOpenSync}>
            <CalendarDays size={16} /> Subscribe
          </Button>
          <Button onClick={() => { setFormDate(undefined); setFormOpen(true); }}>
            <Plus size={16} /> Add Event
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <CalendarGrid
          year={year}
          month={month}
          events={events}
          teams={teams}
          onDayClick={handleDayClick}
          onEventClick={setSelectedEvent}
        />
      </div>

      <EventForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        initial={formDate ? { date: formDate } : undefined}
      />
      <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />

      {/* Calendar Sync Modal */}
      {syncModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <CalendarDays size={18} className="text-blue-600" />
                Subscribe to Calendar
              </h3>
              <button
                onClick={() => setSyncModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-sm text-gray-500">
              Your personal feed stays in sync as events are added or changed in First Whistle.
            </p>

            {loadingFeed && (
              <p className="text-sm text-gray-400 py-2">Loading your feed URL…</p>
            )}

            {feedError && (
              <p className="text-sm text-red-500">{feedError}</p>
            )}

            {feedUrl && (
              <>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 truncate text-gray-700 select-all">
                    {webcalUrl(feedUrl)}
                  </code>
                  <button
                    onClick={handleCopy}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>

                <a
                  href={webcalUrl(feedUrl)}
                  className="block w-full text-center px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Open in Apple Calendar
                </a>

                <div className="text-sm text-gray-500 space-y-1.5 bg-gray-50 rounded-lg p-3">
                  <p className="font-medium text-gray-700">Google Calendar</p>
                  <p>Settings → Other calendars → <strong>From URL</strong> → paste the link above.</p>
                </div>

                <div className="text-sm text-gray-500 space-y-1.5 bg-gray-50 rounded-lg p-3">
                  <p className="font-medium text-gray-700">Outlook</p>
                  <p>Add calendar → Subscribe from web → paste the link above.</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
