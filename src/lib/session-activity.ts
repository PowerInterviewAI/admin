const HOUR_MS = 3_600_000;

export const SESSION_ACTIVITIES = ["active", "idle", "stale"] as const;
export type SessionActivity = (typeof SESSION_ACTIVITIES)[number];

/** Where "active" stops and "idle" begins, and where "idle" becomes "stale". */
export const SESSION_ACTIVE_WINDOW_MS = 24 * HOUR_MS;
export const SESSION_IDLE_WINDOW_MS = 7 * 24 * HOUR_MS;

export const SESSION_ACTIVITY_LABELS: Record<SessionActivity, string> = {
  active: "Active (24h)",
  idle: "Idle (1-7d)",
  stale: "Stale (7d+)",
};

/**
 * Last-seen is `updated_at` when backend has touched the session and `created_at` otherwise.
 * `updated_at` starts null and stays null until the account's next authenticated request, so
 * reading it alone would file every brand-new session as the oldest thing in the table.
 */
export function lastActiveAt(session: {
  created_at?: number | null;
  updated_at?: number | null;
}): number | null {
  return session.updated_at ?? session.created_at ?? null;
}

/**
 * Classifies one session against a clock passed in rather than read here.
 *
 * The caller supplying `now` is what keeps this usable on the server: the badge is computed during
 * the server render (`SessionRow.activity`) for the same reason a campaign's Interrupted state is -
 * a client re-deciding it against its own clock during hydration would be free to disagree with the
 * markup it is hydrating.
 */
export function classifySessionActivity(
  lastActive: number | null,
  now: number,
): SessionActivity {
  if (lastActive === null) return "stale";

  const age = now - lastActive;
  if (age <= SESSION_ACTIVE_WINDOW_MS) return "active";
  if (age <= SESSION_IDLE_WINDOW_MS) return "idle";
  return "stale";
}
