import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { usePlayerStore } from '@/store/usePlayerStore';
import { PLAYER_STATUS_LABELS } from '@/constants';
import type { Player, PlayerStatus } from '@/types';

interface PlayerFormProps {
  open: boolean;
  onClose: () => void;
  teamId: string;
  editPlayer?: Player;
}

const statusOptions = Object.entries(PLAYER_STATUS_LABELS).map(([value, label]) => ({ value, label }));

export function PlayerForm({ open, onClose, teamId, editPlayer }: PlayerFormProps) {
  const { addPlayer, updatePlayer } = usePlayerStore();
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

  function validate() {
    const e: Record<string, string> = {};
    if (!firstName.trim()) e.firstName = 'First name is required';
    if (!lastName.trim()) e.lastName = 'Last name is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;
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
      addPlayer({ id: crypto.randomUUID(), teamId, firstName: firstName.trim(), lastName: lastName.trim(), status, createdAt: now, updatedAt: now, ...optionals });
    }
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
        <Input label="Player Email (optional)" type="email" value={email} onChange={e => setEmail(e.target.value)} />

        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Parent / Guardian Contact</p>
          <div className="space-y-3">
            <Input label="Parent Name" value={parentName} onChange={e => setParentName(e.target.value)} placeholder="e.g. Jane Smith" />
            <Input label="Parent Phone" type="tel" value={parentPhone} onChange={e => setParentPhone(e.target.value)} placeholder="e.g. 555-123-4567" />
            <Input label="Parent Email" type="email" value={parentEmail} onChange={e => setParentEmail(e.target.value)} placeholder="e.g. jane@example.com" />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>{editPlayer ? 'Save Changes' : 'Add Player'}</Button>
        </div>
      </div>
    </Modal>
  );
}
