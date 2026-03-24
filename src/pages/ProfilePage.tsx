import { useState } from 'react';
import { User, Shield, Star } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAuthStore, getMemberships } from '@/store/useAuthStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useLeagueStore } from '@/store/useLeagueStore';
import type { RoleMembership } from '@/types';

const roleColors: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700',
  league_manager: 'bg-indigo-100 text-indigo-700',
  coach: 'bg-blue-100 text-blue-700',
  player: 'bg-green-100 text-green-700',
  parent: 'bg-orange-100 text-orange-700',
};

function membershipContextLabel(m: RoleMembership, teamName?: string, leagueName?: string): string | null {
  if (m.role === 'league_manager' && leagueName) return leagueName;
  if (teamName) return teamName;
  if (m.teamId) return m.teamId;
  if (m.leagueId) return m.leagueId;
  return null;
}

export function ProfilePage() {
  const { profile, updateProfile, logout } = useAuthStore();
  const teams = useTeamStore(s => s.teams);
  const leagues = useLeagueStore(s => s.leagues);
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const team = teams.find(t => t.id === profile?.teamId);
  const memberships = getMemberships(profile ?? null);
  const activeIndex = profile?.activeContext ?? 0;

  async function handleSetPrimary(index: number) {
    if (!profile) return;
    const reordered = [
      { ...memberships[index], isPrimary: true },
      ...memberships.filter((_, i) => i !== index).map(m => ({ ...m, isPrimary: false })),
    ];
    await updateProfile({ memberships: reordered, activeContext: 0 });
  }

  async function handleSave() {
    setSaving(true);
    await updateProfile({ displayName });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!profile) return null;

  return (
    <div className="p-4 sm:p-6 max-w-xl space-y-6">
      <Card className="p-4 sm:p-6 space-y-4">
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

      <Card className="p-4 sm:p-6 space-y-4">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><User size={16} /> Edit Profile</h3>
        <Input label="Display Name" value={displayName} onChange={e => setDisplayName(e.target.value)} />
        <Input label="Email" value={profile.email} disabled className="opacity-60 cursor-not-allowed" />
        <div className="flex gap-3">
          <Button onClick={handleSave} disabled={saving || displayName === profile.displayName}>
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
          </Button>
        </div>
      </Card>

      {memberships.length > 0 && (
        <Card className="p-4 sm:p-6 space-y-3">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Shield size={16} /> My Roles</h3>
          <ul className="space-y-2">
            {memberships.map((m, i) => {
              const memberTeam = m.teamId ? teams.find(t => t.id === m.teamId) : undefined;
              const memberLeague = m.leagueId ? leagues.find(l => l.id === m.leagueId) : undefined;
              const contextLabel = membershipContextLabel(m, memberTeam?.name, memberLeague?.name);
              const isActive = i === activeIndex;
              return (
                <li
                  key={i}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border ${isActive ? 'border-orange-300 bg-orange-50' : 'border-gray-100 bg-gray-50'}`}
                >
                  <Badge className={roleColors[m.role] ?? 'bg-gray-100 text-gray-700'}>
                    <Shield size={11} className="mr-1" />
                    {m.role.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </Badge>
                  {contextLabel && (
                    <span className="text-sm text-gray-600 truncate flex-1">{contextLabel}</span>
                  )}
                  <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                    {isActive && (
                      <span className="text-xs font-medium text-orange-600">Active</span>
                    )}
                    {m.isPrimary && (
                      <Star size={13} className="text-yellow-500 fill-yellow-400" aria-label="Primary" />
                    )}
                    {!m.isPrimary && (
                      <button
                        onClick={() => handleSetPrimary(i)}
                        className="text-xs text-gray-400 hover:text-yellow-500 transition-colors"
                        title="Set as primary"
                      >
                        <Star size={13} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card className="p-4 sm:p-6">
        <h3 className="font-semibold text-gray-900 mb-3">Account</h3>
        <Button variant="danger" onClick={logout}>Sign Out</Button>
      </Card>
    </div>
  );
}
