import { useState, useEffect, useRef } from 'react';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useTeamStore } from '@/store/useTeamStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useVenueStore } from '@/store/useVenueStore';
import { FLAGS } from '@/lib/flags';
import { SPORT_TYPES, SPORT_TYPE_LABELS, TEAM_COLORS, AGE_GROUPS, AGE_GROUP_LABELS, SPORT_FORFEIT_THRESHOLDS } from '@/constants';
import { ColorPickerGrid } from '@/components/ui/ColorPickerGrid';
import { PaywallAwareError } from '@/components/subscription/PaywallAwareError';
import { Upload, X, Image, ChevronDown, ChevronRight } from 'lucide-react';
import type { Team, SportType, AgeGroup } from '@/types';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

interface TeamFormProps {
  open: boolean;
  onClose: () => void;
  editTeam?: Team;
  onCreated?: (teamId: string) => void;
}

const sportOptions = SPORT_TYPES.map(s => ({ value: s, label: SPORT_TYPE_LABELS[s] }));
const ageGroupOptions = AGE_GROUPS.map(g => ({
  value: g,
  label: g === 'adult' ? `Adult League — Adult (18+)` : `${g} — ${AGE_GROUP_LABELS[g]}`,
}));

/** Returns true if any advanced field has a non-default value — used to auto-expand in edit mode. */
function hasAdvancedValues(team: Team | undefined): boolean {
  if (!team) return false;
  return !!(
    team.homeVenue ||
    team.homeVenueId ||
    team.coachName ||
    team.coachEmail ||
    team.logoUrl ||
    (team.attendanceWarningsEnabled === false) ||
    team.attendanceWarningThreshold !== undefined
  );
}

export function TeamForm({ open, onClose, editTeam, onCreated }: TeamFormProps) {
  const updateTeam = useTeamStore(s => s.updateTeam);
  const kidsSetting = useSettingsStore(s => s.settings.kidsSportsMode);
  const kidsMode = FLAGS.KIDS_MODE && kidsSetting;
  const profile = useAuthStore(s => s.profile);
  const user = useAuthStore(s => s.user);
  const savedVenues = useVenueStore(s => s.venues);

  useEffect(() => {
    return useVenueStore.getState().subscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Core fields
  const [name, setName] = useState(editTeam?.name ?? '');
  const [sportType, setSportType] = useState<SportType>(editTeam?.sportType ?? 'soccer');
  const [color, setColor] = useState(editTeam?.color ?? TEAM_COLORS[0]);
  const [ageGroup, setAgeGroup] = useState<AgeGroup | ''>(editTeam?.ageGroup ?? '');
  // Visibility: stored as isPrivate in Firestore; UI shows "Make discoverable" (inverted)
  // Default: private (isPrivate=true, discoverable=false)
  const [isPrivate, setIsPrivate] = useState<boolean>(editTeam?.isPrivate ?? true);

  // Advanced fields
  const [coachName, setCoachName] = useState(editTeam?.coachName ?? '');
  const [coachEmail, setCoachEmail] = useState(editTeam?.coachEmail ?? '');
  const [homeVenue, setHomeVenue] = useState(editTeam?.homeVenue ?? '');
  const [homeVenueId, setHomeVenueId] = useState(editTeam?.homeVenueId ?? '');
  const [coachId, setCoachId] = useState(editTeam?.coachId ?? '');
  const [attendanceWarningsEnabled, setAttendanceWarningsEnabled] = useState<boolean>(editTeam?.attendanceWarningsEnabled !== false);
  const [attendanceWarningThreshold, setAttendanceWarningThreshold] = useState<string>(
    editTeam?.attendanceWarningThreshold !== undefined ? String(editTeam.attendanceWarningThreshold) : ''
  );

  // Logo state
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(editTeam?.logoUrl ?? null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Advanced section visibility
  const [advancedOpen, setAdvancedOpen] = useState(() => hasAdvancedValues(editTeam));

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Reset all form fields when opening for a new team
  useEffect(() => {
    if (!open || editTeam) return;
    setName('');
    setSportType('soccer');
    setColor(TEAM_COLORS[0]);
    setAgeGroup('');
    setIsPrivate(true);
    setCoachName('');
    setCoachEmail('');
    setHomeVenue('');
    setHomeVenueId('');
    setCoachId('');
    setErrors({});
    setSaveError('');
    setLogoFile(null);
    setLogoPreview(null);
    setRemoveLogo(false);
    setAttendanceWarningsEnabled(true);
    setAttendanceWarningThreshold('');
    setAdvancedOpen(false);
    // Auto-fill coach fields from current user's profile
    if (profile?.email) setCoachEmail(profile.email);
    if (profile?.displayName) setCoachName(profile.displayName);
    if (user?.uid) setCoachId(user.uid);
  }, [open, editTeam, profile?.email, profile?.displayName, user?.uid]);

  useEffect(() => {
    if (!open || !editTeam) return;
    // Sync logo, attendance, and privacy state when editing
    setLogoPreview(editTeam.logoUrl ?? null);
    setRemoveLogo(false);
    setLogoFile(null);
    setIsPrivate(editTeam.isPrivate ?? true);
    setAttendanceWarningsEnabled(editTeam.attendanceWarningsEnabled !== false);
    setAttendanceWarningThreshold(
      editTeam.attendanceWarningThreshold !== undefined ? String(editTeam.attendanceWarningThreshold) : ''
    );
    setAdvancedOpen(hasAdvancedValues(editTeam));
  }, [open, editTeam?.logoUrl, editTeam?.isPrivate, editTeam?.attendanceWarningsEnabled, editTeam?.attendanceWarningThreshold]);

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
    setSaveError('');
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

        const now = new Date().toISOString();
        const parsedThreshold = attendanceWarningThreshold !== '' ? parseInt(attendanceWarningThreshold, 10) : undefined;
        const base = {
          name: name.trim(),
          sportType,
          color,
          updatedAt: now,
          ...(logoUrl ? { logoUrl } : {}),
          ...(coachName.trim() ? { coachName: coachName.trim() } : {}),
          ...(coachEmail.trim() ? { coachEmail: coachEmail.trim() } : {}),
          ...(ageGroup ? { ageGroup } : {}),
          ...(homeVenue.trim() ? { homeVenue: homeVenue.trim() } : {}),
          ...(homeVenueId ? { homeVenueId } : {}),
          ...(coachId ? { coachId } : {}),
          attendanceWarningsEnabled,
          ...(parsedThreshold !== undefined && !isNaN(parsedThreshold) ? { attendanceWarningThreshold: parsedThreshold } : {}),
          isPrivate,
        };
        if (editTeam) {
          await updateTeam({ ...editTeam, ...base });
          onClose();
        } else {
          const createFn = httpsCallable<Record<string, unknown>, { teamId: string }>(functions, 'createTeamAndBecomeCoach');
          const result = await createFn({ name: name.trim(), sportType, color, ...(ageGroup ? { ageGroup } : {}), ...(homeVenue.trim() ? { homeVenue: homeVenue.trim() } : {}), ...(homeVenueId ? { homeVenueId } : {}), ...(coachName.trim() ? { coachName: coachName.trim() } : {}), ...(coachEmail.trim() ? { coachEmail: coachEmail.trim() } : {}), ...(logoUrl ? { logoUrl } : {}), attendanceWarningsEnabled, ...(parsedThreshold !== undefined && !isNaN(parsedThreshold) ? { attendanceWarningThreshold: parsedThreshold } : {}), isPrivate });
          if (onCreated) {
            onCreated(result.data.teamId);
          }
          onClose();
        }
        return;
      }

      const now = new Date().toISOString();
      const parsedThreshold2 = attendanceWarningThreshold !== '' ? parseInt(attendanceWarningThreshold, 10) : undefined;
      const base: Partial<Team> = {
        name: name.trim(),
        sportType,
        color,
        updatedAt: now,
        ...(coachName.trim() ? { coachName: coachName.trim() } : {}),
        ...(coachEmail.trim() ? { coachEmail: coachEmail.trim() } : {}),
        ...(ageGroup ? { ageGroup } : {}),
        ...(homeVenue.trim() ? { homeVenue: homeVenue.trim() } : {}),
        ...(homeVenueId ? { homeVenueId } : {}),
        ...(coachId ? { coachId } : {}),
        attendanceWarningsEnabled,
        ...(parsedThreshold2 !== undefined && !isNaN(parsedThreshold2) ? { attendanceWarningThreshold: parsedThreshold2 } : {}),
        isPrivate,
      };
      if (logoUrl) base.logoUrl = logoUrl;
      else delete base.logoUrl;

      if (editTeam) {
        const updated = { ...editTeam, ...base };
        if (!logoUrl) delete updated.logoUrl;
        await updateTeam(updated);
        onClose();
      } else {
        const createFn = httpsCallable<Record<string, unknown>, { teamId: string }>(functions, 'createTeamAndBecomeCoach');
        const result = await createFn({ name: name.trim(), sportType, color, ...(ageGroup ? { ageGroup } : {}), ...(homeVenue.trim() ? { homeVenue: homeVenue.trim() } : {}), ...(homeVenueId ? { homeVenueId } : {}), ...(coachName.trim() ? { coachName: coachName.trim() } : {}), ...(coachEmail.trim() ? { coachEmail: coachEmail.trim() } : {}), attendanceWarningsEnabled, ...(parsedThreshold2 !== undefined && !isNaN(parsedThreshold2) ? { attendanceWarningThreshold: parsedThreshold2 } : {}), isPrivate });
        if (onCreated) {
          onCreated(result.data.teamId);
        }
        onClose();
      }
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message ?? 'Save failed. Please try again.';
      setSaveError(msg.includes('Missing or insufficient permissions')
        ? 'Permission denied. Your role may not allow this action — try refreshing and signing in again.'
        : msg);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editTeam ? 'Edit Team' : 'New Team'}>
      <div className="space-y-4">

        {/* ── Core fields ── */}
        <Input label="Team Name" name="team-name" autoComplete="off" value={name} onChange={e => setName(e.target.value)} error={errors.name} placeholder="e.g. City Hawks" />
        <Select label="Sport" value={sportType} onChange={e => setSportType(e.target.value as SportType)} options={sportOptions} />
        <Select label="Age Group" value={ageGroup} onChange={e => setAgeGroup(e.target.value as AgeGroup)} options={ageGroupOptions} placeholder="Select age group (optional)" />
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Team Color</label>
          <ColorPickerGrid value={color} onChange={setColor} />
        </div>

        {/* Visibility */}
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={!isPrivate}
              onChange={e => setIsPrivate(!e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-700">Make this team discoverable</span>
          </label>
          <p className="text-xs text-gray-400 ml-7">League managers can find and add discoverable teams to their league.</p>
        </div>

        {/* ── Advanced section ── */}
        <div className="border-t border-gray-100 pt-3">
          <button
            type="button"
            onClick={() => setAdvancedOpen(o => !o)}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors mb-3"
            aria-expanded={advancedOpen}
          >
            {advancedOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            More details
          </button>

          {advancedOpen && (
            <div className="space-y-4">
              {/* Home Venue */}
              {savedVenues.length > 0 ? (
                <Select
                  label="Home Venue (optional)"
                  value={homeVenueId}
                  onChange={e => {
                    const selected = savedVenues.find(v => v.id === e.target.value);
                    setHomeVenueId(e.target.value);
                    setHomeVenue(selected?.name ?? '');
                  }}
                  options={savedVenues.map(v => ({ value: v.id, label: v.name }))}
                  placeholder="Select a venue"
                />
              ) : (
                <Input label="Home Venue (optional)" name="home-venue" autoComplete="off" value={homeVenue} onChange={e => setHomeVenue(e.target.value)} placeholder="e.g. City Park" />
              )}

              {/* Coach fields */}
              <Input label={kidsMode ? 'Head Coach' : 'Coach Name (optional)'} name="coach-name" autoComplete="off" value={coachName} onChange={e => setCoachName(e.target.value)} />
              <Input label="Coach Email (optional)" type="email" name="coach-email" autoComplete="off" value={coachEmail} onChange={e => setCoachEmail(e.target.value)} />

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

              {/* Attendance Warnings */}
              <div className="border-t border-gray-100 pt-3 space-y-3">
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
                      name="attendance-threshold"
                      autoComplete="off"
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
            </div>
          )}
        </div>

        <PaywallAwareError error={saveError || null} action="create or edit a team" />
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={uploading}>Cancel</Button>
          <Button onClick={() => void handleSubmit()} disabled={uploading}>
            {uploading ? 'Saving…' : editTeam ? 'Save Changes' : 'Create Team'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
