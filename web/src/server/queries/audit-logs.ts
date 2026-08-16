import "server-only";

import type { Filter } from "mongodb";

import { type AuditLog, auditLogSchema } from "@/lib/schemas/audit-log";
import type { Page } from "@/lib/schemas/common";
import { AUDIT_LOG_PAGE_SIZE, type AuditLogsSearchParams } from "@/lib/search-params";
import { COLLECTIONS, type Document, toObjectId } from "@/server/db";
import { findPage } from "@/server/repository";

const MS_PER_DAY = 86_400_000;

/** `from`/`to` are calendar dates in the URL; the stored field is unix ms, `to` inclusive. */
function createdAtRange(from?: string, to?: string): Record<string, number> | undefined {
  const range: Record<string, number> = {};
  if (from) range.$gte = Date.parse(`${from}T00:00:00.000Z`);
  if (to) range.$lte = Date.parse(`${to}T00:00:00.000Z`) + MS_PER_DAY - 1;
  return Object.keys(range).length > 0 ? range : undefined;
}

export async function listAuditLogs(params: AuditLogsSearchParams): Promise<Page<AuditLog>> {
  const filter: Filter<Document> = {};

  if (params.event_type) filter.event_type = params.event_type;
  if (params.status) filter.status = params.status;
  if (params.user_id) filter.user_id = toObjectId(params.user_id);

  const range = createdAtRange(params.from, params.to);
  if (range) filter.created_at = range;

  return findPage({
    collection: COLLECTIONS.auditLogs,
    schema: auditLogSchema,
    filter,
    sort: { created_at: -1 },
    offset: (params.page - 1) * AUDIT_LOG_PAGE_SIZE,
    limit: AUDIT_LOG_PAGE_SIZE,
  });
}
