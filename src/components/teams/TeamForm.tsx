import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useTeamStore } from '@/store/useTeamStore';
import { SPORT_TYPES, SPORT_TYPE_LABELS, TEAM_COLORS } from '@/constants';
import type { Team, SportType } from '@/types';

interface TeamFormProps {
  open: boolean;
  onClose: () => void;
  editTeam?: Team;
}

const sportOptions = SPORT_TYPES.map(s => ({ value: s, label: SPORT_TYPE_LABELS[s] }));

export function TeamForm({ open, onClose, editTeam }: TeamFormProps) {
  const { addTeam, updateTeam } = useTeamStore();
  const [name, setName] = useState(editTeam?.name ?? '');
  const [sportType, setSportType] = useState<SportType>(editTeam?.sportType ?? 'soccer');
  const [color, setColor] = useState(editTeam?.color ?? TEAM_COLORS[0]);
  const [homeVenue, setHomeVenue] = useState(editTeam?.homeVenue ?? '');
  const [coachName, setCoachName] = useState(editTeam?.coachName ?? '');
  const [coachEmail, setCoachEmail] = useState(editTeam?.coachEmail ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Team name is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;
    const now = new Date().toISOString();
    if (editTeam) {
      updateTeam({ ...editTeam, name: name.trim(), sportType, color, homeVenue: homeVenue.trim() || undefined, coachName: coachName.trim() || undefined, coachEmail: coachEmail.trim() || undefined, updatedAt: now });
    } else {
      addTeam({ id: crypto.randomUUID(), name: name.trim(), sportType, color, homeVenue: homeVenue.trim() || undefined, coachName: coachName.trim() || undefined, coachEmail: coachEmail.trim() || undefined, createdAt: now, updatedAt: now });
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={editTeam ? 'Edit Team' : 'New Team'}>
      <div className="space-y-4">
        <Input label="Team Name" value={name} onChange={e => setName(e.target.value)} error={errors.name} placeholder="e.g. City Hawks" />
        <Select label="Sport" value={sportType} onChange={e => setSportType(e.target.value as SportType)} options={sportOptions} />
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Team Color</label>
          <div className="flex gap-2 flex-wrap">
            {TEAM_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full border-2 transition-transform ${color === c ? 'border-gray-900 scale-110' : 'border-transparent hover:scale-105'}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
        <Input label="Home Venue (optional)" value={homeVenue} onChange={e => setHomeVenue(e.target.value)} placeholder="e.g. City Park" />
        <Input label="Coach Name (optional)" value={coachName} onChange={e => setCoachName(e.target.value)} />
        <Input label="Coach Email (optional)" type="email" value={coachEmail} onChange={e => setCoachEmail(e.target.value)} />
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>{editTeam ? 'Save Changes' : 'Create Team'}</Button>
        </div>
      </div>
    </Modal>
  );
}
