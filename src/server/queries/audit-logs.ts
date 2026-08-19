import "server-only";

import type { Filter } from "mongodb";

import { type AuditLog, auditLogSchema } from "@/lib/schemas/audit-log";
import type { Page } from "@/lib/schemas/common";
import { escapeRegExp } from "@/lib/regex";
import { AUDIT_LOG_PAGE_SIZE, type AuditLogsSearchParams } from "@/lib/search-params";
import { COLLECTIONS, type Document, getCollection, toObjectId } from "@/server/db";
import { findPage } from "@/server/repository";

const MS_PER_DAY = 86_400_000;

/**
 * Ceiling on how many users one search term may resolve to before the `$in` stops being worth
 * building. A term broad enough to match more accounts than this is not a search for a person.
 */
const USER_MATCH_LIMIT = 500;

/** `from`/`to` are calendar dates in the URL; the stored field is unix ms, `to` inclusive. */
function createdAtRange(from?: string, to?: string): Record<string, number> | undefined {
  const range: Record<string, number> = {};
  if (from) range.$gte = Date.parse(`${from}T00:00:00.000Z`);
  if (to) range.$lte = Date.parse(`${to}T00:00:00.000Z`) + MS_PER_DAY - 1;
  return Object.keys(range).length > 0 ? range : undefined;
}

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
  const pattern = new RegExp(escapeRegExp(q), "i");
  const clauses: Document[] = [{ email: pattern }];

  const owners = await getCollection(COLLECTIONS.users)
    .find({ $or: [{ username: pattern }, { email: pattern }] }, { projection: { _id: 1 } })
    .limit(USER_MATCH_LIMIT)
    .toArray();

  if (owners.length > 0) {
    clauses.push({ user_id: { $in: owners.map((owner) => owner._id) } });
  }

  return clauses;
}

export async function listAuditLogs(params: AuditLogsSearchParams): Promise<Page<AuditLog>> {
  const filter: Filter<Document> = {};

  if (params.event_type) filter.event_type = params.event_type;
  if (params.status) filter.status = params.status;
  if (params.user_id) filter.user_id = toObjectId(params.user_id);
  if (params.q) filter.$or = await userClauses(params.q);

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
