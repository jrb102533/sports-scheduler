import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { usePracticeSlotStore } from '@/store/usePracticeSlotStore';
import type { PracticeSlotSignup } from '@/types';

interface Props {
  leagueId: string;
  seasonId: string;
  windowId: string;
  occurrenceDate: string;
  teamId: string;
  teamName: string;
  /** The caller's existing signup for this occurrence, if any. */
  existingSignup: PracticeSlotSignup | null;
  /** True when the slot is at capacity and this team is not already signed up. */
  isFull: boolean;
}

export function PracticeSlotSignupButton({
  leagueId,
  seasonId,
  windowId,
  occurrenceDate,
  teamId,
  teamName,
  existingSignup,
  isFull,
}: Props) {
  const { signUp, cancelSignup } = usePracticeSlotStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSignUp() {
    setBusy(true);
    setError('');
    try {
      await signUp({ leagueId, seasonId, windowId, occurrenceDate, teamId, teamName });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-up failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!existingSignup) return;
    setBusy(true);
    setError('');
    try {
      await cancelSignup({ leagueId, seasonId, signupId: existingSignup.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  }

  if (existingSignup?.status === 'confirmed') {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button variant="secondary" size="sm" onClick={handleCancel} disabled={busy}>
          {busy ? 'Cancelling…' : 'Cancel Booking'}
        </Button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  if (existingSignup?.status === 'waitlisted') {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button variant="secondary" size="sm" onClick={handleCancel} disabled={busy}>
          {busy ? 'Leaving…' : 'Leave Waitlist'}
        </Button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={handleSignUp} disabled={busy}>
        {busy ? 'Booking…' : isFull ? 'Join Waitlist' : 'Book Slot'}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
