import "server-only";

/**
 * A sign-in rate limit, held in memory.
 *
 * In memory is the right scope for exactly this deployment and not for a bigger one: the app runs
 * as a single Node process (`next start -p 13000`), so one map is the whole picture, and a restart
 * clearing it is a nuisance rather than a hole. If this app is ever run behind more than one
 * process, this stops being a limit and the counter belongs in Mongo next to the sessions.
 *
 * It is keyed by email rather than by IP because every request to a local tool arrives from the
 * same handful of addresses, and because the attack it is here to slow down - guessing one
 * account's password - is the one an email key actually tracks.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

interface Attempts {
  count: number;
  /** When the window that is counting these attempts started. */
  since: number;
}

declare global {
  var __adminSignInAttempts: Map<string, Attempts> | undefined;
}

function attempts(): Map<string, Attempts> {
  globalThis.__adminSignInAttempts ??= new Map();
  return globalThis.__adminSignInAttempts;
}

function currentWindow(key: string): Attempts | null {
  const entry = attempts().get(key);
  if (!entry) return null;

  if (Date.now() - entry.since >= WINDOW_MS) {
    attempts().delete(key);
    return null;
  }
  return entry;
}

/** How many whole minutes are left on the lock, or 0 when the caller may try. */
export function retryAfterMinutes(key: string): number {
  const entry = currentWindow(key);
  if (!entry || entry.count < MAX_ATTEMPTS) return 0;
  return Math.max(1, Math.ceil((WINDOW_MS - (Date.now() - entry.since)) / 60_000));
}

export function recordFailedAttempt(key: string): void {
  const entry = currentWindow(key);
  if (entry) {
    entry.count += 1;
    return;
  }
  attempts().set(key, { count: 1, since: Date.now() });
}

/** A successful sign-in clears the count, so a typo followed by the right password costs nothing. */
export function clearAttempts(key: string): void {
  attempts().delete(key);
}
