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
import type { UserRole, UserProfile, Team } from '@/types';

interface AuthStore {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;

  init: () => () => void;
  signup: (email: string, password: string, displayName: string, role: UserRole, teamId?: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (patch: Partial<Pick<UserProfile, 'displayName' | 'avatarUrl' | 'teamId' | 'playerId'>>) => Promise<void>;
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

      profileUnsub = onSnapshot(doc(db, 'users', user.uid), async (snap) => {
        if (!snap.exists()) return;
        const profile = snap.data() as UserProfile;
        set({ profile });

        // Auto-link: if no team/player yet, check if an invite exists for this email
        if (!profile.teamId && !profile.playerId && user.email) {
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
        }
      });
    });

    return () => {
      authUnsub();
      profileUnsub?.();
    };
  },

  signup: async (email, password, displayName, role, teamId) => {
    set({ error: null });
    try {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(user, { displayName });
      const profile: UserProfile = {
        uid: user.uid,
        email,
        displayName,
        role,
        createdAt: new Date().toISOString(),
        ...(teamId ? { teamId } : {}),
      };
      await setDoc(doc(db, 'users', user.uid), profile);
      await sendEmailVerification(user);
    } catch (e: unknown) {
      set({ error: (e as Error).message });
      throw e;
    }
  },

  login: async (email, password) => {
    set({ error: null });
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e: unknown) {
      set({ error: (e as Error).message });
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

// Role permission helpers
export function hasRole(profile: UserProfile | null, ...roles: UserRole[]): boolean {
  if (!profile) return false;
  return roles.includes(profile.role);
}

export function canEdit(profile: UserProfile | null, team?: Team | null): boolean {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  if (!team) return false;
  return team.createdBy === profile.uid || team.coachId === profile.uid;
}

export function isReadOnly(profile: UserProfile | null): boolean {
  return profile?.role === 'player' || profile?.role === 'parent';
}
