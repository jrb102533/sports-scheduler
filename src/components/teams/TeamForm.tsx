import { useState, useEffect, useRef } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useTeamStore } from '@/store/useTeamStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useAuthStore } from '@/store/useAuthStore';
import { FLAGS } from '@/lib/flags';
import { SPORT_TYPES, SPORT_TYPE_LABELS, TEAM_COLORS, AGE_GROUPS, AGE_GROUP_LABELS, SPORT_FORFEIT_THRESHOLDS } from '@/constants';
import { Upload, X, Image } from 'lucide-react';
import type { Team, SportType, AgeGroup, UserProfile } from '@/types';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

interface TeamFormProps {
  open: boolean;
  onClose: () => void;
  editTeam?: Team;
}

const sportOptions = SPORT_TYPES.map(s => ({ value: s, label: SPORT_TYPE_LABELS[s] }));
const ageGroupOptions = AGE_GROUPS.map(g => ({
  value: g,
  label: g === 'adult' ? `Adult League — Adult (18+)` : `${g} — ${AGE_GROUP_LABELS[g]}`,
}));

export function TeamForm({ open, onClose, editTeam }: TeamFormProps) {
  const { addTeam, updateTeam } = useTeamStore();
  const kidsMode = FLAGS.KIDS_MODE && useSettingsStore(s => s.settings.kidsSportsMode);
  const profile = useAuthStore(s => s.profile);
  const user = useAuthStore(s => s.user);
  const [name, setName] = useState(editTeam?.name ?? '');
  const [sportType, setSportType] = useState<SportType>(editTeam?.sportType ?? 'soccer');
  const [color, setColor] = useState(editTeam?.color ?? TEAM_COLORS[0]);
  const [homeVenue, setHomeVenue] = useState(editTeam?.homeVenue ?? '');
  const [coachName, setCoachName] = useState(editTeam?.coachName ?? '');
  const [coachEmail, setCoachEmail] = useState(editTeam?.coachEmail ?? '');
  const [ageGroup, setAgeGroup] = useState<AgeGroup | ''>(editTeam?.ageGroup ?? '');
  const [divisionLabel, setDivisionLabel] = useState(editTeam?.divisionLabel ?? '');
  const [coachId, setCoachId] = useState(editTeam?.coachId ?? '');
  const [coachUsers, setCoachUsers] = useState<UserProfile[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attendanceWarningsEnabled, setAttendanceWarningsEnabled] = useState<boolean>(editTeam?.attendanceWarningsEnabled !== false);
  const [attendanceWarningThreshold, setAttendanceWarningThreshold] = useState<string>(
    editTeam?.attendanceWarningThreshold !== undefined ? String(editTeam.attendanceWarningThreshold) : ''
  );

  // Logo state
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(editTeam?.logoUrl ?? null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = profile?.role === 'admin';
  const isCreator = !editTeam || editTeam.createdBy === user?.uid;
  const canAssignCoach = isAdmin || isCreator;

  useEffect(() => {
    if (!open) return;
    // Reset logo state when form opens
    setLogoFile(null);
    setLogoPreview(editTeam?.logoUrl ?? null);
    setRemoveLogo(false);
    // Reset attendance warning state
    setAttendanceWarningsEnabled(editTeam?.attendanceWarningsEnabled !== false);
    setAttendanceWarningThreshold(
      editTeam?.attendanceWarningThreshold !== undefined ? String(editTeam.attendanceWarningThreshold) : ''
    );
  }, [open, editTeam?.logoUrl, editTeam?.attendanceWarningsEnabled, editTeam?.attendanceWarningThreshold]);

  // Auto-fill coach email with current user's email for new teams only
  useEffect(() => {
    if (!open || editTeam) return;
    if (profile?.email) {
      setCoachEmail(prev => prev || profile.email);
    }
  }, [open, editTeam, profile?.email]);

  useEffect(() => {
    if (!open || !canAssignCoach) return;
    getDocs(collection(db, 'users')).then(snap => {
      const coaches = snap.docs
        .map(d => d.data() as UserProfile)
        .filter(u => u.role === 'coach');
      setCoachUsers(coaches);
    });
  }, [open, canAssignCoach]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setErrors(prev => ({ ...prev, logo: 'File must be an image (JPEG, PNG, WebP, GIF, or SVG)' }));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setErrors(prev => ({ ...prev, logo: 'Image must be under 2 MB' }));
      return;
    }

    setErrors(prev => { const e = { ...prev }; delete e.logo; return e; });
    setLogoFile(file);
    setRemoveLogo(false);
    setLogoPreview(URL.createObjectURL(file));
  }

  function handleRemoveLogo() {
    setLogoFile(null);
    setLogoPreview(null);
    setRemoveLogo(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Team name is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setUploading(true);
    try {
      let logoUrl = editTeam?.logoUrl;

      if (removeLogo && logoUrl) {
        try { await deleteObject(ref(storage, `team-logos/${editTeam!.id}`)); } catch { /* already gone */ }
        logoUrl = undefined;
      }

      if (logoFile) {
        const teamId = editTeam?.id ?? crypto.randomUUID();
        const storageRef = ref(storage, `team-logos/${teamId}`);
        await uploadBytes(storageRef, logoFile);
        logoUrl = await getDownloadURL(storageRef);

        // If this is a new team we need to carry the id through
        const now = new Date().toISOString();
        const parsedThreshold = attendanceWarningThreshold !== '' ? parseInt(attendanceWarningThreshold, 10) : undefined;
        const base = {
          name: name.trim(),
          sportType,
          color,
          updatedAt: now,
          ...(logoUrl ? { logoUrl } : {}),
          ...(homeVenue.trim() ? { homeVenue: homeVenue.trim() } : {}),
          ...(coachName.trim() ? { coachName: coachName.trim() } : {}),
          ...(coachEmail.trim() ? { coachEmail: coachEmail.trim() } : {}),
          ...(ageGroup ? { ageGroup } : {}),
          ...(divisionLabel.trim() ? { divisionLabel: divisionLabel.trim() } : {}),
          ...(coachId ? { coachId } : {}),
          attendanceWarningsEnabled,
          ...(parsedThreshold !== undefined && !isNaN(parsedThreshold) ? { attendanceWarningThreshold: parsedThreshold } : {}),
        };
        if (editTeam) {
          await updateTeam({ ...editTeam, ...base });
        } else {
          await addTeam({ id: teamId, ...base, createdBy: user!.uid, ownerName: profile!.displayName, createdAt: now });
        }
        onClose();
        return;
      }

      const now = new Date().toISOString();
      const parsedThreshold2 = attendanceWarningThreshold !== '' ? parseInt(attendanceWarningThreshold, 10) : undefined;
      const base: Partial<Team> = {
        name: name.trim(),
        sportType,
        color,
        updatedAt: now,
        ...(homeVenue.trim() ? { homeVenue: homeVenue.trim() } : {}),
        ...(coachName.trim() ? { coachName: coachName.trim() } : {}),
        ...(coachEmail.trim() ? { coachEmail: coachEmail.trim() } : {}),
        ...(ageGroup ? { ageGroup } : {}),
        ...(divisionLabel.trim() ? { divisionLabel: divisionLabel.trim() } : {}),
        ...(coachId ? { coachId } : {}),
        attendanceWarningsEnabled,
        ...(parsedThreshold2 !== undefined && !isNaN(parsedThreshold2) ? { attendanceWarningThreshold: parsedThreshold2 } : {}),
      };
      if (logoUrl) base.logoUrl = logoUrl;
      else delete base.logoUrl;

      if (editTeam) {
        const updated = { ...editTeam, ...base };
        if (!logoUrl) delete updated.logoUrl;
        await updateTeam(updated);
      } else {
        await addTeam({ id: crypto.randomUUID(), ...base as Omit<Team, 'id' | 'createdBy' | 'ownerName' | 'createdAt'>, createdBy: user!.uid, ownerName: profile!.displayName, createdAt: now });
      }
      onClose();
    } finally {
      setUploading(false);
    }
  }


  return (
    <Modal open={open} onClose={onClose} title={editTeam ? 'Edit Team' : 'New Team'}>
      <div className="space-y-4">
        <Input label="Team Name" value={name} onChange={e => setName(e.target.value)} error={errors.name} placeholder="e.g. City Hawks" />
        <Select label="Sport" value={sportType} onChange={e => setSportType(e.target.value as SportType)} options={sportOptions} />
        <Select label="Age Group" value={ageGroup} onChange={e => setAgeGroup(e.target.value as AgeGroup)} options={ageGroupOptions} placeholder="Select age group" />
        <div className="flex flex-col gap-1">
          <Input
            label="Division label (optional)"
            value={divisionLabel}
            onChange={e => setDivisionLabel(e.target.value)}
            placeholder="e.g. Little League, Pee Wee, Rep"
          />
          <p className="text-xs text-gray-400">Use this for league-specific division names. Shown alongside the age group.</p>
        </div>
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

        {/* Logo upload */}
        <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Team Logo <span className="text-gray-400 font-normal">(optional, max 2 MB)</span></label>
            {logoPreview ? (
              <div className="flex items-center gap-3">
                <img src={logoPreview} alt="Team logo" className="w-16 h-16 rounded-xl object-contain border border-gray-200 bg-gray-50" />
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <Upload size={12} /> Replace
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    className="text-xs text-red-500 hover:underline flex items-center gap-1"
                  >
                    <X size={12} /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-blue-300 hover:text-blue-500 transition-colors w-full"
              >
                <Image size={16} /> Upload logo image
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_TYPES.join(',')}
              className="hidden"
              onChange={handleFileChange}
            />
            {errors.logo && <p className="text-xs text-red-500">{errors.logo}</p>}
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
        {/* Attendance Warnings */}
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Attendance Warnings</h3>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={attendanceWarningsEnabled}
              onChange={e => setAttendanceWarningsEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">Warn me when confirmed attendance is low</span>
          </label>
          {attendanceWarningsEnabled && (
            <div className="space-y-1">
              <Input
                label="Minimum players threshold"
                type="number"
                min={1}
                value={attendanceWarningThreshold}
                onChange={e => setAttendanceWarningThreshold(e.target.value)}
                placeholder={`Default for ${sportType}: ${SPORT_FORFEIT_THRESHOLDS[sportType]}`}
              />
              <p className="text-xs text-gray-400">
                Warn when fewer than this many players have confirmed. Leave blank to use the sport default.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void handleSubmit()} disabled={uploading}>
            {uploading ? 'Saving…' : editTeam ? 'Save Changes' : 'Create Team'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
