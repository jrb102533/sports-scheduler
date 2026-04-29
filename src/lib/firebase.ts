import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { installReadCounter } from './firestoreReadCounter';

// Hard guard: refuse to connect a remote Firebase project from localhost.
// This prevents accidental staging/prod Firestore reads during local dev
// (e.g. `npm run dev` with no .env.local, or stale playwright-mcp sessions).
//
// Bypass options (mutually exclusive, pick one in .env.local):
//   VITE_USE_EMULATOR=true          → normal local dev against the emulator
//   VITE_ALLOW_LOCAL_STAGING=true   → rare escape hatch (reproducing a staging bug)
//                                     close the tab when done
const _isLocalhost =
  typeof window !== 'undefined' &&
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(window.location.hostname);
const _useEmulator = import.meta.env.VITE_USE_EMULATOR === 'true';
const _allowLocalStaging = import.meta.env.VITE_ALLOW_LOCAL_STAGING === 'true';

if (_isLocalhost && !_useEmulator && !_allowLocalStaging) {
  throw new Error(
    '[firebase] Refusing to connect to remote Firebase from localhost. ' +
    'Run `npm run dev:emulator` (recommended) or set VITE_ALLOW_LOCAL_STAGING=true ' +
    'in .env.local if you genuinely need to hit staging from localhost.'
  );
}

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
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);

if (import.meta.env.VITE_USE_EMULATOR === 'true') {
  installReadCounter();
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  console.info('[Firebase] Connected to local emulators');
}
