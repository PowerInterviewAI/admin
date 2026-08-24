import "server-only";

import type { Filter, Sort } from "mongodb";

import { AUDIT_LOGS_TABS } from "@/lib/list-tabs";
import type { AuditLogsSummary } from "@/lib/schemas/analytics";
import { AUDIT_EVENT_GROUPS, type AuditLog, auditLogSchema } from "@/lib/schemas/audit-log";
import type { Page } from "@/lib/schemas/common";
import { escapeRegExp } from "@/lib/regex";
import type { AuditLogsSearchParams } from "@/lib/search-params";
import { type Document, COLLECTIONS, getCollection, toObjectId } from "@/server/db";
import { countDistinctSet, countListTabs, countWhere, summarize } from "@/server/queries/list-stats";
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
  if (params.group) and.push({ event_type: { $in: AUDIT_EVENT_GROUPS[params.group] } });
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

export async function getAuditLogsSummary(
  params: AuditLogsSearchParams,
): Promise<AuditLogsSummary> {
  return summarize<AuditLogsSummary>({
    collection: COLLECTIONS.auditLogs,
    filter: await buildAuditLogsFilter(params),
    group: {
      total: { $sum: 1 },
      failures: countWhere({ $eq: ["$status", "failure"] }),
      // `$max` over the filtered set rather than the newest row on screen, which is only the newest
      // in the window when the table is sorted newest-first and sitting on page one.
      latest: { $max: "$created_at" },
      user_ids: { $addToSet: "$user_id" },
      ip_addresses: { $addToSet: "$ip_address" },
    },
    project: {
      total: 1,
      failures: 1,
      latest: 1,
      users: countDistinctSet("user_ids"),
      ips: countDistinctSet("ip_addresses"),
    },
    empty: { total: 0, failures: 0, users: 0, ips: 0, latest: null },
  });
}

export function countAuditLogsTabs(params: AuditLogsSearchParams) {
  return countListTabs(AUDIT_LOGS_TABS, params, async (tab) =>
    getCollection(COLLECTIONS.auditLogs).countDocuments(await buildAuditLogsFilter(tab)),
  );
}
