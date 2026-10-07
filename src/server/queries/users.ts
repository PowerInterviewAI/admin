import "server-only";

import type { Filter, Sort } from "mongodb";

import { USERS_TABS } from "@/lib/list-tabs";
import { escapeRegExp } from "@/lib/regex";
import type { UsersSummary } from "@/lib/schemas/analytics";
import type { Page } from "@/lib/schemas/common";
import { type UserPresence, type UserRow, userSchema } from "@/lib/schemas/user";
import type { UsersSearchParams } from "@/lib/search-params";
import {
  COLLECTIONS,
  type Document,
  currentTimestampMs,
  getCollection,
  toObjectId,
} from "@/server/db";
import { countListTabs, countWhere, summarize } from "@/server/queries/list-stats";
import { type LiveState, getRunningInterviews } from "@/server/queries/live";
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

/**
 * The same rule as an aggregation expression, for the summary's count.
 *
 * `$ifNull` is what makes the two agree on a missing field: a query `$nin: ["", null]` does not
 * match a document with no `interview_config` at all, and without the coalesce this expression
 * would compare `missing` to `""` and call the account set up.
 */
const CONFIGURED_EXPR: Document = {
  $or: [
    { $ne: [{ $ifNull: ["$interview_config.full_name", ""] }, ""] },
    { $ne: [{ $ifNull: ["$interview_config.profile_data", ""] }, ""] },
  ],
};

const WEEK_MS = 7 * 24 * 3_600_000;

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
function buildUsersFilter(params: UsersSearchParams, live: LiveState): Filter<Document> {
  const and: Document[] = [];

  if (params.online === "yes") and.push({ _id: { $in: live.userIds } });
  if (params.online === "no") and.push({ _id: { $nin: live.userIds } });

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

/**
 * Which accounts have an app online, and the interview running in each. An account interviewing
 * on two machines at once shows the one that started first.
 */
async function getPresence(live: LiveState): Promise<Map<string, UserPresence>> {
  const running = await getRunningInterviews(live);
  const interviews = new Map<string, UserPresence["interview"]>();
  for (const row of [...running].sort((a, b) => a.started_at - b.started_at)) {
    if (!interviews.has(row.user_id)) {
      interviews.set(row.user_id, { kind: row.kind, started_at: row.started_at });
    }
  }

  return new Map(
    [...live.lastSeen].map(([id, lastSeen]) => [
      id,
      { last_seen_at: lastSeen, interview: interviews.get(id) ?? null },
    ]),
  );
}

export async function listUsers(
  params: UsersSearchParams,
  live: LiveState,
): Promise<Page<UserRow>> {
  const [page, presence] = await Promise.all([
    findPage({
      collection: COLLECTIONS.users,
      schema: userSchema,
      filter: buildUsersFilter(params, live),
      sort: buildUsersSort(params),
      offset: (params.page - 1) * params.per_page,
      limit: params.per_page,
    }),
    getPresence(live),
  ]);

  const counts = await getRelatedCounts(page.items.map((user) => user._id));

  return {
    ...page,
    items: page.items.map((user) => ({
      ...user,
      payment_count: counts.payments.get(user._id) ?? 0,
      session_count: counts.sessions.get(user._id) ?? 0,
      presence: presence.get(user._id) ?? null,
    })),
  };
}

export async function getUsersSummary(
  params: UsersSearchParams,
  live: LiveState,
): Promise<UsersSummary> {
  const weekAgo = currentTimestampMs() - WEEK_MS;

  const summary = await summarize<UsersSummary>({
    collection: COLLECTIONS.users,
    filter: buildUsersFilter(params, live),
    group: {
      total: { $sum: 1 },
      active: countWhere({ $eq: ["$status", "active"] }),
      configured: countWhere(CONFIGURED_EXPR),
      online: countWhere({ $in: ["$_id", live.userIds] }),
      credits: { $sum: "$credits" },
      // A rolling week, not a calendar one: this answers "has anyone signed up lately", where the
      // dashboard's day buckets answer "when", and only the latter needs aligning to a day.
      new_in_week: countWhere({ $gte: [{ $ifNull: ["$created_at", 0] }, weekAgo] }),
    },
    empty: { total: 0, active: 0, configured: 0, online: 0, credits: 0, new_in_week: 0 },
  });

  return { ...summary, credits: Math.round(summary.credits) };
}

export function countUsersTabs(params: UsersSearchParams, live: LiveState) {
  return countListTabs(USERS_TABS, params, (tab) =>
    getCollection(COLLECTIONS.users).countDocuments(buildUsersFilter(tab, live)),
  );
}
