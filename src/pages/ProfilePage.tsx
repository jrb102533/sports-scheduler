import { useState } from 'react';
import { User, Shield } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAuthStore } from '@/store/useAuthStore';
import { useTeamStore } from '@/store/useTeamStore';

const roleColors: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700',
  coach: 'bg-blue-100 text-blue-700',
  player: 'bg-green-100 text-green-700',
  parent: 'bg-orange-100 text-orange-700',
};

export function ProfilePage() {
  const { profile, updateProfile, logout } = useAuthStore();
  const teams = useTeamStore(s => s.teams);
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const team = teams.find(t => t.id === profile?.teamId);

  async function handleSave() {
    setSaving(true);
    await updateProfile({ displayName });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!profile) return null;

  return (
    <div className="p-6 max-w-xl space-y-6">
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-xl">
            {profile.displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">{profile.displayName}</h2>
            <p className="text-sm text-gray-500">{profile.email}</p>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={roleColors[profile.role]}>
                <Shield size={11} className="mr-1" /> {profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}
              </Badge>
              {team && (
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: team.color }} />
                  {team.name}
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><User size={16} /> Edit Profile</h3>
        <Input label="Display Name" value={displayName} onChange={e => setDisplayName(e.target.value)} />
        <Input label="Email" value={profile.email} disabled className="opacity-60 cursor-not-allowed" />
        <div className="flex gap-3">
          <Button onClick={handleSave} disabled={saving || displayName === profile.displayName}>
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold text-gray-900 mb-3">Account</h3>
        <Button variant="danger" onClick={logout}>Sign Out</Button>
      </Card>
    </div>
  );
}
