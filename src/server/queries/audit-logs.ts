import "server-only";

import type { Filter, Sort } from "mongodb";

import { type AuditLog, auditLogSchema } from "@/lib/schemas/audit-log";
import type { Page } from "@/lib/schemas/common";
import { escapeRegExp } from "@/lib/regex";
import type { AuditLogsSearchParams } from "@/lib/search-params";
import { type Document, COLLECTIONS, toObjectId } from "@/server/db";
import { dayRangeMs } from "@/server/queries/time";
import { findUserIdsMatching } from "@/server/queries/user-search";
import { findPage } from "@/server/repository";

/**
 * Matches a typed term against a person, by both halves of how a log can name one.
 *
 * An entry carries its own `email` and, usually, a `user_id`. Neither alone is enough: a failed
 * login or a signup for an account that does not exist has an email and no id, while searching by
 * username has nothing on the log to match at all - the username lives only on the user document.
 * So the term is matched against the log's own email, and separately resolved through `users` to
 * pick up entries whose owner matches by username.
 */
async function userClauses(q: string): Promise<Document[]> {
  const clauses: Document[] = [{ email: new RegExp(escapeRegExp(q), "i") }];

  const owners = await findUserIdsMatching(q);
  if (owners.length > 0) {
    clauses.push({ user_id: { $in: owners } });
  }

  return clauses;
}

async function buildAuditLogsFilter(
  params: AuditLogsSearchParams,
): Promise<Filter<Document>> {
  const and: Document[] = [];

  if (params.event_type) and.push({ event_type: params.event_type });
  if (params.status) and.push({ status: params.status });
  if (params.user_id) and.push({ user_id: toObjectId(params.user_id) });
  if (params.ip) and.push({ ip_address: new RegExp(escapeRegExp(params.ip), "i") });
  if (params.q) and.push({ $or: await userClauses(params.q) });

  const created = dayRangeMs(params.from, params.to);
  if (created) and.push({ created_at: created });

  return and.length > 0 ? { $and: and } : {};
}

function buildAuditLogsSort(params: AuditLogsSearchParams): Sort {
  return { created_at: params.sort_dir === "asc" ? 1 : -1 };
}

export async function listAuditLogs(params: AuditLogsSearchParams): Promise<Page<AuditLog>> {
  return findPage({
    collection: COLLECTIONS.auditLogs,
    schema: auditLogSchema,
    filter: await buildAuditLogsFilter(params),
    sort: buildAuditLogsSort(params),
    offset: (params.page - 1) * params.per_page,
    limit: params.per_page,
  });
}
