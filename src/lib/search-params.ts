import { z } from "zod";

import {
  auditEventGroupSchema,
  auditEventTypeSchema,
  auditStatusSchema,
} from "@/lib/schemas/audit-log";
import { objectIdSchema, sortDirSchema } from "@/lib/schemas/common";
import { emailCampaignStatusSchema } from "@/lib/schemas/email";
import { paymentBucketSchema, paymentPlanSchema, paymentStatusSchema } from "@/lib/schemas/payment";
import { userRoleSchema, userStatusSchema } from "@/lib/schemas/user";
import { SESSION_ACTIVITIES } from "@/lib/session-activity";

/** Shape Next hands a page in its `searchParams` promise. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * Every list view keeps its filters, sort, and page in the URL rather than in component state, so
 * a view is linkable and the browser's back button steps through it. The schemas below `.catch()`
 * every field: a hand-edited or stale URL degrades to the default instead of throwing.
 */
function flatten(raw: RawSearchParams): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined && first !== "") {
      flat[key] = first;
    }
  }
  return flat;
}

export const PAGE_SIZE = 20;
export const AUDIT_LOG_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [20, 25, 50, 100, 200] as const;

const pageSchema = z.coerce.number().int().min(1).catch(1);

/**
 * Rows per page is an allowlist rather than a free integer: it goes straight into a Mongo `limit`,
 * and `?per_page=100000` on a collection this app reads whole would be a denial of service against
 * the admin's own browser.
 */
function perPageSchema(fallback: number) {
  return z.coerce
    .number()
    .int()
    .refine((value) => (PAGE_SIZE_OPTIONS as readonly number[]).includes(value))
    .catch(fallback);
}

/** A calendar date in the URL. The server turns it into a unix-ms bound in the reporting zone. */
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

/**
 * `.optional()` wraps the coercion rather than following it, so an absent key stays `undefined`
 * instead of coercing to `NaN`. A garbage value still lands on `.catch(undefined)`.
 */
const countSchema = z.coerce.number().int().min(0).optional().catch(undefined);
const amountSchema = z.coerce.number().min(0).optional().catch(undefined);

/**
 * A `user_id` reaches these views only from a link, and `toObjectId` throws on anything that is not
 * 24 hex characters - so without this a truncated or hand-edited link renders the error boundary
 * instead of degrading to the default, which is what every other field here does.
 */
const userIdSchema = objectIdSchema.optional().catch(undefined);

/** Tri-state boolean filters travel as yes/no so "unset" stays distinguishable from "false". */
const yesNoSchema = z.enum(["yes", "no"]).optional().catch(undefined);
export type YesNo = z.infer<typeof yesNoSchema>;
export const YES_NO_OPTIONS = ["yes", "no"] as const;

export const usersSearchParamsSchema = z.object({
  q: z.string().optional().catch(undefined),
  role: userRoleSchema.optional().catch(undefined),
  status: userStatusSchema.optional().catch(undefined),
  from: dateSchema,
  to: dateSchema,
  min_credits: countSchema,
  max_credits: countSchema,
  /** Whether the account has a non-empty interview setup - the product's actual activation signal. */
  configured: yesNoSchema,
  // An allowlist, not a raw Mongo field name: sorting on a field the collection does not index
  // just produces a confusingly ordered result set.
  sort_by: z.enum(["created_at", "updated_at", "credits", "username", "email"]).catch("created_at"),
  sort_dir: sortDirSchema.catch("desc"),
  page: pageSchema,
  per_page: perPageSchema(PAGE_SIZE),
});

export const paymentsSearchParamsSchema = z.object({
  q: z.string().optional().catch(undefined),
  status: paymentStatusSchema.optional().catch(undefined),
  /**
   * The quick-filter tabs' dimension. Kept separate from `status` rather than overloading it: three
   * of the four buckets are several statuses, and one of them is not a status at all.
   */
  bucket: paymentBucketSchema.optional().catch(undefined),
  plan: paymentPlanSchema.optional().catch(undefined),
  user_id: userIdSchema,
  from: dateSchema,
  to: dateSchema,
  min_amount: amountSchema,
  max_amount: amountSchema,
  applied: yesNoSchema,
  sort_by: z
    .enum(["created_at", "updated_at", "price_amount", "credits_amount", "status"])
    .catch("created_at"),
  sort_dir: sortDirSchema.catch("desc"),
  page: pageSchema,
  per_page: perPageSchema(PAGE_SIZE),
});

export const sessionsSearchParamsSchema = z.object({
  q: z.string().optional().catch(undefined),
  user_id: userIdSchema,
  from: dateSchema,
  to: dateSchema,
  activity: z.enum(SESSION_ACTIVITIES).optional().catch(undefined),
  sort_by: z.enum(["created_at", "updated_at"]).catch("created_at"),
  sort_dir: sortDirSchema.catch("desc"),
  page: pageSchema,
  per_page: perPageSchema(PAGE_SIZE),
});

export const emailCampaignsSearchParamsSchema = z.object({
  status: emailCampaignStatusSchema.optional().catch(undefined),
  sort_by: z.enum(["created_at", "total"]).catch("created_at"),
  sort_dir: sortDirSchema.catch("desc"),
  page: pageSchema,
});

export const auditLogsSearchParamsSchema = z.object({
  q: z.string().optional().catch(undefined),
  // `auditEventTypeSchema` now includes the `unknown` sentinel (see its docstring), so
  // `?event_type=unknown` parses as that literal instead of falling through `.catch()` - it
  // matches only rows whose real type this app does not recognize, which is a legitimate filter
  // to have typed by hand even though nothing links to it.
  event_type: auditEventTypeSchema.optional().catch(undefined),
  /** A whole family of event types, for the tabs. Composes with `event_type`, which narrows to one. */
  group: auditEventGroupSchema.optional().catch(undefined),
  status: auditStatusSchema.optional().catch(undefined),
  user_id: userIdSchema,
  ip: z.string().optional().catch(undefined),
  from: dateSchema,
  to: dateSchema,
  sort_dir: sortDirSchema.catch("desc"),
  page: pageSchema,
  per_page: perPageSchema(AUDIT_LOG_PAGE_SIZE),
});

/** How many days of history the dashboard aggregates. An allowlist for the same reason as above. */
export const ANALYTICS_RANGES = [7, 30, 90, 180] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = 30;

export const dashboardSearchParamsSchema = z.object({
  // The `transform` is what narrows `number` back to the literal union, so the aggregations - which
  // take an `AnalyticsRange` - cannot be handed an arbitrary window by a hand-edited URL.
  days: z.coerce
    .number()
    .int()
    .refine((value) => (ANALYTICS_RANGES as readonly number[]).includes(value))
    .transform((value) => value as AnalyticsRange)
    .catch(DEFAULT_ANALYTICS_RANGE),
});

export type EmailCampaignsSearchParams = z.infer<typeof emailCampaignsSearchParamsSchema>;
export type UsersSearchParams = z.infer<typeof usersSearchParamsSchema>;
export type PaymentsSearchParams = z.infer<typeof paymentsSearchParamsSchema>;
export type SessionsSearchParams = z.infer<typeof sessionsSearchParamsSchema>;
export type AuditLogsSearchParams = z.infer<typeof auditLogsSearchParamsSchema>;
export type DashboardSearchParams = z.infer<typeof dashboardSearchParamsSchema>;

export function parseSearchParams<T>(schema: z.ZodType<T>, raw: RawSearchParams): T {
  return schema.parse(flatten(raw));
}

/**
 * Serializes a params object back to a query string, omitting anything that equals the schema
 * default so the common view stays at a bare `/users` rather than `/users?page=1&sort_dir=desc`.
 */
export function buildQueryString<T extends z.ZodObject>(
  schema: T,
  params: Partial<z.infer<T>>,
): string {
  const defaults = schema.parse({}) as Record<string, unknown>;
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (value === defaults[key]) continue;
    search.set(key, String(value));
  }

  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Keys that describe *how* a list is paged and ordered rather than which rows it holds. Neither
 * counts as a filter, and neither is cleared by "Reset filters": an admin who chose 100 rows per
 * page wants that choice to survive clearing a search box.
 */
const LAYOUT_KEYS = new Set(["page", "per_page", "sort_by", "sort_dir", "days"]);

/** How many filters are currently narrowing a list, for the reset button's badge. */
export function countActiveFilters(params: Record<string, unknown>): number {
  return Object.entries(params).filter(
    ([key, value]) =>
      !LAYOUT_KEYS.has(key) && value !== undefined && value !== null && value !== "",
  ).length;
}

/**
 * The same params with every filter cleared, keeping sort order and page size.
 *
 * `page` is dropped along with the filters even though it is a layout key, for the same reason
 * `setParams` resets it on any other change: page 5 of the filtered list is not page 5 of the
 * unfiltered one, and landing past the end shows an empty table with rows plainly available.
 */
export function withoutFilters<T extends Record<string, unknown>>(params: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => key !== "page" && LAYOUT_KEYS.has(key)),
  ) as Partial<T>;
}
