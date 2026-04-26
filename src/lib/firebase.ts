import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, connectStorageEmulator } from 'firebase/storage';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Persistent local cache (IndexedDB) — onSnapshot listeners and getDocs queries
// return cached results immediately, then sync deltas from the server. Page
// reloads, multi-tab sessions, and dev hot-reloads no longer re-fetch every
// document the user has already seen. Security rules still apply to cached
// reads, so no privilege expansion. persistentMultipleTabManager() handles
// leader election so multiple open tabs don't each pay for the full sync.
//
// Skipped when running against the emulator: the emulator is in-memory
// already, persistence adds no value and complicates the test reset cycle.
const useEmulator = import.meta.env.VITE_USE_EMULATOR === 'true';

export const db = useEmulator
  ? initializeFirestore(app, {})
  : initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });

export const functions = getFunctions(app);
export const storage = getStorage(app);

if (useEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  console.info('[Firebase] Connected to local emulators');
}
