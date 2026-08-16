import type { AuditLog } from "@/lib/schemas/audit-log";

export interface DailyCount {
  date: string;
  count: number;
}

export interface DailyAmount {
  date: string;
  amount: number;
}

export interface UsersAnalytics {
  total: number;
  by_role: Record<string, number>;
  by_status: Record<string, number>;
  signups_per_day: DailyCount[];
}

export interface RevenueAnalytics {
  total_usd: number;
  per_day: DailyAmount[];
  payments_by_status: Record<string, number>;
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
}

export interface AnalyticsOverview {
  users: UsersAnalytics;
  revenue: RevenueAnalytics;
  credits_outstanding: number;
  activity: ActivityAnalytics;
  recent_activity: AuditLog[];
}
