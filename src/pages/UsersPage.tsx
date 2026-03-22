import { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Shield, Users } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
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

const teamOptions = (teams: ReturnType<typeof useTeamStore.getState>['teams']) =>
  [{ value: '', label: 'No team' }, ...teams.map(t => ({ value: t.id, label: t.name }))];

export function UsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const teams = useTeamStore(s => s.teams);
  const currentUid = useAuthStore(s => s.user?.uid);

  useEffect(() => {
    getDocs(collection(db, 'users')).then(snap => {
      setUsers(snap.docs.map(d => d.data() as UserProfile));
      setLoading(false);
    });
  }, []);

  async function updateUser(uid: string, patch: Partial<UserProfile>) {
    const user = users.find(u => u.uid === uid);
    if (!user) return;
    const updated = { ...user, ...patch };
    await setDoc(doc(db, 'users', uid), updated);
    setUsers(prev => prev.map(u => u.uid === uid ? updated : u));
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-400">Loading users…</div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Users size={18} className="text-gray-500" />
        <p className="text-sm text-gray-500">{users.length} registered {users.length === 1 ? 'user' : 'users'}</p>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">User</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Role</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Team</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => {
              const isSelf = user.uid === currentUid;
              const team = teams.find(t => t.id === user.teamId);
              return (
                <tr key={user.uid} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                        {user.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{user.displayName} {isSelf && <span className="text-xs text-gray-400">(you)</span>}</p>
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
                        options={teamOptions(teams)}
                        className="w-40 text-xs"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
