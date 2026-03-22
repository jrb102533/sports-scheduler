import { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useTeamStore } from '@/store/useTeamStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useAuthStore } from '@/store/useAuthStore';
import { SPORT_TYPES, SPORT_TYPE_LABELS, TEAM_COLORS, AGE_GROUPS, AGE_GROUP_LABELS } from '@/constants';
import type { Team, SportType, AgeGroup, UserProfile } from '@/types';

interface TeamFormProps {
  open: boolean;
  onClose: () => void;
  editTeam?: Team;
}

const sportOptions = SPORT_TYPES.map(s => ({ value: s, label: SPORT_TYPE_LABELS[s] }));
const ageGroupOptions = AGE_GROUPS.map(g => ({ value: g, label: AGE_GROUP_LABELS[g] }));

export function TeamForm({ open, onClose, editTeam }: TeamFormProps) {
  const { addTeam, updateTeam } = useTeamStore();
  const kidsMode = useSettingsStore(s => s.settings.kidsSportsMode);
  const profile = useAuthStore(s => s.profile);
  const user = useAuthStore(s => s.user);
  const [name, setName] = useState(editTeam?.name ?? '');
  const [sportType, setSportType] = useState<SportType>(editTeam?.sportType ?? 'soccer');
  const [color, setColor] = useState(editTeam?.color ?? TEAM_COLORS[0]);
  const [homeVenue, setHomeVenue] = useState(editTeam?.homeVenue ?? '');
  const [coachName, setCoachName] = useState(editTeam?.coachName ?? '');
  const [coachEmail, setCoachEmail] = useState(editTeam?.coachEmail ?? '');
  const [ageGroup, setAgeGroup] = useState<AgeGroup | ''>(editTeam?.ageGroup ?? '');
  const [coachId, setCoachId] = useState(editTeam?.coachId ?? '');
  const [coachUsers, setCoachUsers] = useState<UserProfile[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isAdmin = profile?.role === 'admin';
  const isCreator = !!editTeam && editTeam.createdBy === user?.uid;
  const canAssignCoach = isAdmin || isCreator;

  useEffect(() => {
    if (!open || !canAssignCoach) return;
    getDocs(collection(db, 'users')).then(snap => {
      const coaches = snap.docs
        .map(d => d.data() as UserProfile)
        .filter(u => u.role === 'coach');
      setCoachUsers(coaches);
    });
  }, [open, canAssignCoach]);

  function validate() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Team name is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;
    const now = new Date().toISOString();
    const base = {
      name: name.trim(),
      sportType,
      color,
      updatedAt: now,
      ...(homeVenue.trim() ? { homeVenue: homeVenue.trim() } : {}),
      ...(coachName.trim() ? { coachName: coachName.trim() } : {}),
      ...(coachEmail.trim() ? { coachEmail: coachEmail.trim() } : {}),
      ...(ageGroup ? { ageGroup } : {}),
      ...(coachId ? { coachId } : {}),
    };
    if (editTeam) {
      updateTeam({ ...editTeam, ...base });
    } else {
      addTeam({ id: crypto.randomUUID(), ...base, createdBy: user!.uid, createdAt: now });
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={editTeam ? 'Edit Team' : 'New Team'}>
      <div className="space-y-4">
        <Input label="Team Name" value={name} onChange={e => setName(e.target.value)} error={errors.name} placeholder="e.g. City Hawks" />
        <Select label="Sport" value={sportType} onChange={e => setSportType(e.target.value as SportType)} options={sportOptions} />
        {kidsMode && (
          <Select label="Age Group" value={ageGroup} onChange={e => setAgeGroup(e.target.value as AgeGroup)} options={ageGroupOptions} placeholder="Select age group" />
        )}
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
        <Input label={kidsMode ? 'Head Coach' : 'Coach Name (optional)'} value={coachName} onChange={e => setCoachName(e.target.value)} />
        <Input label="Coach Email (optional)" type="email" value={coachEmail} onChange={e => setCoachEmail(e.target.value)} />
        {canAssignCoach && coachUsers.length > 0 && (
          <div className="border-t border-gray-100 pt-3">
            <Select
              label="Assign Coach Account"
              value={coachId}
              onChange={e => setCoachId(e.target.value)}
              options={coachUsers.map(u => ({ value: u.uid, label: `${u.displayName} (${u.email})` }))}
              placeholder="Select a coach user"
            />
            <p className="text-xs text-gray-400 mt-1">Links a registered coach account to this team.</p>
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>{editTeam ? 'Save Changes' : 'Create Team'}</Button>
        </div>
      </div>
    </Modal>
  );
}
