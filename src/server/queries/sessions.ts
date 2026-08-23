import "server-only";

import type { Filter, Sort } from "mongodb";

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
import { COLLECTIONS, type Document, currentTimestampMs, toObjectId } from "@/server/db";
import { getUserLabels } from "@/server/queries/user-labels";
import { dayRangeMs } from "@/server/queries/time";
import { findUserIdsMatching } from "@/server/queries/user-search";
import { findPage } from "@/server/repository";

/**
 * The same "last seen" rule `lastActiveAt` applies to a row, expressed for the query engine:
 * `updated_at` when backend has touched the session, `created_at` otherwise. Keeping the two in
 * step is what stops the filter and the badge disagreeing about a session backend has not written
 * to since it was created - a real case, since `updated_at` starts null.
 */
function lastActiveExpr(operator: "$gte" | "$lt", cutoff: number): Document {
  return { $expr: { [operator]: [{ $ifNull: ["$updated_at", "$created_at"] }, cutoff] } };
}

function activityClause(activity: SessionActivity): Document {
  const now = currentTimestampMs();
  const activeCutoff = now - SESSION_ACTIVE_WINDOW_MS;
  const idleCutoff = now - SESSION_IDLE_WINDOW_MS;

  if (activity === "active") return lastActiveExpr("$gte", activeCutoff);
  if (activity === "stale") return lastActiveExpr("$lt", idleCutoff);

  return { $and: [lastActiveExpr("$gte", idleCutoff), lastActiveExpr("$lt", activeCutoff)] };
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
