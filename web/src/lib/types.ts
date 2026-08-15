export type UserRole = "user" | "trial_user" | "admin";
export type UserStatus = "active" | "inactive";

export interface InterviewConfig {
  full_name: string;
  profile_data: string;
  context: string;
}

export interface User {
  _id: string;
  username: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  credits: number;
  interview_config: InterviewConfig | null;
  created_at: number | null;
  updated_at: number | null;
}

export interface UserDetail {
  user: User;
  payment_count: number;
  session_count: number;
}

export type PaymentPlan = "starter" | "pro" | "enterprise";
export type PaymentStatus =
  | "pending"
  | "waiting"
  | "confirming"
  | "confirmed"
  | "sending"
  | "partially_paid"
  | "finished"
  | "failed"
  | "refunded"
  | "expired";

export interface UserLabel {
  id: string;
  username: string;
  email: string;
}

export interface Payment {
  _id: string;
  user_id: string;
  user: UserLabel | null;
  plan: PaymentPlan;
  payment_id: string | null;
  order_id: string;
  status: PaymentStatus;
  pay_address: string | null;
  pay_amount: number | null;
  pay_currency: string | null;
  price_amount: number;
  credits_amount: number;
  credits_applied: boolean;
  purchase_id: string | null;
  root_payment_id: string | null;
  created_at: number | null;
  updated_at: number | null;
}

export interface DeviceInfo {
  ip_address: string;
  user_agent: string;
}

export interface Session {
  _id: string;
  // No `token` field: the API never serves it (it is a live bearer credential).
  user_id: string;
  user: UserLabel | null;
  device_info: DeviceInfo;
  created_at: number | null;
  updated_at: number | null;
}

export type AuditEventType =
  | "login"
  | "logout"
  | "signup"
  | "password_change"
  | "profile_update"
  | "session_expire"
  | "email_verification_requested"
  | "email_verification_confirmed"
  | "payment_created"
  | "payment_webhook_received"
  | "payment_completed"
  | "payment_partially_paid"
  | "payment_failed"
  | "payment_error"
  | "credits_applied"
  | "asr_start"
  | "asr_stop";

export type AuditStatus = "success" | "failure";

export interface AuditLog {
  _id: string;
  event_type: AuditEventType;
  user_id: string | null;
  email: string | null;
  status: AuditStatus;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: number | null;
  updated_at: number | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface DailyCount {
  date: string;
  count: number;
}

export interface DailyAmount {
  date: string;
  amount: number;
}

export interface AnalyticsOverview {
  users: {
    total: number;
    by_role: Record<string, number>;
    by_status: Record<string, number>;
    signups_per_day: DailyCount[];
  };
  revenue: {
    total_usd: number;
    per_day: DailyAmount[];
    payments_by_status: Record<string, number>;
  };
  credits_outstanding: number;
  activity: {
    logins_per_day: DailyCount[];
    signups_per_day: DailyCount[];
    asr_sessions_per_day: DailyCount[];
  };
  recent_activity: AuditLog[];
}
