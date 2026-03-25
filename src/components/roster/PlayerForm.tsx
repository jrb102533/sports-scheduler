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
}

const statusOptions = Object.entries(PLAYER_STATUS_LABELS).map(([value, label]) => ({ value, label }));

const sendInviteFn = httpsCallable<{
  to: string; playerName: string; teamName: string; playerId: string; teamId: string;
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
        <Input label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Jane Smith" />
        <Input label="Phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. 555-123-4567" />
        <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="e.g. jane@example.com" error={emailError} />
      </div>
    </div>
  );
}

export function PlayerForm({ open, onClose, teamId, editPlayer }: PlayerFormProps) {
  const { addPlayer, updatePlayer } = usePlayerStore();
  const team = useTeamStore(s => s.teams.find(t => t.id === teamId));

  const [firstName, setFirstName] = useState(editPlayer?.firstName ?? '');
  const [lastName, setLastName] = useState(editPlayer?.lastName ?? '');
  const [jerseyNumber, setJerseyNumber] = useState(editPlayer?.jerseyNumber?.toString() ?? '');
  const [position, setPosition] = useState(editPlayer?.position ?? '');
  const [status, setStatus] = useState<PlayerStatus>(editPlayer?.status ?? 'active');
  const [email, setEmail] = useState(editPlayer?.email ?? '');

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

  function validate() {
    const e: Record<string, string> = {};
    if (!firstName.trim()) e.firstName = 'First name is required';
    if (!lastName.trim()) e.lastName = 'Last name is required';
    if (!editPlayer && !isAdultTeam && !email.trim() && !p1Email.trim() && !p2Email.trim()) {
      e.contactEmail = 'At least one email (player or parent) is required to send an invite';
    }
    if (!editPlayer && isAdultTeam && !email.trim()) {
      e.contactEmail = 'Player email is required to send an invite';
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
    const now = new Date().toISOString();
    const num = jerseyNumber ? parseInt(jerseyNumber) : undefined;

    const parentContact = isAdultTeam ? undefined : buildParentContact(p1Name, p1Phone, p1Email);
    const parentContact2 = isAdultTeam ? undefined : buildParentContact(p2Name, p2Phone, p2Email);
    const emergencyContact = buildEmergencyContact(ecName, ecPhone, ecRelationship);

    const optionals = {
      ...(num !== undefined ? { jerseyNumber: num } : {}),
      ...(position.trim() ? { position: position.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(parentContact ? { parentContact } : {}),
      ...(parentContact2 ? { parentContact2 } : {}),
      ...(emergencyContact ? { emergencyContact } : {}),
    };

    if (editPlayer) {
      updatePlayer({ ...editPlayer, firstName: firstName.trim(), lastName: lastName.trim(), status, updatedAt: now, ...optionals });
    } else {
      const playerId = crypto.randomUUID();
      addPlayer({ id: playerId, teamId, firstName: firstName.trim(), lastName: lastName.trim(), status, createdAt: now, updatedAt: now, ...optionals });

      if (team) {
        const playerName = `${firstName.trim()} ${lastName.trim()}`;
        const inviteEmails = isAdultTeam
          ? [email.trim()].filter(Boolean)
          : [email.trim(), p1Email.trim(), p2Email.trim()].filter(Boolean);
        for (const to of inviteEmails) {
          try {
            await sendInviteFn({ to, playerName, teamName: team.name, playerId, teamId });
          } catch (err) {
            console.error('Invite send failed:', err);
          }
        }
      }
    }

    setSaving(false);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={editPlayer ? 'Edit Player' : 'Add Player'}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="First Name" value={firstName} onChange={e => setFirstName(e.target.value)} error={errors.firstName} />
          <Input label="Last Name" value={lastName} onChange={e => setLastName(e.target.value)} error={errors.lastName} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Jersey #" type="number" min="0" value={jerseyNumber} onChange={e => setJerseyNumber(e.target.value)} />
          <Input label="Position" value={position} onChange={e => setPosition(e.target.value)} placeholder="e.g. Forward" />
        </div>
        <Select label="Status" value={status} onChange={e => setStatus(e.target.value as PlayerStatus)} options={statusOptions} />
        <Input
          label={editPlayer ? 'Player Email' : 'Player Email'}
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="player@example.com"
        />

        {!isAdultTeam && (
          <>
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Parent / Guardian Contact</p>
              <p className="text-xs text-gray-400 mb-3">(Required for youth teams)</p>
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

        {errors.contactEmail && (
          <p className="text-xs text-red-600">{errors.contactEmail}</p>
        )}

        {!editPlayer && (
          <p className="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
            An invite email will be sent to all provided email addresses so they can join the team.
          </p>
        )}

        {/* Emergency Contact — always shown */}
        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Emergency Contact</p>
          <p className="text-xs text-gray-400 mb-3">(Optional)</p>
          <div className="space-y-3">
            <Input label="Name" value={ecName} onChange={e => setEcName(e.target.value)} placeholder="Full name" />
            <Input label="Phone" type="tel" value={ecPhone} onChange={e => setEcPhone(e.target.value)} placeholder="Phone number" />
            <Input label="Relationship" value={ecRelationship} onChange={e => setEcRelationship(e.target.value)} placeholder="e.g. Grandmother, Uncle — optional" />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Saving…' : editPlayer ? 'Save Changes' : 'Add Player'}</Button>
        </div>
      </div>
    </Modal>
  );
}
