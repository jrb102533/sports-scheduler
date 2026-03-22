import { create } from 'zustand';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import type { UserRole, UserProfile } from '@/types';

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

      profileUnsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
        if (snap.exists()) {
          set({ profile: snap.data() as UserProfile });
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
        teamId,
        createdAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'users', user.uid), profile);
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

export function canEdit(profile: UserProfile | null, teamId?: string): boolean {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  if (profile.role === 'coach') return !teamId || profile.teamId === teamId;
  return false;
}

export function isReadOnly(profile: UserProfile | null): boolean {
  return profile?.role === 'player' || profile?.role === 'parent';
}
