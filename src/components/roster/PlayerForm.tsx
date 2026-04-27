import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useTeamStore } from '@/store/useTeamStore';
import { functions } from '@/lib/firebase';
import { PLAYER_STATUS_LABELS } from '@/constants';
import type { Player, PlayerStatus, ParentContact, EmergencyContact } from '@/types';

interface PlayerFormProps {
  open: boolean;
  onClose: () => void;
  teamId: string;
  editPlayer?: Player;
  /**
   * When provided (Modify Roster mode), a successful edit will call this
   * with the staged patch instead of writing directly to Firestore.
   * Only used when `editPlayer` is also provided.
   */
  onStagedSave?: (patch: Partial<Player>) => void;
  /**
   * When provided (Modify Roster mode), a successful add will call this
   * with the full new Player instead of writing directly to Firestore.
   * Only used when `editPlayer` is NOT provided.
   */
  onStagedAdd?: (player: Player) => void;
}

const statusOptions = Object.entries(PLAYER_STATUS_LABELS).map(([value, label]) => ({ value, label }));

/** Returns the player's age in whole years given an ISO date string, or null if blank/invalid. */
function calculateAge(dobString: string): number | null {
  if (!dobString) return null;
  const dob = new Date(dobString);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

const sendInviteFn = httpsCallable<{
  to: string; playerName: string; teamName: string; playerId: string; teamId: string; role?: string;
}>(functions, 'sendInvite');

function ParentFields({
  label,
  name, setName,
  phone, setPhone,
  email, setEmail,
  emailError,
}: {
  label: string;
  name: string; setName: (v: string) => void;
  phone: string; setPhone: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  emailError?: string;
}) {
  return (
    <div className="border-t border-gray-100 pt-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{label}</p>
      <div className="space-y-3">
        <Input label="Name" name="parent-name" autoComplete="off" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Jane Smith" />
        <Input label="Phone" type="tel" name="parent-phone" autoComplete="off" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. 555-123-4567" />
        <Input label="Email" type="email" name="parent-email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} placeholder="e.g. jane@example.com" error={emailError} />
      </div>
    </div>
  );
}

export function PlayerForm({ open, onClose, teamId, editPlayer, onStagedSave, onStagedAdd }: PlayerFormProps) {
  const { addPlayer, updatePlayer, addSensitiveData, updateSensitiveData } = usePlayerStore();
  const team = useTeamStore(s => s.teams.find(t => t.id === teamId));

  const [firstName, setFirstName] = useState(editPlayer?.firstName ?? '');
  const [lastName, setLastName] = useState(editPlayer?.lastName ?? '');
  const [jerseyNumber, setJerseyNumber] = useState(editPlayer?.jerseyNumber?.toString() ?? '');
  const [position, setPosition] = useState(editPlayer?.position ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(editPlayer?.dateOfBirth ?? '');
  const [status, setStatus] = useState<PlayerStatus>(editPlayer?.status ?? 'active');
  const [email, setEmail] = useState(editPlayer?.email ?? '');
  const [consentChecked, setConsentChecked] = useState(false);

  const [p1Name, setP1Name] = useState(editPlayer?.parentContact?.parentName ?? '');
  const [p1Phone, setP1Phone] = useState(editPlayer?.parentContact?.parentPhone ?? '');
  const [p1Email, setP1Email] = useState(editPlayer?.parentContact?.parentEmail ?? '');

  const [p2Name, setP2Name] = useState(editPlayer?.parentContact2?.parentName ?? '');
  const [p2Phone, setP2Phone] = useState(editPlayer?.parentContact2?.parentPhone ?? '');
  const [p2Email, setP2Email] = useState(editPlayer?.parentContact2?.parentEmail ?? '');

  const [ecName, setEcName] = useState(editPlayer?.emergencyContact?.name ?? '');
  const [ecPhone, setEcPhone] = useState(editPlayer?.emergencyContact?.phone ?? '');
  const [ecRelationship, setEcRelationship] = useState(editPlayer?.emergencyContact?.relationship ?? '');

  const isAdultTeam = team?.ageGroup === 'adult';

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const playerAge = calculateAge(dateOfBirth);
  /** 'coppa' = under 13, 'minor' = 13–17, null = no notice needed */
  const consentTier: 'coppa' | 'minor' | null =
    playerAge !== null && playerAge < 13
      ? 'coppa'
      : playerAge !== null && playerAge < 18
        ? 'minor'
        : null;

  function isValidEmail(v: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!firstName.trim()) e.firstName = 'First name is required';
    if (!lastName.trim()) e.lastName = 'Last name is required';
    if (email.trim() && !isValidEmail(email.trim())) e.playerInviteEmail = 'Must be a valid email address';
    if (consentTier && !consentChecked) {
      e.consent = 'You must confirm the parental notice before saving.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function buildParentContact(name: string, phone: string, pEmail: string): ParentContact | undefined {
    if (!name.trim() && !phone.trim() && !pEmail.trim()) return undefined;
    return {
      parentName: name.trim(),
      parentPhone: phone.trim(),
      ...(pEmail.trim() ? { parentEmail: pEmail.trim() } : {}),
    };
  }

  function buildEmergencyContact(name: string, phone: string, relationship: string): EmergencyContact | undefined {
    if (!name.trim() && !phone.trim()) return undefined;
    return {
      name: name.trim(),
      phone: phone.trim(),
      ...(relationship.trim() ? { relationship: relationship.trim() } : {}),
    };
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSaving(true);
    setSaveError(null);
    const now = new Date().toISOString();
    const num = jerseyNumber ? parseInt(jerseyNumber) : undefined;

    const parentContact = isAdultTeam ? undefined : buildParentContact(p1Name, p1Phone, p1Email);
    const parentContact2 = isAdultTeam ? undefined : buildParentContact(p2Name, p2Phone, p2Email);
    const emergencyContact = buildEmergencyContact(ecName, ecPhone, ecRelationship);

    // Sensitive PII fields go to the restricted subcollection, not the main doc.
    const sensitiveFields = {
      ...(dateOfBirth.trim() ? { dateOfBirth: dateOfBirth.trim() } : {}),
      ...(parentContact ? { parentContact } : {}),
      ...(parentContact2 ? { parentContact2 } : {}),
      ...(emergencyContact ? { emergencyContact } : {}),
    };

    const mainOptionals = {
      ...(num !== undefined ? { jerseyNumber: num } : {}),
      ...(position.trim() ? { position: position.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
    };

    try {
      if (editPlayer && onStagedSave) {
        // Modify Roster mode: stage the edit locally rather than writing to Firestore.
        const patch: Partial<Player> = {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          status,
          updatedAt: now,
          ...mainOptionals,
          ...sensitiveFields,
        };
        onStagedSave(patch);
        setSaving(false);
        onClose();
        return;
      }

      if (editPlayer) {
        await updatePlayer({ ...editPlayer, firstName: firstName.trim(), lastName: lastName.trim(), status, updatedAt: now, ...mainOptionals });
        if (Object.keys(sensitiveFields).length > 0) {
          await updateSensitiveData(editPlayer.id, teamId, sensitiveFields);
        }
      } else if (onStagedAdd) {
        // Modify Roster mode: stage the new player locally rather than writing to Firestore.
        const playerId = crypto.randomUUID();
        const stagedPlayer: Player = {
          id: playerId,
          teamId,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          status,
          createdAt: now,
          updatedAt: now,
          ...mainOptionals,
          ...sensitiveFields,
        };
        onStagedAdd(stagedPlayer);
        setSaving(false);
        onClose();
        return;
      } else {
        const playerId = crypto.randomUUID();
        await addPlayer({ id: playerId, teamId, firstName: firstName.trim(), lastName: lastName.trim(), status, createdAt: now, updatedAt: now, ...mainOptionals });
        if (Object.keys(sensitiveFields).length > 0) {
          await addSensitiveData(playerId, teamId, sensitiveFields);
        }

        if (team) {
          const playerName = `${firstName.trim()} ${lastName.trim()}`;
          const invites: Array<{ to: string; role: string }> = [];
          if (email.trim()) invites.push({ to: email.trim(), role: 'player' });
          if (p1Email.trim()) invites.push({ to: p1Email.trim(), role: 'parent' });
          for (const { to, role } of invites) {
            try {
              await sendInviteFn({ to, playerName, teamName: team.name, playerId, teamId, role });
            } catch (err) {
              console.error('Invite send failed:', err);
            }
          }
        }
      }

      setSaving(false);
      onClose();
    } catch (err: unknown) {
      console.error('[PlayerForm] save failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg.includes('permission') ? 'Permission denied — your account may not be linked to this team. Contact your admin.' : `Failed to save: ${msg}`);
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editPlayer ? 'Edit Player' : 'Add Player'}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="First Name" name="given-name" autoComplete="given-name" value={firstName} onChange={e => setFirstName(e.target.value)} error={errors.firstName} />
          <Input label="Last Name" name="family-name" autoComplete="family-name" value={lastName} onChange={e => setLastName(e.target.value)} error={errors.lastName} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Jersey #" type="number" name="jersey-number" autoComplete="off" min="0" value={jerseyNumber} onChange={e => setJerseyNumber(e.target.value)} />
          <Input label="Position" name="position" autoComplete="off" value={position} onChange={e => setPosition(e.target.value)} placeholder="e.g. Forward" />
        </div>
        <Select label="Status" value={status} onChange={e => setStatus(e.target.value as PlayerStatus)} options={statusOptions} />
        <Input
          label="Date of Birth"
          type="date"
          value={dateOfBirth}
          onChange={e => {
            setDateOfBirth(e.target.value);
            setConsentChecked(false);
          }}
        />

        {/* COPPA / minor parental consent notice — shown based on calculated age */}
        {consentTier === 'coppa' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
            <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">COPPA Notice — Player Under 13</p>
            <p className="text-xs text-amber-900 leading-relaxed">
              This player is under 13. U.S. law (COPPA) requires verifiable parental consent before collecting personal
              information about children under 13. By checking the box below, you confirm that written or verbal parental
              consent has been obtained and is on file with your organization.
            </p>
            <p className="text-xs text-amber-700">
              Parents may request removal of their child&rsquo;s profile at any time by contacting{' '}
              <a href="mailto:legal@firstwhistle.com" className="underline">legal@firstwhistle.com</a>.
            </p>
            <label className="flex items-start gap-2.5 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={e => setConsentChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-amber-400 text-amber-700 focus:ring-amber-500"
              />
              <span className="text-xs text-amber-900 font-medium leading-relaxed">
                I confirm parental consent has been obtained and is on file.
              </span>
            </label>
            {errors.consent && (
              <p className="text-xs text-red-600">{errors.consent}</p>
            )}
          </div>
        )}

        {consentTier === 'minor' && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 space-y-2">
            <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Minor Player Notice — Under 18</p>
            <p className="text-xs text-blue-900 leading-relaxed">
              This player is under 18. Before saving this profile, confirm that a parent or guardian has been informed
              that their child&rsquo;s information will be stored on First Whistle.
            </p>
            <label className="flex items-start gap-2.5 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={e => setConsentChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-blue-400 text-blue-700 focus:ring-blue-500"
              />
              <span className="text-xs text-blue-900 font-medium leading-relaxed">
                I confirm a parent or guardian has been notified.
              </span>
            </label>
            {errors.consent && (
              <p className="text-xs text-red-600">{errors.consent}</p>
            )}
          </div>
        )}

        <div className="space-y-1">
          <Input
            label="Player Email (optional)"
            type="email"
            name="player-email"
            autoComplete="off"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="player@example.com"
            error={errors.playerInviteEmail}
          />
          {!errors.playerInviteEmail && (
            <p className="text-xs text-gray-400">For older players who manage their own account</p>
          )}
        </div>

        {!isAdultTeam && (
          <>
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Parent / Guardian Contact</p>
              <p className="text-xs text-gray-400 mb-3">(Optional — parent email will receive an invite)</p>
            </div>
            <ParentFields
              label="Parent / Guardian 1"
              name={p1Name} setName={setP1Name}
              phone={p1Phone} setPhone={setP1Phone}
              email={p1Email} setEmail={setP1Email}
            />
            <ParentFields
              label="Parent / Guardian 2 (optional)"
              name={p2Name} setName={setP2Name}
              phone={p2Phone} setPhone={setP2Phone}
              email={p2Email} setEmail={setP2Email}
            />
          </>
        )}

        {!editPlayer && (email.trim() || p1Email.trim()) && (
          <p className="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
            An invite email will be sent to all provided email addresses so they can join the team.
          </p>
        )}

        {/* Emergency Contact — always shown */}
        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Emergency Contact</p>
          <p className="text-xs text-gray-400 mb-3">(Optional)</p>
          <div className="space-y-3">
            <Input label="Name" name="ec-name" autoComplete="off" value={ecName} onChange={e => setEcName(e.target.value)} placeholder="Full name" />
            <Input label="Phone" type="tel" name="ec-phone" autoComplete="off" value={ecPhone} onChange={e => setEcPhone(e.target.value)} placeholder="Phone number" />
            <Input label="Relationship" name="ec-relationship" autoComplete="off" value={ecRelationship} onChange={e => setEcRelationship(e.target.value)} placeholder="e.g. Grandmother, Uncle — optional" />
          </div>
        </div>

        {saveError && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{saveError}</p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || (consentTier !== null && !consentChecked)}
          >
            {saving ? 'Saving…' : editPlayer ? 'Save Changes' : 'Add Player'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
