import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { SPORT_TYPE_LABELS } from '@/constants';
import type { League, Team } from '@/types';

interface LeagueFormProps {
  open: boolean;
  onClose: () => void;
  editLeague: League | null;
  allTeams: Team[];
  onSave: (
    data: Omit<League, 'id' | 'createdAt' | 'updatedAt'>,
    selectedTeamIds: string[],
    prevTeamIds: string[],
  ) => Promise<void>;
}

const sportOptions = [
  { value: '', label: 'Any sport' },
  ...Object.entries(SPORT_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l })),
];

export function LeagueForm({ open, onClose, editLeague, allTeams, onSave }: LeagueFormProps) {
  const [name, setName] = useState(editLeague?.name ?? '');
  const [season, setSeason] = useState(editLeague?.season ?? '');
  const [description, setDescription] = useState(editLeague?.description ?? '');
  const [sportType, setSportType] = useState(editLeague?.sportType ?? '');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState('');
  const [saveError, setSaveError] = useState('');

  const prevTeamIds = editLeague?.id
    ? allTeams.filter(t => t.leagueIds?.includes(editLeague.id)).map(t => t.id)
    : [];
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>(prevTeamIds);

  async function handleSubmit() {
    if (!name.trim()) { setNameError('League name is required'); return; }
    setNameError('');
    setSaveError('');
    setSaving(true);
    try {
      await onSave(
        {
          name: name.trim(),
          ...(season.trim() ? { season: season.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(sportType ? { sportType: sportType as League['sportType'] } : {}),
          ...(editLeague?.managedBy ? { managedBy: editLeague.managedBy } : {}),
        } as Omit<League, 'id' | 'createdAt' | 'updatedAt'>,
        selectedTeamIds,
        prevTeamIds,
      );
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message ?? 'Save failed. Please try again.';
      setSaveError(msg.includes('Missing or insufficient permissions')
        ? 'Permission denied. Your role may not allow this action — try refreshing and signing in again.'
        : msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editLeague ? 'Edit League' : 'New League'}>
      <div className="space-y-4">
        <Input
          label="League Name"
          name="league-name"
          autoComplete="off"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Metro Youth Soccer League"
          error={nameError}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Season"
            name="league-season"
            autoComplete="off"
            value={season}
            onChange={e => setSeason(e.target.value)}
            placeholder="e.g. Spring 2025"
          />
          <Select
            label="Sport"
            value={sportType}
            onChange={e => setSportType(e.target.value)}
            options={sportOptions}
          />
        </div>
        <Input
          label="Description"
          name="league-description"
          autoComplete="off"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Optional notes about this league"
        />

        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Assign Teams</p>
          <div className="border rounded-lg max-h-52 overflow-y-auto divide-y divide-gray-100">
            {allTeams
              .filter(t => !t.isDeleted && !t.isPending && (!sportType || t.sportType === sportType))
              .map(t => (
                <label key={t.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selectedTeamIds.includes(t.id)}
                    onChange={() => setSelectedTeamIds(prev =>
                      prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id]
                    )}
                  />
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: t.color }}
                  />
                  <span className="text-sm text-gray-800">{t.name}</span>
                </label>
              ))}
          </div>
        </div>

        {saveError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : editLeague ? 'Save Changes' : 'Create League'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
