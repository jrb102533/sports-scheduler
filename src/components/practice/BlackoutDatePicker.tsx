import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { usePracticeSlotStore } from '@/store/usePracticeSlotStore';

interface Props {
  open: boolean;
  onClose: () => void;
  leagueId: string;
  seasonId: string;
  windowId: string;
  windowName: string;
}

export function BlackoutDatePicker({ open, onClose, leagueId, seasonId, windowId, windowName }: Props) {
  const { addBlackout } = usePracticeSlotStore();
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [affectedTeams, setAffectedTeams] = useState<string[] | null>(null);

  function reset() {
    setDate('');
    setBusy(false);
    setError('');
    setAffectedTeams(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleApply() {
    if (!date) return;
    setBusy(true);
    setError('');
    try {
      const result = await addBlackout({ leagueId, seasonId, windowId, date });
      setAffectedTeams(result.affectedTeams);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add blackout');
    } finally {
      setBusy(false);
    }
  }

  // After successful blackout — show summary then close
  if (affectedTeams !== null) {
    return (
      <Modal open={open} onClose={handleClose} title="Blackout Applied">
        <div className="space-y-3">
          {affectedTeams.length === 0 ? (
            <p className="text-sm text-gray-600">No active bookings were affected.</p>
          ) : (
            <>
              <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg text-sm text-amber-800">
                <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                <span>
                  {affectedTeams.length} booking{affectedTeams.length !== 1 ? 's' : ''} cancelled and coaches notified:
                </span>
              </div>
              <ul className="text-sm text-gray-700 space-y-1 pl-2">
                {affectedTeams.map(t => <li key={t}>• {t}</li>)}
              </ul>
            </>
          )}
          <div className="flex justify-end pt-2">
            <Button onClick={handleClose}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title={`Block a Date — ${windowName}`}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Blocking a date will cancel all confirmed and waitlisted bookings on that date
          and notify affected coaches.
        </p>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date to block</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={handleClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={handleApply} disabled={!date || busy}>
            {busy ? 'Applying…' : 'Block Date'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
