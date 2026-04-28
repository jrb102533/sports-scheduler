/**
 * Counts Firestore HTTP requests to the local emulator and exposes the running
 * total on `window.__firestoreReads`. Active only when the app is connected to
 * the emulator (`VITE_USE_EMULATOR === 'true'`). In production / staging this
 * module is a no-op.
 *
 * Limitations:
 *   - Counts HTTP fetch calls, not Firestore "document reads." A `RunQuery`
 *     returning 50 docs counts as 1 fetch. A long-lived `Listen` stream counts
 *     as 1 fetch even if 1000 doc updates arrive on it.
 *   - This is a regression-detection signal, not a billing-grade meter. The
 *     value is the *delta* between PR runs — sudden spikes catch unscoped
 *     queries, new snapshot listeners, and N+1 patterns.
 *
 * Used by the Playwright @emu read-count fixture to assert per-test budgets and
 * by CI to surface read-count deltas in PR comments.
 */

declare global {
  interface Window {
    __firestoreReads?: number;
    __firestoreReadsByPath?: Record<string, number>;
  }
}

export function installReadCounter(): void {
  if (typeof window === 'undefined') return;
  // Belt-and-suspenders: even if some future caller invokes this outside the
  // emulator gate in firebase.ts, refuse to install in a production build.
  if (import.meta.env?.PROD) {
    console.warn('[firestoreReadCounter] refusing to install in PROD build');
    return;
  }
  if ((window as { __firestoreReadCounterInstalled?: boolean }).__firestoreReadCounterInstalled) return;
  (window as { __firestoreReadCounterInstalled?: boolean }).__firestoreReadCounterInstalled = true;

  window.__firestoreReads = 0;
  window.__firestoreReadsByPath = {};

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('127.0.0.1:8080') && url.includes('google.firestore')) {
      window.__firestoreReads = (window.__firestoreReads ?? 0) + 1;
      const op = url.match(/Firestore\/(\w+)/)?.[1] ?? 'Unknown';
      window.__firestoreReadsByPath![op] = (window.__firestoreReadsByPath![op] ?? 0) + 1;
    }
    return originalFetch(input, init);
  };

  console.info('[firestoreReadCounter] installed (emulator only)');
}

export function resetReadCounter(): void {
  if (typeof window === 'undefined') return;
  window.__firestoreReads = 0;
  window.__firestoreReadsByPath = {};
}
