import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { functions } from '@/lib/firebase';
import { useAuthStore } from '@/store/useAuthStore';
import {
  TEAM_COLORS,
  SPORT_TYPES,
  SPORT_TYPE_LABELS,
  AGE_GROUPS,
  AGE_GROUP_LABELS,
} from '@/constants';
import { ColorPickerGrid } from '@/components/ui/ColorPickerGrid';
import type { SportType, AgeGroup } from '@/types';

interface BecomeCoachModalProps {
  open: boolean;
  onClose: () => void;
}

interface CreateTeamResult {
  teamId: string;
  newMembershipIndex: number;
}

const sportOptions = SPORT_TYPES.map(s => ({ value: s, label: SPORT_TYPE_LABELS[s] }));
const ageGroupOptions = AGE_GROUPS.map(g => ({ value: g, label: AGE_GROUP_LABELS[g] }));

export function BecomeCoachModal({ open, onClose }: BecomeCoachModalProps) {
  const navigate = useNavigate();

  // Selector for rendering only — per CLAUDE.md Zustand rules
  const uid = useAuthStore(s => s.user?.uid);

  const [name, setName] = useState('');
  const [sportType, setSportType] = useState<SportType>('soccer');
  const [color, setColor] = useState(TEAM_COLORS[0]);
  const [ageGroup, setAgeGroup] = useState('');
  const [homeVenue, setHomeVenue] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset all fields when the modal closes
  useEffect(() => {
    if (!open) {
      setName('');
      setSportType('soccer');
      setColor(TEAM_COLORS[0]);
      setAgeGroup('');
      setHomeVenue('');
      setNameError(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError('Team name is required.');
      return;
    }
    setNameError(null);
    setError(null);
    setSaving(true);

    try {
      const fn = httpsCallable<
        {
          name: string;
          sportType: SportType;
          color: string;
          ageGroup?: AgeGroup;
          homeVenue?: string;
        },
        CreateTeamResult
      >(functions, 'createTeamAndBecomeCoach');

      const result = await fn({
        name: trimmedName,
        sportType,
        color,
        ageGroup: (ageGroup as AgeGroup) || undefined,
        homeVenue: homeVenue.trim() || undefined,
      });

      // activeContext is set server-side in the CF (client write is blocked by Firestore rules post role-elevation)
      navigate(`/teams/${result.data.teamId}`);
      onClose();
    } catch (err: unknown) {
      const message =
        (err as { message?: string }).message ?? 'Something went wrong. Please try again.';
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create a Team">
      <form onSubmit={handleSubmit} noValidate>
        <div className="flex flex-col gap-4">
          <Input
            label="Team Name"
            value={name}
            onChange={e => setName(e.target.value)}
            error={nameError ?? undefined}
            autoFocus
            disabled={saving}
          />

          <Select
            label="Sport"
            value={sportType}
            onChange={e => setSportType(e.target.value as SportType)}
            options={sportOptions}
            disabled={saving}
          />

          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-700">Team Color</span>
            <ColorPickerGrid value={color} onChange={setColor} disabled={saving} />
          </div>

          <Select
            label="Age Group"
            value={ageGroup}
            onChange={e => setAgeGroup(e.target.value)}
            options={ageGroupOptions}
            placeholder="Select age group (optional)"
            disabled={saving}
          />

          <Input
            label="Home Venue"
            value={homeVenue}
            onChange={e => setHomeVenue(e.target.value)}
            disabled={saving}
          />

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={saving || !uid}>
              {saving ? 'Creating team…' : 'Create Team'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
