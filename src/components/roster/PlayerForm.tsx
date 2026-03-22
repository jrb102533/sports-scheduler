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
import type { Player, PlayerStatus } from '@/types';

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

export function PlayerForm({ open, onClose, teamId, editPlayer }: PlayerFormProps) {
  const { addPlayer, updatePlayer } = usePlayerStore();
  const team = useTeamStore(s => s.teams.find(t => t.id === teamId));

  const [firstName, setFirstName] = useState(editPlayer?.firstName ?? '');
  const [lastName, setLastName] = useState(editPlayer?.lastName ?? '');
  const [jerseyNumber, setJerseyNumber] = useState(editPlayer?.jerseyNumber?.toString() ?? '');
  const [position, setPosition] = useState(editPlayer?.position ?? '');
  const [status, setStatus] = useState<PlayerStatus>(editPlayer?.status ?? 'active');
  const [email, setEmail] = useState(editPlayer?.email ?? '');
  const [parentName, setParentName] = useState(editPlayer?.parentContact?.parentName ?? '');
  const [parentPhone, setParentPhone] = useState(editPlayer?.parentContact?.parentPhone ?? '');
  const [parentEmail, setParentEmail] = useState(editPlayer?.parentContact?.parentEmail ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  function validate() {
    const e: Record<string, string> = {};
    if (!firstName.trim()) e.firstName = 'First name is required';
    if (!lastName.trim()) e.lastName = 'Last name is required';
    if (!editPlayer && !email.trim() && !parentEmail.trim()) {
      e.email = 'A player or parent email is required to send an invite';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const num = jerseyNumber ? parseInt(jerseyNumber) : undefined;
    const parentContact = parentName.trim() || parentPhone.trim() || parentEmail.trim()
      ? { parentName: parentName.trim(), parentPhone: parentPhone.trim(), ...(parentEmail.trim() ? { parentEmail: parentEmail.trim() } : {}) }
      : undefined;
    const optionals = {
      ...(num !== undefined ? { jerseyNumber: num } : {}),
      ...(position.trim() ? { position: position.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(parentContact ? { parentContact } : {}),
    };

    if (editPlayer) {
      updatePlayer({ ...editPlayer, firstName: firstName.trim(), lastName: lastName.trim(), status, updatedAt: now, ...optionals });
    } else {
      const playerId = crypto.randomUUID();
      addPlayer({ id: playerId, teamId, firstName: firstName.trim(), lastName: lastName.trim(), status, createdAt: now, updatedAt: now, ...optionals });

      const contactEmail = email.trim() || parentEmail.trim();
      if (contactEmail && team) {
        try {
          await sendInviteFn({
            to: contactEmail,
            playerName: `${firstName.trim()} ${lastName.trim()}`,
            teamName: team.name,
            playerId,
            teamId,
          });
        } catch (err) {
          // Non-fatal: player was added, invite email failed silently
          console.error('Invite send failed:', err);
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
          label={editPlayer ? 'Player Email' : 'Player Email *'}
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          error={errors.email}
          placeholder="player@example.com"
        />

        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Parent / Guardian Contact</p>
          <div className="space-y-3">
            <Input label="Parent Name" value={parentName} onChange={e => setParentName(e.target.value)} placeholder="e.g. Jane Smith" />
            <Input label="Parent Phone" type="tel" value={parentPhone} onChange={e => setParentPhone(e.target.value)} placeholder="e.g. 555-123-4567" />
            <Input
              label={editPlayer ? 'Parent Email' : 'Parent Email *'}
              type="email"
              value={parentEmail}
              onChange={e => setParentEmail(e.target.value)}
              placeholder="e.g. jane@example.com"
            />
          </div>
        </div>

        {!editPlayer && (
          <p className="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
            * An invite email will be sent to the player or parent email so they can join the team.
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Saving…' : editPlayer ? 'Save Changes' : 'Add Player'}</Button>
        </div>
      </div>
    </Modal>
  );
}
