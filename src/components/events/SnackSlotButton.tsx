import { useEffect, useState } from 'react';
import { useSnackStore } from '@/store/useSnackStore';
import type { SnackSlot } from '@/store/useSnackStore';

const EMPTY_SLOT: SnackSlot = { claimedBy: null, claimedByName: null, claimedAt: null };

interface SnackSlotButtonProps {
  eventId: string;
  currentUserUid: string;
  currentUserName: string;
}

export function SnackSlotButton({ eventId, currentUserUid, currentUserName }: SnackSlotButtonProps) {
  const slot = useSnackStore(s => s.slots[eventId] ?? EMPTY_SLOT);
  const claimSlot = useSnackStore(s => s.claimSlot);
  const releaseSlot = useSnackStore(s => s.releaseSlot);
  const subscribeSlot = useSnackStore(s => s.subscribeSlot);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const unsub = subscribeSlot(eventId);
    return unsub;
  }, [eventId, subscribeSlot]);

  const isClaimedByMe = slot.claimedBy === currentUserUid;
  const isClaimedByOther = slot.claimedBy !== null && !isClaimedByMe;

  async function handleClaim() {
    if (submitting) return;
    // Optimistic update
    useSnackStore.setState(state => ({
      slots: {
        ...state.slots,
        [eventId]: { claimedBy: currentUserUid, claimedByName: currentUserName, claimedAt: new Date().toISOString() },
      },
    }));
    setSubmitting(true);
    try {
      await claimSlot(eventId, currentUserUid, currentUserName);
    } catch {
      // On failure, the next snapshot listener reconcile will restore server state
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRelease() {
    if (submitting) return;
    // Optimistic update
    useSnackStore.setState(state => ({
      slots: {
        ...state.slots,
        [eventId]: { claimedBy: null, claimedByName: null, claimedAt: null },
      },
    }));
    setSubmitting(true);
    try {
      await releaseSlot(eventId);
    } catch {
      // On failure, the next snapshot listener reconcile will restore server state
    } finally {
      setSubmitting(false);
    }
  }

  if (isClaimedByOther) {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-full px-3 py-1">
        <span aria-hidden="true">🍎</span>
        <span>{slot.claimedByName} bringing snacks</span>
      </div>
    );
  }

  if (isClaimedByMe) {
    return (
      <div className="inline-flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 bg-orange-100 text-orange-800 border border-orange-300 rounded-full px-3 py-1 font-medium">
          <span aria-hidden="true">🍎</span>
          <span>You&apos;re bringing snacks</span>
        </span>
        <button
          onClick={() => void handleRelease()}
          disabled={submitting}
          className="text-gray-400 hover:text-red-500 underline transition-colors disabled:opacity-50"
          aria-label="Release snack slot"
        >
          Release
        </button>
      </div>
    );
  }

  // Unclaimed
  return (
    <button
      onClick={() => void handleClaim()}
      disabled={submitting}
      className="inline-flex items-center gap-1.5 text-xs text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-full px-3 py-1 transition-colors disabled:opacity-50"
      aria-label="Sign up to bring snacks for this event"
    >
      <span aria-hidden="true">🍎</span>
      <span>Bring snacks? Sign up</span>
    </button>
  );
}
