import { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { Shield, Users, Plus, Trash2, Pencil, Check, X, Copy, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useTeamStore } from '@/store/useTeamStore';
import { useLeagueStore } from '@/store/useLeagueStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { UserProfile, UserRole } from '@/types';

const roleOptions = [
  { value: 'admin', label: 'Admin' },
  { value: 'league_manager', label: 'League Manager' },
  { value: 'coach', label: 'Coach' },
  { value: 'player', label: 'Player' },
  { value: 'parent', label: 'Parent' },
];

const roleColors: Record<UserRole, string> = {
  admin: 'bg-purple-100 text-purple-700',
  league_manager: 'bg-indigo-100 text-indigo-700',
  coach: 'bg-blue-100 text-blue-700',
  player: 'bg-green-100 text-green-700',
  parent: 'bg-orange-100 text-orange-700',
};

export function UsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const [editingNameUid, setEditingNameUid] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');
  const teams = useTeamStore(s => s.teams);
  const leagues = useLeagueStore(s => s.leagues);
  const currentUid = useAuthStore(s => s.user?.uid);

  const teamSelectOptions = [{ value: '', label: 'No team' }, ...teams.map(t => ({ value: t.id, label: t.name }))];
  const leagueSelectOptions = [{ value: '', label: 'No league' }, ...leagues.map(l => ({ value: l.id, label: l.name }))];

  useEffect(() => {
    getDocs(collection(db, 'users')).then(snap => {
      setUsers(snap.docs.map(d => d.data() as UserProfile));
      setLoading(false);
    });
  }, []);

  async function updateUser(uid: string, patch: Partial<UserProfile>) {
    const user = users.find(u => u.uid === uid);
    if (!user) return;
    const next = { ...user, ...patch };
    // strip undefined teamId
    if (!next.teamId) delete next.teamId;
    try {
      await setDoc(doc(db, 'users', uid), next);
      setUsers(prev => prev.map(u => u.uid === uid ? next : u));
    } catch (err) {
      console.error('Failed to update user:', err);
      alert(`Failed to save: ${(err as Error).message}`);
    }
  }

  async function handleDeleteUser(user: UserProfile) {
    await deleteDoc(doc(db, 'users', user.uid));
    setUsers(prev => prev.filter(u => u.uid !== user.uid));
    setDeleteTarget(null);
  }

  function startEditName(user: UserProfile) {
    setEditingNameUid(user.uid);
    setEditingNameValue(user.displayName);
  }

  async function commitEditName(uid: string) {
    const trimmed = editingNameValue.trim();
    if (trimmed) await updateUser(uid, { displayName: trimmed });
    setEditingNameUid(null);
  }

  if (loading) return <div className="p-4 sm:p-6 text-sm text-gray-400">Loading users…</div>;

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-gray-500" />
          <p className="text-sm text-gray-500">{users.length} registered {users.length === 1 ? 'user' : 'users'}</p>
        </div>
        <Button onClick={() => setAddOpen(true)}><Plus size={16} /> Add User</Button>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">User</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Role</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Team</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">League</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase w-16"></th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => {
              const isSelf = user.uid === currentUid;
              const team = teams.find(t => t.id === user.teamId);
              const isEditingName = editingNameUid === user.uid;
              return (
                <tr key={user.uid} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                        {user.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        {isEditingName ? (
                          <div className="flex items-center gap-1">
                            <input
                              name="display-name"
                              autoComplete="off"
                              className="border border-gray-300 rounded px-2 py-0.5 text-sm w-36 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              value={editingNameValue}
                              onChange={e => setEditingNameValue(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') commitEditName(user.uid); if (e.key === 'Escape') setEditingNameUid(null); }}
                              autoFocus
                            />
                            <button onClick={() => commitEditName(user.uid)} className="text-green-600 hover:text-green-800"><Check size={14} /></button>
                            <button onClick={() => setEditingNameUid(null)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 group">
                            <p className="font-medium text-gray-900">{user.displayName} {isSelf && <span className="text-xs text-gray-400">(you)</span>}</p>
                            <button onClick={() => startEditName(user)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-opacity"><Pencil size={12} /></button>
                          </div>
                        )}
                        <p className="text-xs text-gray-500">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {isSelf ? (
                      <Badge className={roleColors[user.role]}>
                        <Shield size={10} className="mr-1" /> {user.role}
                      </Badge>
                    ) : (
                      <Select
                        value={user.role}
                        onChange={e => updateUser(user.uid, { role: e.target.value as UserRole })}
                        options={roleOptions}
                        className="w-32 text-xs"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isSelf ? (
                      <span className="text-gray-600 text-sm">{team?.name ?? '—'}</span>
                    ) : (
                      <Select
                        value={user.teamId ?? ''}
                        onChange={e => updateUser(user.uid, { teamId: e.target.value || undefined })}
                        options={teamSelectOptions}
                        className="w-40 text-xs"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isSelf ? (
                      <span className="text-gray-600 text-sm">{leagues.find(l => l.id === user.leagueId)?.name ?? '—'}</span>
                    ) : (
                      <Select
                        value={user.leagueId ?? ''}
                        onChange={e => updateUser(user.uid, { leagueId: e.target.value || undefined })}
                        options={leagueSelectOptions}
                        className="w-40 text-xs"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!isSelf && (
                      <button
                        onClick={() => setDeleteTarget(user)}
                        className="text-gray-300 hover:text-red-500 transition-colors"
                        title="Delete user"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <AddUserModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={user => setUsers(prev => [...prev, user])}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleDeleteUser(deleteTarget)}
        title="Delete User"
        message={`Remove ${deleteTarget?.displayName} from the app? Their login account will still exist but they won't have access.`}
      />
    </div>
  );
}

interface AddUserModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (user: UserProfile) => void;
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function AddUserModal({ open, onClose, onCreated }: AddUserModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [role, setRole] = useState<UserRole>('coach');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setFirstName(''); setLastName(''); setEmail(''); setTempPassword(''); setRole('coach');
    setError(''); setCreatedPassword(null); setCopied(false);
  }

  function handleClose() { reset(); onClose(); }

  function handleAutoGenerate() {
    setTempPassword(generatePassword());
  }

  function handleCopyPassword() {
    navigator.clipboard.writeText(tempPassword).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!firstName.trim()) { setError('First name is required'); return; }
    if (!lastName.trim()) { setError('Last name is required'); return; }
    if (tempPassword.length < 8) { setError('Temporary password must be at least 8 characters'); return; }

    setLoading(true);
    const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();
    try {
      const fn = httpsCallable<
        { email: string; displayName: string; role: string; tempPassword: string },
        { uid: string }
      >(functions, 'createUserByAdmin');
      const result = await fn({ email, displayName, role, tempPassword });
      const profile: UserProfile = {
        uid: result.data.uid,
        email,
        displayName,
        role,
        mustChangePassword: true,
        createdAt: new Date().toISOString(),
      };
      onCreated(profile);
      setCreatedPassword(tempPassword);
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message ?? 'Something went wrong. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleCopyCreatedPassword() {
    if (!createdPassword) return;
    navigator.clipboard.writeText(createdPassword).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (createdPassword) {
    return (
      <Modal open={open} onClose={handleClose} title="User Created">
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
            <p className="text-sm font-medium text-green-800 mb-2">
              User created successfully. Share this temporary password with them:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white border border-green-200 rounded px-3 py-1.5 text-sm font-mono text-green-900 select-all">
                {createdPassword}
              </code>
              <button
                type="button"
                onClick={handleCopyCreatedPassword}
                className="p-1.5 rounded hover:bg-green-100 text-green-700 transition-colors"
                title="Copy password"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <p className="text-xs text-green-600 mt-2">
              They will be asked to set a new password when they first sign in.
            </p>
          </div>
          <div className="flex justify-end pt-2">
            <Button onClick={handleClose}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add User">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="First Name"
            name="given-name"
            autoComplete="given-name"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            placeholder="Jane"
            required
          />
          <Input
            label="Last Name"
            name="family-name"
            autoComplete="family-name"
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            placeholder="Smith"
            required
          />
        </div>
        <Input label="Email" type="email" name="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Temporary Password</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                name="temp-password"
                autoComplete="off"
                value={tempPassword}
                onChange={e => setTempPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                minLength={8}
                className="w-full px-3 py-2 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10 font-mono"
              />
              {tempPassword && (
                <button
                  type="button"
                  onClick={handleCopyPassword}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                  title="Copy password"
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </button>
              )}
            </div>
            <Button type="button" variant="secondary" onClick={handleAutoGenerate} className="shrink-0 flex items-center gap-1.5 px-3">
              <RefreshCw size={14} />
              Auto-generate
            </Button>
          </div>
        </div>
        <Select label="Role" value={role} onChange={e => setRole(e.target.value as UserRole)} options={roleOptions.filter(o => o.value !== 'admin')} />
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <p className="text-xs text-gray-400">The user will be prompted to set a new password when they first sign in.</p>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={handleClose}>Cancel</Button>
          <Button type="submit" disabled={loading}>{loading ? 'Creating…' : 'Create User'}</Button>
        </div>
      </form>
    </Modal>
  );
}
