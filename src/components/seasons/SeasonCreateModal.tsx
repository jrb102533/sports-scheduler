import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useSeasonStore } from '@/store/useSeasonStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { Season } from '@/types';

interface SeasonCreateModalProps {
  open: boolean;
  onClose: () => void;
  leagueId: string;
  onCreated?: (season: Season) => void;
}

export function SeasonCreateModal({ open, onClose, leagueId, onCreated }: SeasonCreateModalProps) {
  const createSeason = useSeasonStore(s => s.createSeason);
  const user = useAuthStore(s => s.user);

  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [gamesPerTeam, setGamesPerTeam] = useState('10');
  const [homeAwayBalance, setHomeAwayBalance] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Season name is required.';
    if (!startDate) errs.startDate = 'Start date is required.';
    if (!endDate) errs.endDate = 'End date is required.';
    if (startDate && endDate && endDate <= startDate) {
      errs.endDate = 'End date must be after start date.';
    }
    const gpt = parseInt(gamesPerTeam);
    if (isNaN(gpt) || gpt < 1) errs.gamesPerTeam = 'Games per team must be at least 1.';
    if (gpt > 50) errs.gamesPerTeam = 'Games per team cannot exceed 50.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    if (!user) return;
    setSaving(true);
    try {
      const season = await createSeason(leagueId, {
        name: name.trim(),
        startDate,
        endDate,
        gamesPerTeam: parseInt(gamesPerTeam),
        homeAwayBalance,
        status: 'setup',
        createdBy: user.uid,
      });
      onCreated?.(season);
      handleClose();
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    setName('');
    setStartDate('');
    setEndDate('');
    setGamesPerTeam('10');
    setHomeAwayBalance(true);
    setErrors({});
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="New Season">
      <div className="space-y-4">
        <Input
          label="Season Name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Spring 2026"
          error={errors.name}
          autoFocus
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Start Date"
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            error={errors.startDate}
          />
          <Input
            label="End Date"
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            error={errors.endDate}
          />
        </div>

        <Input
          label="Games Per Team"
          type="number"
          min="1"
          max="50"
          value={gamesPerTeam}
          onChange={e => setGamesPerTeam(e.target.value)}
          error={errors.gamesPerTeam}
        />

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={homeAwayBalance}
            onChange={e => setHomeAwayBalance(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <span className="text-sm font-medium text-gray-700">Home/Away Balance</span>
            <p className="text-xs text-gray-500 mt-0.5">
              Distribute home and away games evenly across teams.
            </p>
          </div>
        </label>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Creating…' : 'Create Season'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
