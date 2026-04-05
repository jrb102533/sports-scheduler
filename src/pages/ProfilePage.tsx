import { useState } from 'react';
import { User, Shield, Star, Link, Pencil } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAuthStore, getMemberships } from '@/store/useAuthStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useLeagueStore } from '@/store/useLeagueStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { ROLE_DEFINITIONS, RoleCardPicker } from '@/components/auth/RoleCardPicker';
import type { RoleMembership, UserRole } from '@/types';

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
  const players = usePlayerStore(s => s.players);
  const existingParts = (profile?.displayName ?? '').trim().split(/\s+/);
  const [firstName, setFirstName] = useState(existingParts.slice(0, -1).join(' ') || existingParts[0] || '');
  const [lastName, setLastName] = useState(existingParts.length > 1 ? existingParts[existingParts.length - 1] : '');
  const [firstNameTouched, setFirstNameTouched] = useState(false);
  const [lastNameTouched, setLastNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingRoles, setEditingRoles] = useState(false);
  const [editPrimary, setEditPrimary] = useState<UserRole>('coach');
  const [editAdditional, setEditAdditional] = useState<UserRole[]>([]);
  const [rolesSaving, setRolesSaving] = useState(false);

  const team = teams.find(t => t.id === profile?.teamId);
  const memberships = getMemberships(profile ?? null);
  const activeIndex = profile?.activeContext ?? 0;

  const isPlayerOrParent = profile?.role === 'player' || profile?.role === 'parent';
  const canEditRoles = profile?.role === 'admin';
  const linkedPlayer = profile?.playerId ? players.find(p => p.id === profile.playerId) : undefined;
  const linkedTeam = linkedPlayer
    ? teams.find(t => t.id === linkedPlayer.teamId)
    : profile?.teamId
    ? teams.find(t => t.id === profile.teamId)
    : undefined;

  function openRoleEdit() {
    const primary = memberships.find(m => m.isPrimary) ?? memberships[0];
    setEditPrimary(primary?.role ?? 'coach');
    setEditAdditional(memberships.filter(m => !m.isPrimary).map(m => m.role));
    setEditingRoles(true);
  }

  async function handleSaveRoles() {
    if (!profile) return;
    setRolesSaving(true);
    const newMemberships: RoleMembership[] = [
      { role: editPrimary, isPrimary: true },
      ...editAdditional.map(r => ({ role: r })),
    ];
    await updateProfile({ memberships: newMemberships, role: editPrimary });
    setEditingRoles(false);
    setRolesSaving(false);
  }

  async function handleSetPrimary(index: number) {
    if (!profile) return;
    const reordered = [
      { ...memberships[index], isPrimary: true },
      ...memberships.filter((_, i) => i !== index).map(m => ({ ...m, isPrimary: false })),
    ];
    await updateProfile({ memberships: reordered, activeContext: 0 });
  }

  const firstNameError = firstNameTouched && firstName.trim().length === 0 ? 'First name is required' : undefined;
  const lastNameError = lastNameTouched && lastName.trim().length === 0 ? 'Last name is required' : undefined;

  async function handleSave() {
    if (firstName.trim().length === 0 || lastName.trim().length === 0) {
      setFirstNameTouched(true);
      setLastNameTouched(true);
      return;
    }
    setSaving(true);
    const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();
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
              {(() => {
                const def = ROLE_DEFINITIONS.find(d => d.role === profile.role);
                const PrimaryIcon = def?.icon ?? Shield;
                const primaryTitle = def?.title ?? (profile.role.charAt(0).toUpperCase() + profile.role.slice(1));
                return (
                  <Badge className={roleColors[profile.role]}>
                    <PrimaryIcon size={11} className="mr-1" /> {primaryTitle}
                  </Badge>
                );
              })()}
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
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="First Name"
            name="given-name"
            autoComplete="given-name"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            onBlur={() => setFirstNameTouched(true)}
            error={firstNameError}
          />
          <Input
            label="Last Name"
            name="family-name"
            autoComplete="family-name"
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            onBlur={() => setLastNameTouched(true)}
            error={lastNameError}
          />
        </div>
        <Input label="Email" name="email" autoComplete="email" value={profile.email} disabled className="opacity-60 cursor-not-allowed" />
        <div className="flex gap-3">
          <Button onClick={handleSave} disabled={saving || `${firstName.trim()} ${lastName.trim()}`.trim() === profile.displayName}>
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
          </Button>
        </div>
      </Card>

      {memberships.length > 0 && (
        <Card className="p-4 sm:p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Shield size={16} /> My Roles</h3>
            {canEditRoles && !editingRoles && (
              <button
                onClick={openRoleEdit}
                className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
              >
                <Pencil size={12} /> Edit
              </button>
            )}
          </div>
          {!canEditRoles && !editingRoles && (
            <p className="text-xs text-gray-400">Roles are assigned by your league administrator.</p>
          )}

          {editingRoles ? (
            <div className="space-y-4">
              <RoleCardPicker
                primaryRole={editPrimary}
                additionalRoles={editAdditional}
                onPrimaryChange={r => {
                  setEditPrimary(r);
                  setEditAdditional(prev => prev.filter(x => x !== r));
                }}
                onAddSecondary={r => setEditAdditional(prev => prev.includes(r) || r === editPrimary ? prev : [...prev, r])}
                onRemoveSecondary={r => setEditAdditional(prev => prev.filter(x => x !== r))}
              />
              <div className="flex gap-3 pt-1">
                <Button onClick={handleSaveRoles} disabled={rolesSaving}>
                  {rolesSaving ? 'Saving…' : 'Save Roles'}
                </Button>
                <Button variant="secondary" onClick={() => setEditingRoles(false)} disabled={rolesSaving}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {memberships.map((m, i) => {
                const memberTeam = m.teamId ? teams.find(t => t.id === m.teamId) : undefined;
                const memberLeague = m.leagueId ? leagues.find(l => l.id === m.leagueId) : undefined;
                const contextLabel = membershipContextLabel(m, memberTeam?.name, memberLeague?.name);
                const isActive = i === activeIndex;
                const roleDef = ROLE_DEFINITIONS.find(d => d.role === m.role);
                const RoleIcon = roleDef?.icon ?? Shield;
                const roleTitle = roleDef?.title ?? m.role.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
                return (
                  <li
                    key={i}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border transition-colors ${isActive ? 'border-orange-300 bg-orange-50' : 'border-gray-100 bg-gray-50'}`}
                  >
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                        isActive
                          ? 'bg-[#f97316] text-white'
                          : (roleColors[m.role] ?? 'bg-gray-100 text-gray-700')
                      }`}
                    >
                      <RoleIcon size={11} />
                      {roleTitle}
                    </span>

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
          )}
        </Card>
      )}

      {isPlayerOrParent && (
        <Card className="p-4 sm:p-6 space-y-3">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Link size={16} /> Team Connection</h3>
          {linkedPlayer && linkedTeam ? (
            <p className="text-sm text-gray-700">
              <span className="text-green-600 font-semibold">&#10003; Linked to</span>{' '}
              <span className="font-medium">{linkedPlayer.firstName} {linkedPlayer.lastName}</span>
              {' '}on{' '}
              <span className="font-medium">{linkedTeam.name}</span>
            </p>
          ) : linkedTeam ? (
            <p className="text-sm text-gray-700">
              <span className="text-green-600 font-semibold">&#10003; Connected to</span>{' '}
              <span className="font-medium">{linkedTeam.name}</span>
            </p>
          ) : (
            <p className="text-sm text-gray-400">
              Not yet linked to a team — ask your coach to send an invite to this email address:{' '}
              <span className="font-medium text-gray-600">{profile.email}</span>
            </p>
          )}
        </Card>
      )}

      <Card className="p-4 sm:p-6">
        <h3 className="font-semibold text-gray-900 mb-3">Account</h3>
        <Button variant="danger" onClick={logout}>Sign Out</Button>
      </Card>
    </div>
  );
}
