"use server";

import { type ActionData, failed, succeeded } from "@/lib/action-result";
import { type CsvValue, csvFilename, toCsv } from "@/lib/csv";
import {
  auditLogsSearchParamsSchema,
  interviewsSearchParamsSchema,
  paymentsSearchParamsSchema,
  sessionsSearchParamsSchema,
  usersSearchParamsSchema,
} from "@/lib/search-params";
import { denyUnless } from "@/server/auth/guard";
import { AppError } from "@/server/errors";
import { listAuditLogs } from "@/server/queries/audit-logs";
import { listInterviews } from "@/server/queries/interviews";
import { getLiveState } from "@/server/queries/live";
import { listPayments } from "@/server/queries/payments";
import { listSessions } from "@/server/queries/sessions";
import { listUsers } from "@/server/queries/users";

export interface CsvExport {
  filename: string;
  csv: string;
  /** How many rows the file holds, so the caller can say when the cap truncated the result. */
  rows: number;
  truncated: boolean;
}

/**
 * The whole file is built in memory and returned through the action's result, so this is a ceiling
 * on the admin's own browser as much as on the query. At this product's scale it is far above any
 * real export; past it the honest answer is to narrow the filters, which is why the result says
 * when it truncated rather than quietly handing over a partial file.
 */
const EXPORT_LIMIT = 5000;

/**
 * Local wall-clock time, not `toISOString()`. The UI renders every timestamp in the reporting zone
 * and a spreadsheet that disagreed with the screen by several hours would be read as a bug in one
 * of them. Spelled out rather than delegated to `toLocaleString`, whose separators vary by locale
 * and are not what a spreadsheet parses as a date.
 */
function csvDate(ms: number | null | undefined): string {
  if (!ms) return "";
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function describe(error: unknown, what: string): { ok: false; error: string } {
  return failed(error instanceof AppError ? error.message : `Could not export ${what}`);
}

function build(prefix: string, headers: string[], rows: CsvValue[][]): CsvExport {
  return {
    filename: csvFilename(prefix),
    csv: toCsv(headers, rows),
    rows: rows.length,
    truncated: rows.length >= EXPORT_LIMIT,
  };
}

export async function exportUsersCsv(input: unknown): Promise<ActionData<CsvExport>> {
  const denied = await denyUnless("users:read");
  if (denied) return denied;

  const params = usersSearchParamsSchema.safeParse(input);
  if (!params.success) return failed("Those filters are not valid");

  try {
    const live = await getLiveState();
    const page = await listUsers({ ...params.data, page: 1, per_page: EXPORT_LIMIT }, live);
    return succeeded(
      build(
        "users",
        [
          "Username",
          "Email",
          "Role",
          "Status",
          "Credits",
          "Payments",
          "Sessions",
          "Online",
          "In interview",
          "Interview name",
          "Joined",
          "Updated",
          "ID",
        ],
        page.items.map((user) => [
          user.username,
          user.email,
          user.role,
          user.status,
          user.credits,
          user.payment_count,
          user.session_count,
          user.presence ? "yes" : "no",
          user.presence?.interview?.kind ?? "",
          user.interview_config?.full_name ?? "",
          csvDate(user.created_at),
          csvDate(user.updated_at),
          user._id,
        ]),
      ),
    );
  } catch (error) {
    return describe(error, "users");
  }
}

export async function exportPaymentsCsv(input: unknown): Promise<ActionData<CsvExport>> {
  const denied = await denyUnless("payments:read");
  if (denied) return denied;

  const params = paymentsSearchParamsSchema.safeParse(input);
  if (!params.success) return failed("Those filters are not valid");

  try {
    const page = await listPayments({ ...params.data, page: 1, per_page: EXPORT_LIMIT });
    return succeeded(
      build(
        "payments",
        [
          "Created",
          "Order ID",
          "Payment ID",
          "User",
          "Email",
          "Plan",
          "Status",
          "Amount USD",
          "Credits",
          "Credits applied",
          "Pay currency",
          "Pay amount",
          "Updated",
          "ID",
        ],
        page.items.map((payment) => [
          csvDate(payment.created_at),
          payment.order_id,
          payment.payment_id,
          payment.user?.username ?? "",
          payment.user?.email ?? "",
          payment.plan,
          payment.status,
          payment.price_amount,
          payment.credits_amount,
          payment.credits_applied ? "yes" : "no",
          payment.pay_currency,
          payment.pay_amount,
          csvDate(payment.updated_at),
          payment._id,
        ]),
      ),
    );
  } catch (error) {
    return describe(error, "payments");
  }
}

export async function exportInterviewsCsv(input: unknown): Promise<ActionData<CsvExport>> {
  const denied = await denyUnless("interviews:read");
  if (denied) return denied;

  const params = interviewsSearchParamsSchema.safeParse(input);
  if (!params.success) return failed("Those filters are not valid");

  try {
    const live = await getLiveState();
    const page = await listInterviews({ ...params.data, page: 1, per_page: EXPORT_LIMIT }, live);
    return succeeded(
      build(
        "interviews",
        [
          "Started",
          "Ended",
          "Duration seconds",
          "Kind",
          "State",
          "User",
          "Email",
          "Sockets",
          "Client session ID",
          "User ID",
        ],
        page.items.map((interview) => [
          csvDate(interview.started_at),
          csvDate(interview.ended_at),
          interview.duration_ms === null ? "" : Math.round(interview.duration_ms / 1000),
          interview.kind,
          interview.state,
          interview.user?.username ?? "",
          interview.user?.email ?? "",
          interview.sockets,
          interview.client_session_id,
          interview.user_id,
        ]),
      ),
    );
  } catch (error) {
    return describe(error, "interviews");
  }
}

export async function exportSessionsCsv(input: unknown): Promise<ActionData<CsvExport>> {
  // The page's own permission, not a looser one: this file is exactly the rows a guest is refused
  // on screen.
  const denied = await denyUnless("sessions:read");
  if (denied) return denied;

  const params = sessionsSearchParamsSchema.safeParse(input);
  if (!params.success) return failed("Those filters are not valid");

  try {
    const page = await listSessions({ ...params.data, page: 1, per_page: EXPORT_LIMIT });
    return succeeded(
      build(
        "sessions",
        ["Started", "Last active", "Activity", "User", "Email", "IP address", "User agent", "ID"],
        page.items.map((session) => [
          csvDate(session.created_at),
          csvDate(session.last_active_at),
          session.activity,
          session.user?.username ?? "",
          session.user?.email ?? "",
          session.device_info.ip_address,
          session.device_info.user_agent,
          session._id,
        ]),
      ),
    );
  } catch (error) {
    return describe(error, "sessions");
  }
}

export async function exportAuditLogsCsv(input: unknown): Promise<ActionData<CsvExport>> {
  // Admin-only for the same reason as the sessions export: `/audit-logs` is gated, so this file
  // is the rows a guest is refused on screen.
  const denied = await denyUnless("audit_logs:read");
  if (denied) return denied;

  const params = auditLogsSearchParamsSchema.safeParse(input);
  if (!params.success) return failed("Those filters are not valid");

  try {
    const page = await listAuditLogs({ ...params.data, page: 1, per_page: EXPORT_LIMIT });
    return succeeded(
      build(
        "audit-logs",
        ["When", "Event", "Status", "Email", "IP address", "User agent", "Metadata", "User ID", "ID"],
        page.items.map((log) => [
          csvDate(log.created_at),
          log.event_type,
          log.status,
          log.email,
          log.ip_address,
          log.user_agent,
          log.metadata ? JSON.stringify(log.metadata) : "",
          log.user_id,
          log._id,
        ]),
      ),
    );
  } catch (error) {
    return describe(error, "audit logs");
  }
}
