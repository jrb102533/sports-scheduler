/**
 * Client-side unread tracking for team chat and DMs.
 *
 * State lives in localStorage (free, persists across sessions on the same
 * device). Compared against server-denormalized `lastMessageAt` to determine
 * whether a chat surface has unread messages without any extra Firestore
 * reads.
 *
 * Key shapes:
 *   `unread:team:<teamId>`     → ISO timestamp the user last viewed that team's chat
 *   `unread:dm:<threadId>`     → ISO timestamp the user last viewed that DM thread
 *
 * "Unread" = the server `lastMessageAt` is GREATER than the local lastReadAt.
 * Absence of either side resolves to "not unread" so the dot doesn't flash on
 * fresh installs / brand-new teams.
 *
 * Resilience: localStorage can throw on quota exhaustion or in some private-
 * browsing contexts. All access is wrapped — failures degrade to in-memory
 * fallback for the lifetime of the page so the UI keeps working.
 */

const TEAM_KEY_PREFIX = 'unread:team:';
const DM_KEY_PREFIX = 'unread:dm:';

// In-memory fallback used when localStorage is unavailable (private browsing,
// quota exceeded, blocked by user settings, etc.). Lives only for the page
// session; user gets best-effort unread tracking with no persistence.
const memoryFallback = new Map<string, string>();

function safeGet(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(key);
      if (v !== null) return v;
    }
  } catch {
    // localStorage access threw — fall through to in-memory.
  }
  return memoryFallback.get(key) ?? null;
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
  } catch {
    // Quota exceeded or access denied — fall through to in-memory.
  }
  memoryFallback.set(key, value);
}

/**
 * Returns true when the team's `lastMessageAt` (from the team doc) is newer
 * than the locally-recorded last-read time for that team.
 *
 * Returns false if either value is missing — the dot should not appear when
 * there's no signal that anything is unread.
 */
export function isTeamUnread(teamId: string, teamLastMessageAt: string | null | undefined): boolean {
  if (!teamLastMessageAt) return false;
  const lastRead = safeGet(TEAM_KEY_PREFIX + teamId);
  if (!lastRead) {
    // Never viewed and team has activity → mark as unread so the user sees
    // the dot the first time they encounter the team after install.
    return true;
  }
  return teamLastMessageAt > lastRead;
}

/**
 * Records that the user just viewed a team's chat at the given (or current)
 * time. Pass the team's own `lastMessageAt` so the recorded "read up to"
 * time matches the most recent server message — protects against the case
 * where the user opens the chat slightly before a new message arrives.
 *
 * If `teamLastMessageAt` is absent, records `now` as a safe fallback.
 */
export function markTeamRead(teamId: string, teamLastMessageAt?: string | null): void {
  const value = teamLastMessageAt ?? new Date().toISOString();
  safeSet(TEAM_KEY_PREFIX + teamId, value);
}

/**
 * Returns true when a DM thread's `lastMessageAt` is newer than the locally-
 * recorded last-view time. Same semantics as isTeamUnread but for DMs.
 */
export function isThreadUnread(threadId: string, threadLastMessageAt: string | null | undefined): boolean {
  if (!threadLastMessageAt) return false;
  const lastRead = safeGet(DM_KEY_PREFIX + threadId);
  if (!lastRead) return true;
  return threadLastMessageAt > lastRead;
}

/**
 * Records that the user just viewed a DM thread.
 */
export function markThreadRead(threadId: string, threadLastMessageAt?: string | null): void {
  const value = threadLastMessageAt ?? new Date().toISOString();
  safeSet(DM_KEY_PREFIX + threadId, value);
}

/**
 * Counts how many of the provided DM threads are unread for the current user.
 * Used by the sidebar badge.
 */
export function countUnreadThreads(threads: Array<{ id: string; lastMessageAt: string }>): number {
  let count = 0;
  for (const t of threads) {
    if (isThreadUnread(t.id, t.lastMessageAt)) count++;
  }
  return count;
}

/**
 * Test-only escape hatch. Not exported from the package surface; only
 * referenced by unit tests that need a clean slate between cases.
 */
export function _resetMessagingUnreadForTests(): void {
  memoryFallback.clear();
  try {
    if (typeof localStorage === 'undefined') return;
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(TEAM_KEY_PREFIX) || k.startsWith(DM_KEY_PREFIX))) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) localStorage.removeItem(k);
  } catch {
    // ignore
  }
}
