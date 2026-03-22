import { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
} from 'firebase/auth';
import { db, firebaseConfig } from '@/lib/firebase';
import { Shield, Users, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useTeamStore } from '@/store/useTeamStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { UserProfile, UserRole } from '@/types';

const roleOptions = [
  { value: 'admin', label: 'Admin' },
  { value: 'coach', label: 'Coach' },
  { value: 'player', label: 'Player' },
  { value: 'parent', label: 'Parent' },
];

const roleColors: Record<UserRole, string> = {
  admin: 'bg-purple-100 text-purple-700',
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
  const currentUid = useAuthStore(s => s.user?.uid);

  const teamSelectOptions = [{ value: '', label: 'No team' }, ...teams.map(t => ({ value: t.id, label: t.name }))];

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
    await setDoc(doc(db, 'users', uid), next);
    setUsers(prev => prev.map(u => u.uid === uid ? next : u));
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

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading users…</div>;

  return (
    <div className="p-6">
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

function AddUserModal({ open, onClose, onCreated }: AddUserModalProps) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('coach');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setDisplayName(''); setEmail(''); setPassword(''); setRole('coach'); setError('');
  }

  function handleClose() { reset(); onClose(); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }

    setLoading(true);
    try {
      // Use a secondary app instance so admin stays signed in
      const appName = `admin-create-${Date.now()}`;
      const secondaryApp = initializeApp(firebaseConfig, appName);
      const secondaryAuth = getAuth(secondaryApp);
      try {
        const { user } = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        await updateProfile(user, { displayName });
        await sendEmailVerification(user);
        const profile: UserProfile = {
          uid: user.uid,
          email,
          displayName,
          role,
          createdAt: new Date().toISOString(),
        };
        await setDoc(doc(db, 'users', user.uid), profile);
        onCreated(profile);
        handleClose();
      } finally {
        await deleteApp(secondaryApp);
      }
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add User">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Full Name" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Jane Smith" required />
        <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
        <Input label="Temporary Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" required />
        <Select label="Role" value={role} onChange={e => setRole(e.target.value as UserRole)} options={roleOptions} />
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <p className="text-xs text-gray-400">A verification email will be sent to the user. You can assign their team from the users table.</p>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={handleClose}>Cancel</Button>
          <Button type="submit" disabled={loading}>{loading ? 'Creating…' : 'Create User'}</Button>
        </div>
      </form>
    </Modal>
  );
}
