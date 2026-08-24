import "server-only";

import type { Filter, Sort } from "mongodb";

import { SESSIONS_TABS } from "@/lib/list-tabs";
import type { SessionsSummary } from "@/lib/schemas/analytics";
import type { Page } from "@/lib/schemas/common";
import { type SessionRow, sessionSchema } from "@/lib/schemas/session";
import type { SessionsSearchParams } from "@/lib/search-params";
import {
  SESSION_ACTIVE_WINDOW_MS,
  SESSION_IDLE_WINDOW_MS,
  type SessionActivity,
  classifySessionActivity,
  lastActiveAt,
} from "@/lib/session-activity";
import {
  COLLECTIONS,
  type Document,
  currentTimestampMs,
  getCollection,
  toObjectId,
} from "@/server/db";
import { countDistinctSet, countListTabs, countWhere, summarize } from "@/server/queries/list-stats";
import { getUserLabels } from "@/server/queries/user-labels";
import { dayRangeMs } from "@/server/queries/time";
import { findUserIdsMatching } from "@/server/queries/user-search";
import { findPage } from "@/server/repository";

/**
 * The same "last seen" rule `lastActiveAt` applies to a row, expressed for the query engine:
 * `updated_at` when backend has touched the session, `created_at` otherwise. Keeping the two in
 * step is what stops the filter and the badge disagreeing about a session backend has not written
 * to since it was created - a real case, since `updated_at` starts null.
 *
 * A session with neither timestamp coalesces to null, and null sorts below every number in BSON, so
 * it fails `$gte` and passes `$lt` - landing on "stale", which is what `classifySessionActivity`
 * decides for the same row.
 */
const LAST_SEEN: Document = { $ifNull: ["$updated_at", "$created_at"] };

function seenExpr(operator: "$gte" | "$lt", cutoff: number): Document {
  return { [operator]: [LAST_SEEN, cutoff] };
}

/**
 * One activity bucket as a bare aggregation expression. The filter wraps it in `$expr` and the
 * summary counts with it directly, so the tab, its count, and the badge on the row cannot drift.
 */
function activityExpr(activity: SessionActivity, now: number): Document {
  const activeCutoff = now - SESSION_ACTIVE_WINDOW_MS;
  const idleCutoff = now - SESSION_IDLE_WINDOW_MS;

  if (activity === "active") return seenExpr("$gte", activeCutoff);
  if (activity === "stale") return seenExpr("$lt", idleCutoff);

  return { $and: [seenExpr("$gte", idleCutoff), seenExpr("$lt", activeCutoff)] };
}

function activityClause(activity: SessionActivity): Document {
  return { $expr: activityExpr(activity, currentTimestampMs()) };
}

async function buildSessionsFilter(params: SessionsSearchParams): Promise<Filter<Document>> {
  const and: Document[] = [];

  if (params.user_id) and.push({ user_id: toObjectId(params.user_id) });
  if (params.activity) and.push(activityClause(params.activity));

  if (params.q) {
    // A session document carries no name or email of its own, so an unresolvable term has to match
    // nothing rather than fall through to every row.
    const owners = await findUserIdsMatching(params.q);
    and.push({ user_id: { $in: owners } });
  }

  const started = dayRangeMs(params.from, params.to);
  if (started) and.push({ created_at: started });

  return and.length > 0 ? { $and: and } : {};
}

function buildSessionsSort(params: SessionsSearchParams): Sort {
  return { [params.sort_by]: params.sort_dir === "desc" ? -1 : 1 };
}

export async function listSessions(params: SessionsSearchParams): Promise<Page<SessionRow>> {
  const page = await findPage({
    collection: COLLECTIONS.sessions,
    schema: sessionSchema,
    filter: await buildSessionsFilter(params),
    sort: buildSessionsSort(params),
    offset: (params.page - 1) * params.per_page,
    limit: params.per_page,
  });

  const labels = await getUserLabels(page.items.map((session) => session.user_id));

  // One clock for the whole page, so two rows a millisecond apart cannot land in different buckets.
  const now = currentTimestampMs();

  return {
    ...page,
    items: page.items.map((session) => {
      const lastActive = lastActiveAt(session);
      return {
        ...session,
        user: labels.get(session.user_id) ?? null,
        last_active_at: lastActive,
        activity: classifySessionActivity(lastActive, now),
      };
    }),
  };
}

export async function getSessionsSummary(params: SessionsSearchParams): Promise<SessionsSummary> {
  // One clock for all three buckets, for the same reason the page takes one: two sessions a
  // millisecond apart must not be counted against different cutoffs.
  const now = currentTimestampMs();

  return summarize<SessionsSummary>({
    collection: COLLECTIONS.sessions,
    filter: await buildSessionsFilter(params),
    group: {
      total: { $sum: 1 },
      active: countWhere(activityExpr("active", now)),
      idle: countWhere(activityExpr("idle", now)),
      stale: countWhere(activityExpr("stale", now)),
      user_ids: { $addToSet: "$user_id" },
    },
    project: {
      total: 1,
      active: 1,
      idle: 1,
      stale: 1,
      users: countDistinctSet("user_ids"),
    },
    empty: { total: 0, active: 0, idle: 0, stale: 0, users: 0 },
  });
}

export function countSessionsTabs(params: SessionsSearchParams) {
  return countListTabs(SESSIONS_TABS, params, async (tab) =>
    getCollection(COLLECTIONS.sessions).countDocuments(await buildSessionsFilter(tab)),
  );
}
