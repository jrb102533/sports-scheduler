import { useEffect, useMemo, useState } from 'react';
import { User, Shield, Star, Link, ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAuthStore, getMemberships, getActiveMembership } from '@/store/useAuthStore';
import { useTeamStore } from '@/store/useTeamStore';
import { useLeagueStore } from '@/store/useLeagueStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { ROLE_DEFINITIONS } from '@/components/auth/RoleCardPicker';
import type { RoleMembership, Team, League, Player } from '@/types';

const roleColors: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700',
  league_manager: 'bg-indigo-100 text-indigo-700',
  coach: 'bg-blue-100 text-blue-700',
  player: 'bg-green-100 text-green-700',
  parent: 'bg-orange-100 text-orange-700',
};

function membershipContextLabel(m: RoleMembership, teamName?: string, leagueName?: string, childName?: string): string | null {
  if (m.role === 'admin') return 'Platform admin';
  if (m.role === 'league_manager' && leagueName) return leagueName;
  if (m.role === 'parent' && childName) return childName;
  if (teamName) return teamName;
  return null;
}

const ROLE_ORDER: Record<string, number> = {
  admin: 0,
  league_manager: 1,
  coach: 2,
  parent: 3,
  player: 4,
};

const COLLAPSED_LIMIT = 5;

export function ProfilePage() {
  const profile = useAuthStore(s => s.profile);
  const updateProfile = useAuthStore(s => s.updateProfile);
  const logout = useAuthStore(s => s.logout);
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
  // Track the last value we successfully saved. The dirty check compares against
  // this, not profile.displayName, because profile is refreshed via an async
  // onSnapshot listener and can lag (or race) a same-session save. See #475.
  const [savedDisplayName, setSavedDisplayName] = useState(profile?.displayName ?? '');

  // useState initializers run once. When the profile arrives via onSnapshot
  // after the first render (auth still loading at mount time), the firstName /
  // lastName inputs would otherwise stay locked at '' — triggering the empty-
  // field validation banner the moment the user clicks into a field. Sync
  // from displayName whenever it arrives, but only if the user hasn't started
  // editing (touched) so we don't clobber an in-progress edit.
  useEffect(() => {
    if (firstNameTouched || lastNameTouched) return;
    const parts = (profile?.displayName ?? '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return;
    const next = {
      first: parts.slice(0, -1).join(' ') || parts[0] || '',
      last: parts.length > 1 ? parts[parts.length - 1] : '',
    };
    if (next.first !== firstName) setFirstName(next.first);
    if (next.last !== lastName) setLastName(next.last);
    if (profile?.displayName && profile.displayName !== savedDisplayName) {
      setSavedDisplayName(profile.displayName);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.displayName]);

  const memberships = getMemberships(profile ?? null);
  const activeIndex = profile?.activeContext ?? 0;
  const activeMembershipTeamId = getActiveMembership(profile ?? null)?.teamId;
  const team = teams.find(t => t.id === activeMembershipTeamId);

  const isPlayerOrParent = profile?.role === 'player' || profile?.role === 'parent';
  const linkedPlayer = profile?.playerId ? players.find(p => p.id === profile.playerId) : undefined;
  const linkedTeam = linkedPlayer
    ? teams.find(t => t.id === linkedPlayer.teamId)
    : activeMembershipTeamId
    ? teams.find(t => t.id === activeMembershipTeamId)
    : undefined;

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
    setSavedDisplayName(displayName);
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
            {(profile.displayName || '?').charAt(0).toUpperCase()}
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
          <Button onClick={handleSave} disabled={saving || `${firstName.trim()} ${lastName.trim()}`.trim() === savedDisplayName}>
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
          </Button>
        </div>
      </Card>

      {memberships.length > 0 && (
        <MembershipsCard
          memberships={memberships}
          activeIndex={activeIndex}
          teams={teams}
          leagues={leagues}
          players={players}
          onSetPrimary={handleSetPrimary}
        />
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

interface DecoratedMembership {
  m: RoleMembership;
  originalIndex: number;
  contextName: string | null;
  isOrphan: boolean;
}

interface MembershipsCardProps {
  memberships: RoleMembership[];
  activeIndex: number;
  teams: Team[];
  leagues: League[];
  players: Player[];
  onSetPrimary: (originalIndex: number) => void;
}

function MembershipsCard({ memberships, activeIndex, teams, leagues, players, onSetPrimary }: MembershipsCardProps) {
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());

  const { groups, orphanCount } = useMemo(() => {
    const decorated: DecoratedMembership[] = memberships.map((m, originalIndex) => {
      const memberTeam = m.teamId ? teams.find(t => t.id === m.teamId) : undefined;
      const memberLeague = m.leagueId ? leagues.find(l => l.id === m.leagueId) : undefined;
      const memberChild = m.playerId ? players.find(p => p.id === m.playerId) : undefined;
      const childName = memberChild ? `${memberChild.firstName} ${memberChild.lastName}` : undefined;
      const contextName = membershipContextLabel(m, memberTeam?.name, memberLeague?.name, childName);

      // Orphan = the membership references an entity (team/league/player) that
      // we can't resolve in the user's loaded data. Admin memberships have no
      // contextual ID and are never orphaned.
      const isOrphan =
        m.role !== 'admin' &&
        ((!!m.teamId && !memberTeam) ||
         (!!m.leagueId && !memberLeague) ||
         (!!m.playerId && !memberChild));

      return { m, originalIndex, contextName, isOrphan };
    });

    const visible = decorated.filter(d => !d.isOrphan);
    const orphanCount = decorated.length - visible.length;

    const byRole = new Map<string, DecoratedMembership[]>();
    for (const d of visible) {
      const list = byRole.get(d.m.role) ?? [];
      list.push(d);
      byRole.set(d.m.role, list);
    }
    for (const list of byRole.values()) {
      list.sort((a, b) => {
        if (a.m.isPrimary && !b.m.isPrimary) return -1;
        if (!a.m.isPrimary && b.m.isPrimary) return 1;
        return (a.contextName ?? '').localeCompare(b.contextName ?? '');
      });
    }

    const groups = [...byRole.entries()].sort(
      ([a], [b]) => (ROLE_ORDER[a] ?? 99) - (ROLE_ORDER[b] ?? 99),
    );

    return { groups, orphanCount };
  }, [memberships, teams, leagues, players]);

  function toggleExpanded(role: string) {
    setExpandedRoles(prev => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  return (
    <Card className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Shield size={16} /> My Roles</h3>
        {orphanCount > 0 && (
          <span className="text-xs text-gray-400" title="Memberships referencing teams/leagues you no longer have access to">
            {orphanCount} hidden
          </span>
        )}
      </div>

      {groups.map(([role, items]) => {
        const roleDef = ROLE_DEFINITIONS.find(d => d.role === role);
        const RoleIcon = roleDef?.icon ?? Shield;
        const roleTitle = roleDef?.title ?? role.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
        const isExpanded = expandedRoles.has(role);
        const visible = isExpanded ? items : items.slice(0, COLLAPSED_LIMIT);
        const hiddenCount = items.length - visible.length;

        return (
          <div key={role} className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <RoleIcon size={12} />
              <span>{roleTitle}</span>
              <span className="text-gray-400 normal-case font-normal">· {items.length}</span>
            </div>
            <ul className="space-y-1.5">
              {visible.map(({ m, originalIndex, contextName }) => {
                const isActive = originalIndex === activeIndex;
                return (
                  <li
                    key={originalIndex}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 border transition-colors ${isActive ? 'border-orange-300 bg-orange-50' : 'border-gray-100 bg-gray-50'}`}
                  >
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        isActive
                          ? 'bg-[#f97316] text-white'
                          : (roleColors[m.role] ?? 'bg-gray-100 text-gray-700')
                      }`}
                    >
                      <RoleIcon size={10} />
                      {roleTitle}
                    </span>
                    {contextName && (
                      <span className="text-sm text-gray-700 truncate flex-1">{contextName}</span>
                    )}
                    <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                      {isActive && <span className="text-xs font-medium text-orange-600">Active</span>}
                      {m.isPrimary ? (
                        <Star size={13} className="text-yellow-500 fill-yellow-400" aria-label="Primary" />
                      ) : (
                        <button
                          onClick={() => onSetPrimary(originalIndex)}
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
            {(hiddenCount > 0 || (isExpanded && items.length > COLLAPSED_LIMIT)) && (
              <button
                onClick={() => toggleExpanded(role)}
                className="text-xs text-blue-600 font-medium hover:underline inline-flex items-center gap-1"
              >
                {isExpanded ? 'Show less' : `Show ${hiddenCount} more`}
                <ChevronDown size={12} className={isExpanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
            )}
          </div>
        );
      })}
    </Card>
  );
}
