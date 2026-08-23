import "server-only";

import type { Filter, Sort } from "mongodb";

import { escapeRegExp } from "@/lib/regex";
import type { Page } from "@/lib/schemas/common";
import { type UserRow, userSchema } from "@/lib/schemas/user";
import type { UsersSearchParams } from "@/lib/search-params";
import { COLLECTIONS, type Document, getCollection, toObjectId } from "@/server/db";
import { findPage } from "@/server/repository";
import { dayRangeMs } from "@/server/queries/time";

/**
 * "Configured" means the account has actually been set up for an interview, which is the product's
 * activation signal. Either name or CV counts: a user who pasted a CV but no display name is set
 * up, and `context` alone is not - it is optional in the client.
 */
const CONFIGURED_CLAUSES: Document[] = [
  { "interview_config.full_name": { $nin: ["", null] } },
  { "interview_config.profile_data": { $nin: ["", null] } },
];

/** Payment and session counts for a whole page of users, in two grouped queries rather than 2N. */
async function getRelatedCounts(
  userIds: string[],
): Promise<{ payments: Map<string, number>; sessions: Map<string, number> }> {
  if (userIds.length === 0) {
    return { payments: new Map(), sessions: new Map() };
  }

  const match = { user_id: { $in: userIds.map(toObjectId) } };
  const group = [{ $match: match }, { $group: { _id: "$user_id", count: { $sum: 1 } } }];

  const [payments, sessions] = await Promise.all([
    getCollection(COLLECTIONS.payments).aggregate<{ _id: unknown; count: number }>(group).toArray(),
    getCollection(COLLECTIONS.sessions).aggregate<{ _id: unknown; count: number }>(group).toArray(),
  ]);

  return {
    payments: new Map(payments.map((doc) => [String(doc._id), doc.count])),
    sessions: new Map(sessions.map((doc) => [String(doc._id), doc.count])),
  };
}

/**
 * Clauses go into `$and` rather than onto the filter object directly, because two of them
 * (`q` and `configured`) are each an `$or` and a second assignment to `filter.$or` would silently
 * replace the first - dropping the search term while still looking like it applied.
 */
function buildUsersFilter(params: UsersSearchParams): Filter<Document> {
  const and: Document[] = [];

  if (params.q) {
    const pattern = new RegExp(escapeRegExp(params.q), "i");
    and.push({ $or: [{ username: pattern }, { email: pattern }] });
  }
  if (params.role) and.push({ role: params.role });
  if (params.status) and.push({ status: params.status });

  if (params.configured === "yes") and.push({ $or: CONFIGURED_CLAUSES });
  if (params.configured === "no") and.push({ $nor: CONFIGURED_CLAUSES });

  const credits: Record<string, number> = {};
  if (params.min_credits !== undefined) credits.$gte = params.min_credits;
  if (params.max_credits !== undefined) credits.$lte = params.max_credits;
  if (Object.keys(credits).length > 0) and.push({ credits });

  const joined = dayRangeMs(params.from, params.to);
  if (joined) and.push({ created_at: joined });

  return and.length > 0 ? { $and: and } : {};
}

function buildUsersSort(params: UsersSearchParams): Sort {
  return { [params.sort_by]: params.sort_dir === "desc" ? -1 : 1 };
}

export async function listUsers(params: UsersSearchParams): Promise<Page<UserRow>> {
  const page = await findPage({
    collection: COLLECTIONS.users,
    schema: userSchema,
    filter: buildUsersFilter(params),
    sort: buildUsersSort(params),
    offset: (params.page - 1) * params.per_page,
    limit: params.per_page,
  });

  const counts = await getRelatedCounts(page.items.map((user) => user._id));

  return {
    ...page,
    items: page.items.map((user) => ({
      ...user,
      payment_count: counts.payments.get(user._id) ?? 0,
      session_count: counts.sessions.get(user._id) ?? 0,
    })),
  };
}
