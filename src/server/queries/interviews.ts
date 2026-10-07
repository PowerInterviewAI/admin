import "server-only";

import { INTERVIEWS_TABS } from "@/lib/list-tabs";
import type { InterviewsSummary } from "@/lib/schemas/analytics";
import type { Page } from "@/lib/schemas/common";
import { INTERVIEW_KINDS, type InterviewRow } from "@/lib/schemas/interview";
import type { InterviewsSearchParams } from "@/lib/search-params";
import { COLLECTIONS, type Document, getCollection, toObjectId } from "@/server/db";
import { countListTabs, countWhere } from "@/server/queries/list-stats";
import type { LiveState } from "@/server/queries/live";
import { dayRangeMs } from "@/server/queries/time";
import { getUserLabels } from "@/server/queries/user-labels";
import { findUserIdsMatching } from "@/server/queries/user-search";

const IS_START: Document = { $eq: ["$event_type", "asr_start"] };

/**
 * Every interview matching `params`, as pipeline stages ending in one document per interview.
 *
 * There is no interview collection: an interview is the `asr_start`/`asr_stop` rows sharing a
 * `{user_id, client_session_id}`, grouped first per socket (so a socket can be found open) and then
 * per interview. Its kind and start come from its earliest start, the same row `dailyInterviews`
 * reads, so `?kind=live&from=<window start>` lists what the dashboard's card counted.
 *
 * `running` is the rule `getRunningInterviews` applies: an open socket opened since `runningSince`,
 * on an account with an app online. Anything else still open is `dropped`.
 */
async function interviewStages(
  params: InterviewsSearchParams,
  live: LiveState,
): Promise<Document[]> {
  const events: Document[] = [
    { event_type: { $in: ["asr_start", "asr_stop"] } },
    { "metadata.client_session_id": { $type: "string" } },
  ];
  if (params.user_id) events.push({ user_id: toObjectId(params.user_id) });
  if (params.q) events.push({ user_id: { $in: await findUserIdsMatching(params.q) } });

  const started = dayRangeMs(params.from, params.to);
  // The lower bound narrows the rows before grouping, which is what `dailyInterviews` does: an
  // interview counts from its earliest start inside the window, so one that began the evening
  // before and reconnected after midnight is listed from the reconnect, as the card counted it.
  // The upper bound cannot go here, because an interview's stop can land after `to`.
  if (started?.$gte !== undefined) events.push({ created_at: { $gte: started.$gte } });

  const open = { $gt: ["$starts", "$stops"] };

  const stages: Document[] = [
    { $match: { $and: events } },
    {
      $group: {
        _id: {
          user: "$user_id",
          session: "$metadata.client_session_id",
          socket: "$metadata.asr_session_id",
        },
        starts: { $sum: { $cond: [IS_START, 1, 0] } },
        stops: { $sum: { $cond: [IS_START, 0, 1] } },
        // `$min` and `$max` skip nulls, so these read only the rows of the right type.
        first: {
          $min: {
            $cond: [IS_START, { created_at: "$created_at", kind: "$metadata.kind" }, null],
          },
        },
        stopped: { $max: { $cond: [IS_START, null, "$created_at"] } },
      },
    },
    {
      $group: {
        _id: { user: "$_id.user", session: "$_id.session" },
        first: { $min: "$first" },
        stopped: { $max: "$stopped" },
        sockets: { $sum: 1 },
        open: countWhere(open),
        open_recent: countWhere({
          $and: [open, { $gte: ["$first.created_at", live.runningSince] }],
        }),
      },
    },
    { $match: { "first.kind": { $in: INTERVIEW_KINDS } } },
    {
      $project: {
        _id: 0,
        user_id: "$_id.user",
        client_session_id: "$_id.session",
        kind: "$first.kind",
        started_at: "$first.created_at",
        sockets: 1,
        state: {
          $switch: {
            branches: [
              {
                case: {
                  $and: [{ $gt: ["$open_recent", 0] }, { $in: ["$_id.user", live.userIds] }],
                },
                then: "running",
              },
              { case: { $eq: ["$open", 0] }, then: "ended" },
            ],
            default: "dropped",
          },
        },
        stopped: 1,
      },
    },
    {
      $set: {
        ended_at: { $cond: [{ $eq: ["$state", "ended"] }, "$stopped", null] },
        duration_ms: {
          $switch: {
            branches: [
              {
                case: { $eq: ["$state", "ended"] },
                then: { $subtract: ["$stopped", "$started_at"] },
              },
              {
                case: { $eq: ["$state", "running"] },
                then: { $subtract: [live.now, "$started_at"] },
              },
            ],
            default: null,
          },
        },
      },
    },
  ];

  const after: Document[] = [];
  if (params.kind) after.push({ kind: params.kind });
  if (params.state) after.push({ state: params.state });
  if (started) after.push({ started_at: started });
  if (after.length > 0) stages.push({ $match: { $and: after } });

  return stages;
}

interface InterviewDoc {
  user_id: unknown;
  client_session_id: string;
  kind: InterviewRow["kind"];
  state: InterviewRow["state"];
  started_at: number;
  ended_at: number | null;
  duration_ms: number | null;
  sockets: number;
}

export async function listInterviews(
  params: InterviewsSearchParams,
  live: LiveState,
): Promise<Page<InterviewRow>> {
  const offset = (params.page - 1) * params.per_page;
  const dir = params.sort_dir === "desc" ? -1 : 1;

  const [result] = await getCollection(COLLECTIONS.auditLogs)
    .aggregate<{ items: InterviewDoc[]; total: { count: number }[] }>([
      ...(await interviewStages(params, live)),
      {
        $facet: {
          // `started_at` breaks ties so paging is stable when durations are equal or null.
          items: [
            { $sort: { [params.sort_by]: dir, started_at: dir } },
            { $skip: offset },
            { $limit: params.per_page },
          ],
          total: [{ $count: "count" }],
        },
      },
    ])
    .toArray();

  const docs = result?.items ?? [];
  const labels = await getUserLabels(docs.map((doc) => String(doc.user_id)));

  return {
    items: docs.map((doc) => {
      const userId = String(doc.user_id);
      return {
        id: `${userId}:${doc.client_session_id}`,
        user_id: userId,
        user: labels.get(userId) ?? null,
        client_session_id: doc.client_session_id,
        kind: doc.kind,
        state: doc.state,
        started_at: doc.started_at,
        ended_at: doc.ended_at,
        duration_ms: doc.duration_ms,
        sockets: doc.sockets,
      };
    }),
    total: result?.total[0]?.count ?? 0,
    offset,
    limit: params.per_page,
  };
}

export async function getInterviewsSummary(
  params: InterviewsSearchParams,
  live: LiveState,
): Promise<InterviewsSummary> {
  const [row] = await getCollection(COLLECTIONS.auditLogs)
    .aggregate([
      ...(await interviewStages(params, live)),
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          running: countWhere({ $eq: ["$state", "running"] }),
          live: countWhere({ $eq: ["$kind", "live"] }),
          mock: countWhere({ $eq: ["$kind", "mock"] }),
          // Ended interviews only: a running one's duration is still growing.
          avg_duration_ms: {
            $avg: {
              $cond: [{ $eq: ["$state", "ended"] }, "$duration_ms", null],
            },
          },
        },
      },
    ])
    .toArray();

  return {
    total: row?.total ?? 0,
    running: row?.running ?? 0,
    live: row?.live ?? 0,
    mock: row?.mock ?? 0,
    avg_duration_ms: row?.avg_duration_ms ?? null,
  };
}

export function countInterviewsTabs(params: InterviewsSearchParams, live: LiveState) {
  return countListTabs(INTERVIEWS_TABS, params, async (tab) => {
    const [row] = await getCollection(COLLECTIONS.auditLogs)
      .aggregate<{ count: number }>([...(await interviewStages(tab, live)), { $count: "count" }])
      .toArray();
    return row?.count ?? 0;
  });
}
