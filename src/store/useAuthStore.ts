import { create } from 'zustand';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  updatePassword,
  type User,
} from 'firebase/auth';
import { doc, setDoc, getDoc, deleteDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { getUserConsents } from '@/lib/consent';
import { LEGAL_VERSIONS } from '@/legal/versions';
import type { UserRole, UserProfile, RoleMembership, Team } from '@/types';

/** Map Firebase Auth error codes to user-friendly messages. */
function mapAuthError(e: unknown): string {
  const code = (e as { code?: string }).code ?? '';
  switch (code) {
    case 'auth/email-already-in-use': return 'An account with this email already exists.';
    case 'auth/invalid-email': return 'Please enter a valid email address.';
    case 'auth/weak-password': return 'Password must be at least 6 characters.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential': return 'Incorrect email or password.';
    case 'auth/user-not-found': return 'No account found with this email.';
    case 'auth/too-many-requests': return 'Too many attempts. Please try again later.';
    case 'auth/network-request-failed': return 'Network error. Check your connection and try again.';
    default: return (e as Error).message ?? 'Something went wrong. Please try again.';
  }
}


interface AuthStore {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  mustChangePassword: boolean;
  consentOutdated: boolean;

  init: () => () => void;
  signup: (email: string, password: string, displayName: string, role: UserRole, teamId?: string, memberships?: import('@/types').RoleMembership[]) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (patch: Partial<Pick<UserProfile, 'displayName' | 'avatarUrl' | 'teamId' | 'playerId' | 'leagueId' | 'activeContext' | 'memberships' | 'role'>>) => Promise<void>;
  clearMustChangePassword: (newPassword: string) => Promise<void>;
  markConsentCurrent: () => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  profile: null,
  loading: true,
  error: null,
  mustChangePassword: false,
  consentOutdated: false,

  init: () => {
    let profileUnsub: (() => void) | null = null;

    const authUnsub = onAuthStateChanged(auth, async (user) => {
      profileUnsub?.();
      profileUnsub = null;

      if (!user) {
        set({ user: null, profile: null, loading: false, consentOutdated: false });
        return;
      }

      set({ user, loading: false });

      profileUnsub = onSnapshot(
        doc(db, 'users', user.uid),
        async (snap) => {
          if (!snap.exists()) {
            // Only create a fallback profile if we have no profile in state yet.
            // Guarding here prevents a transient snapshot (e.g. during a rules
            // deployment) from overwriting an existing user profile with a bare
            // 'player' document.
            if (get().profile) return;
            await setDoc(doc(db, 'users', user.uid), {
              uid: user.uid,
              email: user.email ?? '',
              displayName: user.displayName ?? user.email?.split('@')[0] ?? 'User',
              role: 'player',
              createdAt: new Date().toISOString(),
            });
            return; // onSnapshot will fire again with the new document
          }
          const profile = snap.data() as UserProfile;
          set({ profile, mustChangePassword: profile.mustChangePassword === true });

          // Check whether the user's stored consent versions are current
          try {
            const consents = await getUserConsents(user.uid);
            const outdated =
              consents.termsOfService?.version !== LEGAL_VERSIONS.termsOfService ||
              consents.privacyPolicy?.version !== LEGAL_VERSIONS.privacyPolicy;
            set({ consentOutdated: outdated });
          } catch {
            // Best-effort; don't block the app if consent check fails
          }

          // Auto-link: if no team/player yet, check if an invite exists for this email
          if (!profile.teamId && !profile.playerId && user.email) {
            try {
              const inviteSnap = await getDoc(doc(db, 'invites', user.email.toLowerCase()));
              if (inviteSnap.exists()) {
                const invite = inviteSnap.data();
                const { teamId, playerId, role: inviteRole } = invite as { teamId?: string; playerId?: string; role?: string };
                // teamId and playerId were validated server-side when the invite was created.
                // We trust the invite document and skip re-reading the player doc here —
                // a parent user with no teamId cannot read players yet, which would silently
                // block the link if we attempted the validation on the client.
                if (teamId && playerId) {
                  const patch: Partial<UserProfile> = { teamId, playerId };
                  // Apply the role from the invite only if it is an allowed invite role.
                  // We only override if the current profile role is still the default 'player'
                  // to avoid downgrading a coach who was re-invited.
                  const ALLOWED_INVITE_ROLES: UserRole[] = ['player', 'parent'];
                  if (
                    inviteRole &&
                    ALLOWED_INVITE_ROLES.includes(inviteRole as UserRole) &&
                    profile.role === 'player'
                  ) {
                    patch.role = inviteRole as UserRole;
                  }
                  await setDoc(doc(db, 'users', user.uid), { ...profile, ...patch });
                }
                await deleteDoc(doc(db, 'invites', user.email.toLowerCase()));
              }
            } catch {
              // Invite check is best-effort; ignore errors
            }
          }
        },
        (err) => {
          console.error('Profile snapshot error:', err);
          set({ loading: false });
        }
      );
    });

    return () => {
      authUnsub();
      profileUnsub?.();
    };
  },

  signup: async (email, password, displayName, role, teamId, memberships) => {
    set({ error: null });
    try {
      // Check the sign-up allowlist before creating the account.
      // system/signupConfig: { open: boolean, allowedEmails: string[], allowedDomains: string[] }
      {
        const configSnap = await getDoc(doc(db, 'system', 'signupConfig'));
        if (configSnap.exists()) {
          const config = configSnap.data() as { open?: boolean; allowedEmails?: string[]; allowedDomains?: string[] };
          if (!config.open) {
            const normalizedEmail = email.toLowerCase();
            const domain = normalizedEmail.split('@')[1] ?? '';
            const emailAllowed = config.allowedEmails?.map(e => e.toLowerCase()).includes(normalizedEmail);
            const domainAllowed = config.allowedDomains?.map(d => d.toLowerCase()).includes(domain);
            if (!emailAllowed && !domainAllowed) {
              const err = 'This is a test environment. Sign-ups are restricted to authorized testers. Contact the administrator to request access.';
              set({ error: err });
              throw new Error(err);
            }
          }
        }
      }

      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(user, { displayName });
      const resolvedMemberships: RoleMembership[] = memberships ?? [{
        role,
        isPrimary: true,
        ...(teamId ? { teamId } : {}),
      }];
      // Ensure primary membership has teamId if provided
      if (teamId && resolvedMemberships[0] && !resolvedMemberships[0].teamId) {
        resolvedMemberships[0] = { ...resolvedMemberships[0], teamId };
      }
      const profile: UserProfile = {
        uid: user.uid,
        email,
        displayName,
        role,
        createdAt: new Date().toISOString(),
        memberships: resolvedMemberships,
        activeContext: 0,
        ...(teamId ? { teamId } : {}),
      };
      await setDoc(doc(db, 'users', user.uid), profile);
    } catch (e: unknown) {
      set({ error: mapAuthError(e) });
      throw e;
    }
  },

  login: async (email, password) => {
    set({ error: null });
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e: unknown) {
      set({ error: mapAuthError(e) });
      throw e;
    }
  },

  logout: async () => {
    await signOut(auth);
  },

  updateProfile: async (patch) => {
    const { user, profile } = get();
    if (!user || !profile) return;
    const updated = { ...profile, ...patch };
    await setDoc(doc(db, 'users', user.uid), updated);
    if (patch.displayName) {
      await updateProfile(user, { displayName: patch.displayName });
    }
  },

  clearMustChangePassword: async (newPassword: string) => {
    const { user } = get();
    if (!user) return;
    await updatePassword(user, newPassword);
    await updateDoc(doc(db, 'users', user.uid), { mustChangePassword: false });
    set({ mustChangePassword: false });
  },

  markConsentCurrent: () => set({ consentOutdated: false }),

  clearError: () => set({ error: null }),
}));

// ── Membership helpers ────────────────────────────────────────────────────────

/**
 * Returns all memberships for a profile. Falls back to a synthetic single-
 * membership derived from the legacy role/teamId/playerId/leagueId fields so
 * that existing Firestore documents without a memberships array still work.
 */
export function getMemberships(profile: UserProfile | null): import('@/types').RoleMembership[] {
  if (!profile) return [];
  if (profile.memberships && profile.memberships.length > 0) return profile.memberships;
  // Legacy fallback
  return [{
    role: profile.role,
    isPrimary: true,
    ...(profile.teamId ? { teamId: profile.teamId } : {}),
    ...(profile.playerId ? { playerId: profile.playerId } : {}),
    ...(profile.leagueId ? { leagueId: profile.leagueId } : {}),
  }];
}

/**
 * Returns the active membership (the one driving the current dashboard context).
 */
export function getActiveMembership(profile: UserProfile | null): import('@/types').RoleMembership | null {
  const memberships = getMemberships(profile);
  if (memberships.length === 0) return null;
  const idx = profile?.activeContext ?? 0;
  return memberships[idx] ?? memberships.find(m => m.isPrimary) ?? memberships[0];
}

// ── Role permission helpers ───────────────────────────────────────────────────

/** Returns true if the user holds ANY of the given roles across all memberships. */
export function hasRole(profile: UserProfile | null, ...roles: UserRole[]): boolean {
  if (!profile) return false;
  return getMemberships(profile).some(m => roles.includes(m.role));
}

export function canEdit(profile: UserProfile | null, team?: Team | null): boolean {
  if (!profile) return false;
  const memberships = getMemberships(profile);
  if (memberships.some(m => m.role === 'admin')) return true;
  if (!team) return false;
  if (team.createdBy === profile.uid || team.coachId === profile.uid) return true;
  if (memberships.some(m =>
    m.role === 'league_manager' && m.leagueId && team.leagueIds?.includes(m.leagueId)
  )) return true;
  return false;
}

/** Returns true only if ALL memberships are read-only roles. */
export function isReadOnly(profile: UserProfile | null): boolean {
  if (!profile) return false;
  return getMemberships(profile).every(m => m.role === 'player' || m.role === 'parent');
}

/**
 * Returns the set of team IDs the user is allowed to see across ALL memberships.
 * Returns null for users with any admin membership (meaning all teams).
 */
export function getAccessibleTeamIds(profile: UserProfile | null, allTeams: Team[]): string[] | null {
  if (!profile) return [];
  const memberships = getMemberships(profile);
  if (memberships.some(m => m.role === 'admin')) return null;

  const ids = new Set<string>();
  for (const m of memberships) {
    if (m.role === 'league_manager') {
      // Teams in the LM's league
      if (m.leagueId) {
        allTeams.filter(t => t.leagueIds?.includes(m.leagueId!)).forEach(t => ids.add(t.id));
      }
      // Teams the LM created (may not yet be assigned to a league)
      allTeams.filter(t => t.createdBy === profile.uid).forEach(t => ids.add(t.id));
    } else if (m.role === 'coach') {
      allTeams
        .filter(t =>
          t.createdBy === profile.uid ||
          t.coachId === profile.uid ||
          (m.teamId && t.id === m.teamId)
        )
        .forEach(t => ids.add(t.id));
    } else if (m.teamId) {
      ids.add(m.teamId);
    }
  }
  return [...ids];
}
