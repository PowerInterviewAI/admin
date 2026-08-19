import { z } from "zod";

import { auditEventTypeSchema, auditStatusSchema } from "@/lib/schemas/audit-log";
import { sortDirSchema } from "@/lib/schemas/common";
import { emailCampaignStatusSchema } from "@/lib/schemas/email";
import { paymentPlanSchema, paymentStatusSchema } from "@/lib/schemas/payment";
import { userRoleSchema, userStatusSchema } from "@/lib/schemas/user";

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

const pageSchema = z.coerce.number().int().min(1).catch(1);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

export const usersSearchParamsSchema = z.object({
  q: z.string().optional().catch(undefined),
  role: userRoleSchema.optional().catch(undefined),
  status: userStatusSchema.optional().catch(undefined),
  // An allowlist, not a raw Mongo field name: sorting on a field the collection does not index
  // just produces a confusingly ordered result set.
  sort_by: z.enum(["created_at", "credits", "username"]).catch("created_at"),
  sort_dir: sortDirSchema.catch("desc"),
  page: pageSchema,
});

export const paymentsSearchParamsSchema = z.object({
  status: paymentStatusSchema.optional().catch(undefined),
  plan: paymentPlanSchema.optional().catch(undefined),
  user_id: z.string().optional().catch(undefined),
  sort_by: z.enum(["created_at", "price_amount"]).catch("created_at"),
  sort_dir: sortDirSchema.catch("desc"),
  page: pageSchema,
});

export const sessionsSearchParamsSchema = z.object({
  user_id: z.string().optional().catch(undefined),
  sort_by: z.enum(["created_at", "updated_at"]).catch("created_at"),
  sort_dir: sortDirSchema.catch("desc"),
  page: pageSchema,
});

export const emailCampaignsSearchParamsSchema = z.object({
  status: emailCampaignStatusSchema.optional().catch(undefined),
  sort_by: z.enum(["created_at", "total"]).catch("created_at"),
  sort_dir: sortDirSchema.catch("desc"),
  page: pageSchema,
});

export const auditLogsSearchParamsSchema = z.object({
  q: z.string().optional().catch(undefined),
  event_type: auditEventTypeSchema.optional().catch(undefined),
  status: auditStatusSchema.optional().catch(undefined),
  user_id: z.string().optional().catch(undefined),
  from: dateSchema,
  to: dateSchema,
  page: pageSchema,
});

export type EmailCampaignsSearchParams = z.infer<typeof emailCampaignsSearchParamsSchema>;
export type UsersSearchParams = z.infer<typeof usersSearchParamsSchema>;
export type PaymentsSearchParams = z.infer<typeof paymentsSearchParamsSchema>;
export type SessionsSearchParams = z.infer<typeof sessionsSearchParamsSchema>;
export type AuditLogsSearchParams = z.infer<typeof auditLogsSearchParamsSchema>;

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

export const PAGE_SIZE = 20;
export const AUDIT_LOG_PAGE_SIZE = 25;
