import { useEffect, useState } from 'react';
import { useRsvpStore } from '@/store/useRsvpStore';

interface RsvpButtonProps {
  eventId: string;
  currentUserUid: string;
  currentUserName: string;
}

export function RsvpButton({ eventId, currentUserUid, currentUserName }: RsvpButtonProps) {
  const entries = useRsvpStore(s => s.rsvps[eventId] ?? []);
  const submitRsvp = useRsvpStore(s => s.submitRsvp);
  const [submitting, setSubmitting] = useState(false);
  const [showNames, setShowNames] = useState(false);

  useEffect(() => {
    const unsub = useRsvpStore.getState().subscribeRsvps(eventId);
    return unsub;
  }, [eventId]);

  const myEntry = entries.find(r => r.uid === currentUserUid);
  const goingList = entries.filter(r => r.response === 'yes');
  const notGoingList = entries.filter(r => r.response === 'no');

  async function handleResponse(response: 'yes' | 'no') {
    if (submitting) return;
    // Optimistic update
    useRsvpStore.setState(state => {
      const existing = state.rsvps[eventId] ?? [];
      const filtered = existing.filter(r => r.uid !== currentUserUid);
      return {
        rsvps: {
          ...state.rsvps,
          [eventId]: [
            ...filtered,
            { uid: currentUserUid, name: currentUserName, response, updatedAt: new Date().toISOString() },
          ],
        },
      };
    });
    setSubmitting(true);
    try {
      await submitRsvp(eventId, currentUserUid, currentUserName, response);
    } catch {
      // On failure, the next snapshot listener reconcile will restore server state
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2">
      {/* Toggle buttons */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500">RSVP:</span>
        <button
          onClick={() => void handleResponse('yes')}
          disabled={submitting}
          aria-pressed={myEntry?.response === 'yes'}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-50 ${
            myEntry?.response === 'yes'
              ? 'bg-green-600 text-white'
              : 'bg-green-100 text-green-700 hover:bg-green-200'
          }`}
        >
          Going
        </button>
        <button
          onClick={() => void handleResponse('no')}
          disabled={submitting}
          aria-pressed={myEntry?.response === 'no'}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-50 ${
            myEntry?.response === 'no'
              ? 'bg-red-600 text-white'
              : 'bg-red-100 text-red-600 hover:bg-red-200'
          }`}
        >
          Not Going
        </button>
      </div>

      {/* Summary row — clickable to expand names */}
      {entries.length > 0 && (
        <button
          onClick={() => setShowNames(v => !v)}
          className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
          aria-expanded={showNames}
        >
          {goingList.length} going &middot; {notGoingList.length} not going
          <span className="ml-1 text-gray-400">{showNames ? '▲' : '▼'}</span>
        </button>
      )}

      {/* Expanded name list */}
      {showNames && (
        <div className="bg-gray-50 rounded-lg px-3 py-2 space-y-1">
          {goingList.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-green-700 mb-0.5">Going</p>
              <ul className="space-y-0.5">
                {goingList.map(r => (
                  <li key={r.uid} className="text-xs text-gray-700">{r.name}</li>
                ))}
              </ul>
            </div>
          )}
          {notGoingList.length > 0 && (
            <div className={goingList.length > 0 ? 'mt-2' : ''}>
              <p className="text-xs font-semibold text-red-600 mb-0.5">Not Going</p>
              <ul className="space-y-0.5">
                {notGoingList.map(r => (
                  <li key={r.uid} className="text-xs text-gray-700">{r.name}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
