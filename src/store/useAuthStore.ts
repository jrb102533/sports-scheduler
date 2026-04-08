import { create } from 'zustand';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  updatePassword,
  sendEmailVerification,
  type User,
} from 'firebase/auth';
import { doc, setDoc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '@/lib/firebase';
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
    case 'auth/invalid-credential':
    case 'auth/user-not-found': return 'Incorrect email or password.';
    case 'auth/too-many-requests': return 'Too many attempts. Please try again later.';
    case 'auth/network-request-failed': return 'Network error. Check your connection and try again.';
    case 'auth/email-not-verified': return 'Please verify your email before signing in. Check your inbox for a verification link.';
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
  verificationEmailSent: boolean;

  init: () => () => void;
  signup: (email: string, password: string, displayName: string, role: UserRole, teamId?: string, memberships?: import('@/types').RoleMembership[], inviteSecret?: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (patch: Partial<Pick<UserProfile, 'displayName' | 'avatarUrl' | 'teamId' | 'playerId' | 'leagueId' | 'activeContext' | 'memberships' | 'role'>>) => Promise<void>;
  clearMustChangePassword: (newPassword: string) => Promise<void>;
  markConsentCurrent: () => void;
  clearError: () => void;
  resendVerificationEmail: (email: string, password: string) => Promise<void>;
  clearVerificationEmailSent: () => void;
}

// Suppresses the onSnapshot fallback profile during invite signup so that
// verifyInvitedUser can create the authoritative profile in its transaction.
let _inviteSignupInProgress = false;

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  profile: null,
  loading: true,
  error: null,
  mustChangePassword: false,
  consentOutdated: false,
  verificationEmailSent: false,

  init: () => {
    let profileUnsub: (() => void) | null = null;

    const authUnsub = onAuthStateChanged(auth, async (user) => {
      profileUnsub?.();
      profileUnsub = null;

      if (!user) {
        set({ user: null, profile: null, loading: false, consentOutdated: false, verificationEmailSent: false });
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
            // Also skip during invite signup — verifyInvitedUser will create the
            // authoritative profile; writing a fallback here races ahead of it
            // and causes the CF to see an existing 'player' profile.
            if (get().profile || _inviteSignupInProgress) return;
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

  signup: async (email, password, displayName, role, teamId, memberships, inviteSecret = '') => {
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
            // VITE_SIGNUP_ALLOWED_PREFIXES — comma-separated prefixes set at build time
            // (staging only; unset in production builds)
            const envPrefixes = (import.meta.env.VITE_SIGNUP_ALLOWED_PREFIXES ?? '')
              .split(',').map((p: string) => p.trim().toLowerCase()).filter(Boolean);
            const prefixAllowed = envPrefixes.some((p: string) => normalizedEmail.startsWith(p));
            if (!emailAllowed && !domainAllowed && !prefixAllowed) {
              const err = 'This is a test environment. Sign-ups are restricted to authorized testers. Contact the administrator to request access.';
              set({ error: err });
              throw new Error(err);
            }
          }
        }
      }

      // Suppress the onSnapshot fallback profile during invite signup so that
      // verifyInvitedUser can create the authoritative profile in its transaction.
      if (inviteSecret) _inviteSignupInProgress = true;

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
      // Only write the profile client-side when there is no invite.
      // When an invite is present, verifyInvitedUser creates the profile
      // authoritatively inside its transaction.
      if (!inviteSecret) {
        await setDoc(doc(db, 'users', user.uid), profile);
      }

      // Check for an invite. If found, the CF verifies the email and links team/player.
      // If not found, send a Firebase verification email and sign out.
      try {
        const verifyFn = httpsCallable<{ inviteSecret: string }, { found: boolean }>(
          functions, 'verifyInvitedUser'
        );
        const result = await verifyFn({ inviteSecret });
        if (!result.data.found) {
          await sendEmailVerification(user);
          await signOut(auth);
          set({ verificationEmailSent: true });
        }
      } catch {
        // If the CF call fails, fall back to sending a verification email
        await sendEmailVerification(user);
        await signOut(auth);
        set({ verificationEmailSent: true });
      }
    } catch (e: unknown) {
      set({ error: mapAuthError(e) });
      throw e;
    } finally {
      _inviteSignupInProgress = false;
    }
  },

  login: async (email, password) => {
    set({ error: null });
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      if (!cred.user.emailVerified) {
        // Before blocking the sign-in, check whether this user has a pending invite
        // with autoVerify: true. If so, the CF marks their Firebase Auth email as verified
        // and we reload the user token so emailVerified becomes true.
        try {
          const checkFn = httpsCallable<Record<string, never>, { verified: boolean }>(
            functions, 'checkInviteAutoVerify'
          );
          const result = await checkFn({});
          if (result.data.verified) {
            // The CF has updated the Auth record — reload to get the fresh token.
            await cred.user.reload();
          } else {
            await signOut(auth);
            throw Object.assign(new Error('Email not verified'), { code: 'auth/email-not-verified' });
          }
        } catch (inviteErr: unknown) {
          // If the CF call itself fails (network, etc.), treat as not verified.
          const code = (inviteErr as { code?: string }).code ?? '';
          if (code !== 'auth/email-not-verified') {
            // Unexpected CF error — sign out and surface the verification message.
            await signOut(auth);
          }
          throw Object.assign(new Error('Email not verified'), { code: 'auth/email-not-verified' });
        }
      }
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

  resendVerificationEmail: async (email, password) => {
    set({ error: null });
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(cred.user);
      await signOut(auth);
    } catch (e: unknown) {
      set({ error: mapAuthError(e) });
      throw e;
    }
  },

  clearVerificationEmailSent: () => set({ verificationEmailSent: false }),
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

/** Returns true if the user is a coach of the given team. Admin bypass included. */
export function isCoachOfTeam(profile: UserProfile | null, teamId: string): boolean {
  if (!profile) return false;
  const memberships = getMemberships(profile);
  if (memberships.some(m => m.role === 'admin')) return true;
  return memberships.some(m => m.role === 'coach' && m.teamId === teamId);
}

/** Returns true if the user is a manager of the given league. Admin bypass included. */
export function isManagerOfLeague(profile: UserProfile | null, leagueId: string): boolean {
  if (!profile) return false;
  const memberships = getMemberships(profile);
  if (memberships.some(m => m.role === 'admin')) return true;
  return memberships.some(m => m.role === 'league_manager' && m.leagueId === leagueId);
}

/** Returns true if the user has any membership in the given team. Admin bypass included. */
export function isMemberOfTeam(profile: UserProfile | null, teamId: string): boolean {
  if (!profile) return false;
  const memberships = getMemberships(profile);
  if (memberships.some(m => m.role === 'admin')) return true;
  return memberships.some(m => m.teamId === teamId);
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
