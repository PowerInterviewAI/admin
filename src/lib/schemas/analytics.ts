import type { AuditLog } from "@/lib/schemas/audit-log";

export interface DailyCount {
  date: string;
  count: number;
}

export interface DailyAmount {
  date: string;
  amount: number;
}

/** One day's authentication attempts, split by outcome, for the stacked chart. */
export interface DailyOutcome {
  date: string;
  success: number;
  failure: number;
}

/** A `0`-`23` bucket in the reporting time zone. */
export interface HourlyCount {
  hour: number;
  count: number;
}

export interface UsersAnalytics {
  total: number;
  new_in_window: number;
  by_role: Record<string, number>;
  by_status: Record<string, number>;
  signups_per_day: DailyCount[];
  /**
   * Running total, seeded with everyone who existed before the window opened. Without that
   * baseline the curve would start at zero and read as if the product launched thirty days ago.
   */
  cumulative_per_day: DailyCount[];
}

export interface RevenueAnalytics {
  total_usd: number;
  window_usd: number;
  per_day: DailyAmount[];
  payments_by_status: Record<string, number>;
  by_plan_usd: Record<string, number>;
  paying_users: number;
  /** Lifetime revenue over the number of accounts that ever completed a payment. */
  avg_per_paying_user: number;
  /** Finished payments as a share of every payment record, `0`-`1`. */
  success_rate: number;
}

/**
 * Real usage signals sourced from `audit_logs`.
 *
 * Deliberately does not surface `global_state.active_sessions` - that field is a simulated
 * `random.gauss(260, 10)` value in backend (`app/services/ping_client_service.py`), not a real
 * metric, so it has no place in an analytics dashboard.
 */
export interface ActivityAnalytics {
  logins_per_day: DailyCount[];
  signups_per_day: DailyCount[];
  asr_sessions_per_day: DailyCount[];
  /** Distinct accounts that produced any audit event in the window. */
  active_users: number;
  logins_by_outcome: DailyOutcome[];
  by_hour: HourlyCount[];
}

/**
 * One interview is one `client_session_id` on backend's ASR audit rows, however many sockets it
 * opened: two for a live one, plus one per reconnect or language switch. Its kind is read off its
 * first `asr_start`. Rows written before backend recorded `kind` there are not counted.
 */
export interface InterviewsAnalytics {
  live_per_day: DailyCount[];
  mock_per_day: DailyCount[];
  live_in_window: number;
  mock_in_window: number;
}

/** What is happening at the moment the page rendered. */
export interface LiveNowAnalytics {
  /** Signed-in client apps: login sessions touched by an authenticated request in the last 30s. */
  apps_online: number;
  /** Distinct accounts behind `apps_online`; one person can have several apps open. */
  users_online: number;
  live_interviews: number;
  mock_interviews: number;
}

export interface AnalyticsOverview {
  window_days: number;
  users: UsersAnalytics;
  revenue: RevenueAnalytics;
  interviews: InterviewsAnalytics;
  now: LiveNowAnalytics;
  /**
   * The sum of every non-trial, non-admin user's `credits` balance - not a count, and not the
   * same thing `PaymentsSummary.credits_owed` below measures despite the similar name. Rendered
   * next to `revenue.total_usd` as if it were a liability against money received, which is why
   * trial and admin *accounts* are excluded: neither role's balance ever had a payment behind it.
   * A hand-set balance on an ordinary account is still included - see the note in
   * `server/queries/analytics.ts` for why that one is left to the audit trail instead.
   */
  credits_outstanding: number;
  activity: ActivityAnalytics;
  recent_activity: AuditLog[];
}

/**
 * The strip above each list table.
 *
 * Every one of these describes the *filtered* set, not the collection: they are computed from the
 * same filter the list query built, so the numbers on top always answer "what am I looking at"
 * rather than "what exists". They never cross to the client - each list's server component reads
 * them and renders the strip itself.
 */
export interface UsersSummary {
  total: number;
  active: number;
  /** Accounts with a name or a CV filled in: the product's activation signal. */
  configured: number;
  /** Accounts with a client app signed in right now. */
  online: number;
  credits: number;
  new_in_week: number;
}

export interface PaymentsSummary {
  total: number;
  /** Finished payments only, matching how the dashboard counts revenue. */
  revenue_usd: number;
  finished: number;
  in_flight: number;
  /**
   * A *count of orders* that are finished and never granted - not a sum of credits, despite the
   * name reading like a cousin of `AnalyticsOverview.credits_outstanding` above, which sums a
   * balance. The number that means somebody is owed something, in "how many orders" rather than
   * "how many credits".
   *
   * Orders, not payment documents: a follow-up leg is excluded, because an order's credits are
   * claimed against its root and a leg never carries `credits_applied` at all. See
   * `UNAPPLIED_EXPR` in `server/queries/payments.ts`.
   */
  credits_owed: number;
}

export interface SessionsSummary {
  total: number;
  active: number;
  idle: number;
  stale: number;
  /** Distinct accounts, which is not the row count: one person can hold many sessions. */
  users: number;
}

export interface InterviewsSummary {
  total: number;
  running: number;
  live: number;
  mock: number;
  /** Over ended interviews only, since a running one's duration is still growing. */
  avg_duration_ms: number | null;
}

export interface AuditLogsSummary {
  total: number;
  failures: number;
  users: number;
  ips: number;
  latest: number | null;
}

export interface CampaignsSummary {
  total: number;
  recipients: number;
  delivered: number;
  failed: number;
  latest: number | null;
}
