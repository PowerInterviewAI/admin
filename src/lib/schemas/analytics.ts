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

export interface AnalyticsOverview {
  window_days: number;
  users: UsersAnalytics;
  revenue: RevenueAnalytics;
  credits_outstanding: number;
  activity: ActivityAnalytics;
  recent_activity: AuditLog[];
}
