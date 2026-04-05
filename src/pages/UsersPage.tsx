import { useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc, arrayUnion, arrayRemove, writeBatch } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import {
  Users, Plus, Trash2, Check, X, Copy, RefreshCw, KeyRound,
  ChevronRight, Search, Star, Pencil,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { SlideOver } from '@/components/ui/SlideOver';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useTeamStore } from '@/store/useTeamStore';
import { useLeagueStore } from '@/store/useLeagueStore';
import { useAuthStore } from '@/store/useAuthStore';
import {
  syncLegacyScalars,
  addMembership,
  removeMembership,
  setPrimaryMembership,
  ROLE_LABELS,
  ROLE_COLORS,
  ROLE_AVATAR_COLORS,
} from '@/lib/membershipUtils';
import type { UserProfile, UserRole, RoleMembership } from '@/types';

const ALL_ROLES: UserRole[] = ['admin', 'coach', 'league_manager', 'player', 'parent'];

const nonAdminRoleOptions = ALL_ROLES
  .filter(r => r !== 'admin')
  .map(r => ({ value: r, label: r === 'league_manager' ? 'League Manager' : ROLE_LABELS[r] }));

// ── UserCard ─────────────────────────────────────────────────────────────────

interface UserCardProps {
  user: UserProfile;
  teams: { id: string; name: string }[];
  leagues: { id: string; name: string }[];
  isSelf: boolean;
  onClick: () => void;
}

function membershipLabel(m: RoleMembership, teams: { id: string; name: string }[], leagues: { id: string; name: string }[]): string {
  const role = ROLE_LABELS[m.role];
  if (m.role === 'admin') return role;
  if (m.teamId) {
    const team = teams.find(t => t.id === m.teamId);
    return team ? `${role} — ${team.name}` : role;
  }
  if (m.leagueId) {
    const league = leagues.find(l => l.id === m.leagueId);
    return league ? `${role} — ${league.name}` : role;
  }
  return role;
}

function UserCard({ user, teams, leagues, isSelf, onClick }: UserCardProps) {
  const memberships = user.memberships ?? [{ role: user.role, isPrimary: true, teamId: user.teamId, leagueId: user.leagueId }];
  const visiblePills = memberships.slice(0, 2);
  const overflow = memberships.length - visiblePills.length;
  const avatarColor = ROLE_AVATAR_COLORS[user.role] ?? 'bg-gray-500';

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white border border-gray-200 rounded-xl px-4 py-3.5 hover:shadow-md hover:border-gray-300 transition-all flex items-center gap-3 group"
    >
      {/* Avatar */}
      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${avatarColor}`}>
        {user.displayName.charAt(0).toUpperCase()}
      </div>

      {/* Identity */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 text-sm truncate">
          {user.displayName}
          {isSelf && <span className="ml-1.5 text-xs text-gray-400 font-normal">(you)</span>}
        </p>
        <p className="text-xs text-gray-500 truncate">{user.email}</p>
      </div>

      {/* Membership pills */}
      <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end max-w-[280px]">
        {visiblePills.map((m, i) => (
          <span
            key={i}
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[m.role]}`}
          >
            {membershipLabel(m, teams, leagues)}
          </span>
        ))}
        {overflow > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
            +{overflow} more
          </span>
        )}
      </div>

      {/* Status + chevron */}
      <div className="flex items-center gap-2 flex-shrink-0 ml-1">
        {user.mustChangePassword && (
          <KeyRound size={14} className="text-amber-500" title="Temp password — user must change on next login" />
        )}
        <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
      </div>
    </button>
  );
}

// ── MembershipRow ─────────────────────────────────────────────────────────────

interface MembershipRowProps {
  membership: RoleMembership;
  index: number;
  teams: { id: string; name: string }[];
  leagues: { id: string; name: string }[];
  onSetPrimary: (index: number) => void;
  onUpdate: (index: number, updated: Omit<RoleMembership, 'isPrimary'>) => void;
  onRemove: (index: number) => void;
  isOnly: boolean;
}

function MembershipRow({ membership, index, teams, leagues, onSetPrimary, onUpdate, onRemove, isOnly }: MembershipRowProps) {
  const [editing, setEditing] = useState(false);
  const [editRole, setEditRole] = useState<UserRole>(membership.role);
  const [editTeamId, setEditTeamId] = useState(membership.teamId ?? '');
  const [editLeagueId, setEditLeagueId] = useState(membership.leagueId ?? '');
  const [editError, setEditError] = useState('');

  const needsTeam = editRole === 'coach' || editRole === 'player' || editRole === 'parent';
  const needsLeague = editRole === 'league_manager';

  function handleEditSave() {
    if (needsTeam && !editTeamId) { setEditError('Select a team.'); return; }
    if (needsLeague && !editLeagueId) { setEditError('Select a league.'); return; }
    const updated: Omit<RoleMembership, 'isPrimary'> = { role: editRole };
    if (needsTeam && editTeamId) updated.teamId = editTeamId;
    if (needsLeague && editLeagueId) updated.leagueId = editLeagueId;
    onUpdate(index, updated);
    setEditing(false);
    setEditError('');
  }

  function handleEditCancel() {
    setEditRole(membership.role);
    setEditTeamId(membership.teamId ?? '');
    setEditLeagueId(membership.leagueId ?? '');
    setEditError('');
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg space-y-2">
        <Select
          label="Role"
          value={editRole}
          onChange={e => { setEditRole(e.target.value as UserRole); setEditError(''); }}
          options={nonAdminRoleOptions}
        />
        {needsTeam && (
          <Select
            label="Team"
            value={editTeamId}
            onChange={e => { setEditTeamId(e.target.value); setEditError(''); }}
            options={[{ value: '', label: 'Select a team…' }, ...teams.map(t => ({ value: t.id, label: t.name }))]}
          />
        )}
        {needsLeague && (
          <Select
            label="League"
            value={editLeagueId}
            onChange={e => { setEditLeagueId(e.target.value); setEditError(''); }}
            options={[{ value: '', label: 'Select a league…' }, ...leagues.map(l => ({ value: l.id, label: l.name }))]}
          />
        )}
        {editError && <p className="text-xs text-red-600">{editError}</p>}
        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={handleEditSave}>Save</Button>
          <Button size="sm" variant="secondary" onClick={handleEditCancel}>Cancel</Button>
        </div>
      </div>
    );
  }

  const label = membershipLabel(membership, teams, leagues);
  return (
    <div className="flex items-center gap-2 py-2.5 px-3 bg-gray-50 rounded-lg group">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${ROLE_COLORS[membership.role]}`}>
        {ROLE_LABELS[membership.role]}
      </span>
      <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">{label}</span>
      <button
        onClick={() => setEditing(true)}
        title="Edit membership"
        className="flex-shrink-0 text-gray-300 hover:text-gray-600 transition-colors opacity-0 group-hover:opacity-100"
      >
        <Pencil size={13} />
      </button>
      <button
        onClick={() => !membership.isPrimary && onSetPrimary(index)}
        title={membership.isPrimary ? 'Primary membership' : 'Set as primary'}
        className={`flex-shrink-0 transition-colors ${membership.isPrimary ? 'text-amber-400 cursor-default' : 'text-gray-300 hover:text-amber-400'}`}
      >
        <Star size={14} fill={membership.isPrimary ? 'currentColor' : 'none'} />
      </button>
      <button
        onClick={() => !isOnly && onRemove(index)}
        title={isOnly ? 'Cannot remove the only membership' : 'Remove membership'}
        className={`flex-shrink-0 transition-colors ${isOnly ? 'text-gray-200 cursor-not-allowed' : 'text-gray-300 hover:text-red-500'}`}
        disabled={isOnly}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

// ── AddMembershipForm ─────────────────────────────────────────────────────────

interface AddMembershipFormProps {
  teams: { id: string; name: string }[];
  leagues: { id: string; name: string }[];
  onAdd: (membership: Omit<RoleMembership, 'isPrimary'>) => void;
  onCancel: () => void;
}

function AddMembershipForm({ teams, leagues, onAdd, onCancel }: AddMembershipFormProps) {
  const [role, setRole] = useState<UserRole>('coach');
  const [teamId, setTeamId] = useState('');
  const [leagueId, setLeagueId] = useState('');
  const [error, setError] = useState('');

  const needsTeam = role === 'coach' || role === 'player' || role === 'parent';
  const needsLeague = role === 'league_manager';

  function handleAdd() {
    if (needsTeam && !teamId) { setError('Select a team.'); return; }
    if (needsLeague && !leagueId) { setError('Select a league.'); return; }
    const m: Omit<RoleMembership, 'isPrimary'> = { role };
    if (needsTeam && teamId) m.teamId = teamId;
    if (needsLeague && leagueId) m.leagueId = leagueId;
    onAdd(m);
  }

  return (
    <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-lg space-y-3">
      <Select
        label="Role"
        value={role}
        onChange={e => { setRole(e.target.value as UserRole); setError(''); }}
        options={nonAdminRoleOptions}
      />
      {needsTeam && (
        <Select
          label="Team"
          value={teamId}
          onChange={e => { setTeamId(e.target.value); setError(''); }}
          options={[{ value: '', label: 'Select a team…' }, ...teams.map(t => ({ value: t.id, label: t.name }))]}
        />
      )}
      {needsLeague && (
        <Select
          label="League"
          value={leagueId}
          onChange={e => { setLeagueId(e.target.value); setError(''); }}
          options={[{ value: '', label: 'Select a league…' }, ...leagues.map(l => ({ value: l.id, label: l.name }))]}
        />
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={handleAdd}>Add</Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ── EditPanel ─────────────────────────────────────────────────────────────────

interface EditPanelProps {
  user: UserProfile;
  teams: { id: string; name: string }[];
  leagues: { id: string; name: string }[];
  isSelf: boolean;
  onSave: (patch: Partial<UserProfile>) => Promise<void>;
  onMembershipsChange: (next: RoleMembership[], uid: string) => Promise<void>;
  onDelete: () => void;
  onResetPassword: () => void;
  onClose: () => void;
}

function EditPanel({
  user, teams, leagues, isSelf,
  onSave, onMembershipsChange, onDelete, onResetPassword, onClose,
}: EditPanelProps) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [saving, setSaving] = useState(false);
  const [addingMembership, setAddingMembership] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<number | null>(null);

  const memberships: RoleMembership[] = user.memberships ?? [
    { role: user.role, isPrimary: true, ...(user.teamId ? { teamId: user.teamId } : {}), ...(user.leagueId ? { leagueId: user.leagueId } : {}) },
  ];

  const avatarColor = ROLE_AVATAR_COLORS[user.role] ?? 'bg-gray-500';
  const isDirty = displayName.trim() !== user.displayName;

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({ displayName: displayName.trim() });
    } finally {
      setSaving(false);
    }
  }

  async function handleAddMembership(m: Omit<RoleMembership, 'isPrimary'>) {
    const next = addMembership(memberships, m);
    await onMembershipsChange(next, user.uid);
    setAddingMembership(false);
  }

  async function handleUpdateMembership(index: number, updated: Omit<RoleMembership, 'isPrimary'>) {
    const next = memberships.map((m, i) =>
      i === index ? { ...updated, isPrimary: m.isPrimary } : m
    );
    await onMembershipsChange(next, user.uid);
  }

  async function handleRemoveMembership(index: number) {
    const next = removeMembership(memberships, index);
    if (!next) return;
    await onMembershipsChange(next, user.uid);
    setRemoveTarget(null);
  }

  async function handleSetPrimary(index: number) {
    const next = setPrimaryMembership(memberships, index);
    await onMembershipsChange(next, user.uid);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {/* Section 1 — Identity */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-xl flex-shrink-0 ${avatarColor}`}>
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 text-lg leading-tight truncate">
                {user.displayName}
                {isSelf && <span className="ml-2 text-sm text-gray-400 font-normal">(you)</span>}
              </p>
              <p className="text-sm text-gray-500 truncate">{user.email}</p>
              {user.mustChangePassword && (
                <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                  <KeyRound size={10} /> Temp password active
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Section 2 — Display Name */}
        <div className="px-6 py-5 border-b border-gray-100">
          <Input
            label="Display Name"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            disabled={isSelf}
          />
        </div>

        {/* Section 3 — Memberships */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Memberships</h3>
              <p className="text-xs text-gray-400 mt-0.5">Star sets the primary role. Hover a row to edit or remove.</p>
            </div>
            {!isSelf && (
              <Button size="sm" variant="secondary" onClick={() => setAddingMembership(v => !v)}>
                <Plus size={13} className="mr-1" /> Add
              </Button>
            )}
          </div>

          <div className="space-y-2">
            {memberships.map((m, i) => (
              <MembershipRow
                key={i}
                membership={m}
                index={i}
                teams={teams}
                leagues={leagues}
                onSetPrimary={handleSetPrimary}
                onUpdate={handleUpdateMembership}
                onRemove={idx => setRemoveTarget(idx)}
                isOnly={memberships.length === 1}
              />
            ))}
          </div>

          {memberships.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-3">No memberships assigned.</p>
          )}

          {addingMembership && (
            <AddMembershipForm
              teams={teams}
              leagues={leagues}
              onAdd={handleAddMembership}
              onCancel={() => setAddingMembership(false)}
            />
          )}
        </div>

        {/* Section 4 — Danger Zone */}
        {!isSelf && (
          <div className="px-6 py-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Danger Zone</p>
            <div className="space-y-2">
              <button
                onClick={onResetPassword}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors text-left"
              >
                <KeyRound size={15} className="text-gray-400 flex-shrink-0" />
                Send Password Reset Email
              </button>
              <button
                onClick={onDelete}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-red-200 text-sm text-red-600 hover:bg-red-50 transition-colors text-left"
              >
                <Trash2 size={15} className="flex-shrink-0" />
                Delete User
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sticky footer — display name save */}
      {!isSelf && (
        <div className="flex-shrink-0 sticky bottom-0 bg-white border-t border-gray-100 px-6 py-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={!isDirty || saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      )}

      {/* Remove membership confirm */}
      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => removeTarget !== null && handleRemoveMembership(removeTarget)}
        title="Remove Membership"
        message={
          removeTarget !== null
            ? `Remove the ${ROLE_LABELS[memberships[removeTarget]?.role ?? 'player']} membership? This will affect their access.`
            : ''
        }
        confirmLabel="Remove"
      />
    </div>
  );
}

// ── UsersPage ─────────────────────────────────────────────────────────────────

export function UsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const [resetTarget, setResetTarget] = useState<UserProfile | null>(null);
  const [resetInFlight, setResetInFlight] = useState<string | null>(null);
  const [resetToast, setResetToast] = useState<string | null>(null);

  const teams = useTeamStore(s => s.teams);
  const leagues = useLeagueStore(s => s.leagues);
  const currentUid = useAuthStore(s => s.user?.uid);

  useEffect(() => {
    getDocs(collection(db, 'users')).then(snap => {
      setUsers(snap.docs.map(d => d.data() as UserProfile));
      setLoading(false);
    });
  }, []);

  // ── Mutations ──────────────────────────────────────────────────────────────

  async function updateUser(uid: string, patch: Partial<UserProfile>) {
    const prev = users.find(u => u.uid === uid);
    if (!prev) return;
    const next = { ...prev, ...patch };
    setUsers(us => us.map(u => u.uid === uid ? next : u));
    if (selectedUser?.uid === uid) setSelectedUser(next);
    try {
      await updateDoc(doc(db, 'users', uid), patch as Record<string, unknown>);
    } catch (err) {
      setUsers(us => us.map(u => u.uid === uid ? prev : u));
      if (selectedUser?.uid === uid) setSelectedUser(prev);
      console.error('Failed to update user:', err);
      alert(`Failed to save: ${(err as Error).message}`);
    }
  }

  async function updateMemberships(nextMemberships: RoleMembership[], uid: string) {
    const prev = users.find(u => u.uid === uid);
    if (!prev) return;

    const legacyScalars = syncLegacyScalars(nextMemberships);
    const userPatch: Record<string, unknown> = { memberships: nextMemberships, ...legacyScalars };
    const next = { ...prev, ...userPatch };

    setUsers(us => us.map(u => u.uid === uid ? next : u));
    if (selectedUser?.uid === uid) setSelectedUser(next);

    try {
      const batch = writeBatch(db);
      const userRef = doc(db, 'users', uid);

      // Update the user profile
      batch.update(userRef, userPatch as Record<string, unknown>);

      // Sync coachIds on team docs
      const prevMemberships = prev.memberships ?? [{ role: prev.role, teamId: prev.teamId, isPrimary: true }];
      const prevCoachTeams = new Set(prevMemberships.filter(m => m.role === 'coach' && m.teamId).map(m => m.teamId!));
      const nextCoachTeams = new Set(nextMemberships.filter(m => m.role === 'coach' && m.teamId).map(m => m.teamId!));

      for (const teamId of nextCoachTeams) {
        if (!prevCoachTeams.has(teamId)) {
          batch.update(doc(db, 'teams', teamId), { coachIds: arrayUnion(uid) });
        }
      }
      for (const teamId of prevCoachTeams) {
        if (!nextCoachTeams.has(teamId)) {
          batch.update(doc(db, 'teams', teamId), { coachIds: arrayRemove(uid) });
        }
      }

      // Sync managerIds on league docs
      const prevManagerLeagues = new Set(prevMemberships.filter(m => m.role === 'league_manager' && m.leagueId).map(m => m.leagueId!));
      const nextManagerLeagues = new Set(nextMemberships.filter(m => m.role === 'league_manager' && m.leagueId).map(m => m.leagueId!));

      for (const leagueId of nextManagerLeagues) {
        if (!prevManagerLeagues.has(leagueId)) {
          batch.update(doc(db, 'leagues', leagueId), { managerIds: arrayUnion(uid) });
        }
      }
      for (const leagueId of prevManagerLeagues) {
        if (!nextManagerLeagues.has(leagueId)) {
          batch.update(doc(db, 'leagues', leagueId), { managerIds: arrayRemove(uid) });
        }
      }

      await batch.commit();
    } catch (err) {
      setUsers(us => us.map(u => u.uid === uid ? prev : u));
      if (selectedUser?.uid === uid) setSelectedUser(prev);
      console.error('Failed to update memberships:', err);
      alert(`Failed to save: ${(err as Error).message}`);
    }
  }

  async function handleDeleteUser(user: UserProfile) {
    try {
      const deleteFn = httpsCallable<{ uid: string }, { success: boolean }>(functions, 'deleteUserByAdmin');
      await deleteFn({ uid: user.uid });
      setUsers(prev => prev.filter(u => u.uid !== user.uid));
      if (selectedUser?.uid === user.uid) setSelectedUser(null);
    } catch (err) {
      alert(`Failed to delete user: ${(err as Error).message}`);
    }
    setDeleteTarget(null);
  }

  async function handleResetPassword(user: UserProfile) {
    setResetTarget(null);
    setResetInFlight(user.uid);
    try {
      const fn = httpsCallable<{ uid: string }, { success: boolean }>(functions, 'resetUserPassword');
      await fn({ uid: user.uid });
      setResetToast(`Password reset email sent to ${user.email}`);
      setTimeout(() => setResetToast(null), 4000);
    } catch (err) {
      alert(`Failed to send reset email: ${(err as Error).message}`);
    } finally {
      setResetInFlight(null);
    }
  }

  // ── Filtering ──────────────────────────────────────────────────────────────

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchesSearch = !q || u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchesRole = roleFilter === 'all' || u.role === roleFilter ||
      (u.memberships ?? []).some(m => m.role === roleFilter);
    return matchesSearch && matchesRole;
  });

  const selectedUserLive = selectedUser ? users.find(u => u.uid === selectedUser.uid) ?? selectedUser : null;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <div className="p-4 sm:p-6 text-sm text-gray-400">Loading users…</div>;

  return (
    <div className="p-4 sm:p-6">
      {/* Toast */}
      {resetToast && (
        <div role="status" className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-3">
          <span>{resetToast}</span>
          <button onClick={() => setResetToast(null)} aria-label="Dismiss" className="text-gray-400 hover:text-white"><X size={14} /></button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-gray-500" />
          <p className="text-sm text-gray-500">{users.length} {users.length === 1 ? 'user' : 'users'}</p>
        </div>
        <Button onClick={() => setAddOpen(true)}><Plus size={16} /> Add User</Button>
      </div>

      {/* Search + role filter */}
      <div className="mb-4 space-y-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search by name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['all', ...ALL_ROLES] as const).map(r => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                roleFilter === r
                  ? r === 'all' ? 'bg-gray-800 text-white' : ROLE_COLORS[r as UserRole]
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {r === 'all' ? 'All' : r === 'league_manager' ? 'League Mgr' : ROLE_LABELS[r as UserRole]}
            </button>
          ))}
        </div>
      </div>

      {/* User list */}
      {filtered.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-gray-400">{search || roleFilter !== 'all' ? 'No users match your filter.' : 'No users yet.'}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(user => (
            <UserCard
              key={user.uid}
              user={user}
              teams={teams}
              leagues={leagues}
              isSelf={user.uid === currentUid}
              onClick={() => setSelectedUser(user)}
            />
          ))}
        </div>
      )}

      {/* Edit slide-over */}
      <SlideOver
        open={!!selectedUserLive}
        onClose={() => setSelectedUser(null)}
        title="Edit User"
      >
        {selectedUserLive && (
          <EditPanel
            user={selectedUserLive}
            teams={teams}
            leagues={leagues}
            isSelf={selectedUserLive.uid === currentUid}
            onSave={patch => updateUser(selectedUserLive.uid, patch)}
            onMembershipsChange={updateMemberships}
            onDelete={() => { setDeleteTarget(selectedUserLive); }}
            onResetPassword={() => {
              if (resetInFlight === selectedUserLive.uid) return;
              setResetTarget(selectedUserLive);
            }}
            onClose={() => setSelectedUser(null)}
          />
        )}
      </SlideOver>

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

      <ConfirmDialog
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        onConfirm={() => resetTarget && handleResetPassword(resetTarget)}
        title="Send Password Reset Email"
        message={`Send a password reset email to ${resetTarget?.email}?`}
        confirmLabel="Send Reset Email"
      />
    </div>
  );
}

// ── AddUserModal ──────────────────────────────────────────────────────────────

interface AddUserModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (user: UserProfile) => void;
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 12; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
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

  function handleCopyPassword() {
    navigator.clipboard.writeText(tempPassword).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  function handleCopyCreatedPassword() {
    if (!createdPassword) return;
    navigator.clipboard.writeText(createdPassword).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!firstName.trim()) { setError('First name is required'); return; }
    if (!lastName.trim()) { setError('Last name is required'); return; }
    if (tempPassword.length < 8) { setError('Temporary password must be at least 8 characters'); return; }
    setLoading(true);
    const displayName = `${firstName.trim()} ${lastName.trim()}`;
    try {
      const fn = httpsCallable<{ email: string; displayName: string; role: string; tempPassword: string }, { uid: string }>(functions, 'createUserByAdmin');
      const result = await fn({ email, displayName, role, tempPassword });
      onCreated({ uid: result.data.uid, email, displayName, role, mustChangePassword: true, createdAt: new Date().toISOString() });
      setCreatedPassword(tempPassword);
    } catch (e: unknown) {
      setError((e as { message?: string }).message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (createdPassword) {
    return (
      <Modal open={open} onClose={handleClose} title="User Created">
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
            <p className="text-sm font-medium text-green-800 mb-2">User created. Share this temporary password:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white border border-green-200 rounded px-3 py-1.5 text-sm font-mono text-green-900 select-all">{createdPassword}</code>
              <button type="button" onClick={handleCopyCreatedPassword} className="p-1.5 rounded hover:bg-green-100 text-green-700 transition-colors" title="Copy password">
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <p className="text-xs text-green-600 mt-2">They will be asked to set a new password on first sign-in.</p>
          </div>
          <div className="flex justify-end pt-2"><Button onClick={handleClose}>Done</Button></div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add User">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="First Name" name="given-name" autoComplete="given-name" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Jane" required />
          <Input label="Last Name" name="family-name" autoComplete="family-name" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Smith" required />
        </div>
        <Input label="Email" type="email" name="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Temporary Password</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text" name="temp-password" autoComplete="off"
                value={tempPassword} onChange={e => setTempPassword(e.target.value)}
                placeholder="At least 8 characters" required minLength={8}
                className="w-full px-3 py-2 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10 font-mono"
              />
              {tempPassword && (
                <button type="button" onClick={handleCopyPassword} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors" title="Copy password">
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </button>
              )}
            </div>
            <Button type="button" variant="secondary" onClick={() => setTempPassword(generatePassword())} className="shrink-0 flex items-center gap-1.5 px-3">
              <RefreshCw size={14} /> Auto-generate
            </Button>
          </div>
        </div>
        <Select label="Role" value={role} onChange={e => setRole(e.target.value as UserRole)} options={nonAdminRoleOptions} />
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
