import type {
  AuditLogsSearchParams,
  EmailCampaignsSearchParams,
  PaymentsSearchParams,
  SessionsSearchParams,
  UsersSearchParams,
} from "@/lib/search-params";

/**
 * A quick filter offered as a tab above a list.
 *
 * `patch` is the params the tab sets. Every key that *any* tab in the same group touches is cleared
 * before it is applied, so a tab strip behaves as one single-select control rather than letting
 * "Trial" and "Admins" accumulate into a filter that matches nobody. Filters set through the
 * controls below the strip are untouched: tabs and filters compose.
 */
export interface ListTab<P> {
  value: string;
  label: string;
  patch: Partial<P>;
}

/** How many rows each tab holds, keyed by `ListTab.value`. */
export type ListTabCounts = Record<string, number>;

function tabKeys<P>(tabs: readonly ListTab<P>[]): (keyof P)[] {
  return [...new Set(tabs.flatMap((tab) => Object.keys(tab.patch)))] as (keyof P)[];
}

/** The full patch a tab writes: its own params, over a cleared version of every tab key. */
export function tabPatch<P>(tabs: readonly ListTab<P>[], tab: ListTab<P>): Partial<P> {
  const cleared = Object.fromEntries(tabKeys(tabs).map((key) => [key, undefined]));
  return { ...cleared, ...tab.patch } as Partial<P>;
}

/** The params a tab would produce, for counting how many rows it holds. */
export function tabParams<P extends object>(
  tabs: readonly ListTab<P>[],
  tab: ListTab<P>,
  params: P,
): P {
  return { ...params, ...tabPatch(tabs, tab) };
}

/**
 * Which tab the current params are showing, or `null` when they match none of them - a strip
 * highlighting a tab whose filter is not the one in force would be worse than highlighting nothing,
 * and that is reachable by picking a value from the filter row that no tab offers.
 *
 * The "All" tab has an empty patch, so it matches exactly when no tab key is set.
 */
export function activeTabValue<P extends object>(
  tabs: readonly ListTab<P>[],
  params: P,
): string | null {
  const keys = tabKeys(tabs);
  const found = tabs.find((tab) =>
    keys.every((key) => (params[key] ?? undefined) === (tab.patch[key] ?? undefined)),
  );
  return found?.value ?? null;
}

export const USERS_TABS: readonly ListTab<UsersSearchParams>[] = [
  { value: "all", label: "All", patch: {} },
  { value: "active", label: "Active", patch: { status: "active" } },
  { value: "online", label: "Online now", patch: { online: "yes" } },
  { value: "trial", label: "Trial", patch: { role: "trial_user" } },
  { value: "admins", label: "Admins", patch: { role: "admin" } },
  // The product's activation gap: accounts that signed up and never set an interview up.
  { value: "not_set_up", label: "Not set up", patch: { configured: "no" } },
];

export const PAYMENTS_TABS: readonly ListTab<PaymentsSearchParams>[] = [
  { value: "all", label: "All", patch: {} },
  { value: "in_flight", label: "In flight", patch: { bucket: "in_flight" } },
  { value: "finished", label: "Finished", patch: { bucket: "finished" } },
  { value: "failed", label: "Failed", patch: { bucket: "failed" } },
  // Paid for and not granted. The one bucket here that is a job rather than a status.
  { value: "credits_owed", label: "Credits owed", patch: { bucket: "unapplied" } },
];

export const SESSIONS_TABS: readonly ListTab<SessionsSearchParams>[] = [
  { value: "all", label: "All", patch: {} },
  { value: "active", label: "Active", patch: { activity: "active" } },
  { value: "idle", label: "Idle", patch: { activity: "idle" } },
  { value: "stale", label: "Stale", patch: { activity: "stale" } },
];

export const AUDIT_LOGS_TABS: readonly ListTab<AuditLogsSearchParams>[] = [
  { value: "all", label: "All", patch: {} },
  { value: "accounts", label: "Accounts", patch: { group: "auth" } },
  { value: "payments", label: "Payments", patch: { group: "payments" } },
  { value: "asr", label: "ASR", patch: { group: "asr" } },
  // Cuts across the groups rather than sitting beside them, which is the point: the failures are
  // what an admin opens this page for, and they are spread over all three.
  { value: "failures", label: "Failures", patch: { status: "failure" } },
];

export const CAMPAIGNS_TABS: readonly ListTab<EmailCampaignsSearchParams>[] = [
  { value: "all", label: "All", patch: {} },
  { value: "sending", label: "Sending", patch: { status: "sending" } },
  { value: "completed", label: "Completed", patch: { status: "completed" } },
  { value: "failed", label: "Failed", patch: { status: "failed" } },
];
