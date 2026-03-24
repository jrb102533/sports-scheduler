import { create } from 'zustand';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendEmailVerification,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, setDoc, getDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
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

  init: () => () => void;
  signup: (email: string, password: string, displayName: string, role: UserRole, teamId?: string, memberships?: import('@/types').RoleMembership[]) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (patch: Partial<Pick<UserProfile, 'displayName' | 'avatarUrl' | 'teamId' | 'playerId' | 'leagueId' | 'activeContext' | 'memberships'>>) => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  profile: null,
  loading: true,
  error: null,

  init: () => {
    let profileUnsub: (() => void) | null = null;

    const authUnsub = onAuthStateChanged(auth, async (user) => {
      profileUnsub?.();
      profileUnsub = null;

      if (!user) {
        set({ user: null, profile: null, loading: false });
        return;
      }

      set({ user, loading: false });

      profileUnsub = onSnapshot(
        doc(db, 'users', user.uid),
        async (snap) => {
          if (!snap.exists()) {
            // Profile document missing — create a minimal one so the app is usable
            await setDoc(doc(db, 'users', user.uid), {
              uid: user.uid,
              email: user.email ?? '',
              displayName: user.displayName ?? user.email?.split('@')[0] ?? 'User',
              role: 'coach',
              createdAt: new Date().toISOString(),
            });
            return; // onSnapshot will fire again with the new document
          }
          const profile = snap.data() as UserProfile;
          set({ profile });

          // Auto-link: if no team/player yet, check if an invite exists for this email
          if (!profile.teamId && !profile.playerId && user.email) {
            try {
              const inviteSnap = await getDoc(doc(db, 'invites', user.email.toLowerCase()));
              if (inviteSnap.exists()) {
                const invite = inviteSnap.data();
                await setDoc(doc(db, 'users', user.uid), {
                  ...profile,
                  teamId: invite.teamId,
                  playerId: invite.playerId,
                });
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
    // Send verification email separately — account creation already succeeded above
    try {
      await sendEmailVerification(auth.currentUser!);
    } catch {
      // Best-effort: verification email failure doesn't block the signup flow
    }
  },

  login: async (email, password) => {
    set({ error: null });
    try {
      const { user } = await signInWithEmailAndPassword(auth, email, password);
      if (!user.emailVerified) {
        await signOut(auth);
        const err = 'Please verify your email before signing in. Check your inbox for the verification link.';
        set({ error: err });
        throw new Error(err);
      }
    } catch (e: unknown) {
      if (!(e as Error).message?.includes('verify your email')) {
        set({ error: mapAuthError(e) });
      }
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
    m.role === 'league_manager' && m.leagueId && team.leagueId === m.leagueId
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
    if (m.role === 'league_manager' && m.leagueId) {
      allTeams.filter(t => t.leagueId === m.leagueId).forEach(t => ids.add(t.id));
    } else if (m.role === 'coach') {
      allTeams
        .filter(t => t.createdBy === profile.uid || t.coachId === profile.uid)
        .forEach(t => ids.add(t.id));
    } else if (m.teamId) {
      ids.add(m.teamId);
    }
  }
  return [...ids];
}
