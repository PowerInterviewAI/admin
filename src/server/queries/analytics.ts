import "server-only";

import type { Document as MongoDocument } from "mongodb";

import type {
  AnalyticsOverview,
  DailyAmount,
  DailyCount,
  DailyOutcome,
  HourlyCount,
} from "@/lib/schemas/analytics";
import { auditLogSchema } from "@/lib/schemas/audit-log";
import { globalStateSchema } from "@/lib/schemas/global-state";
import type { AnalyticsRange } from "@/lib/search-params";
import { COLLECTIONS, type CollectionName, type Document, getCollection } from "@/server/db";
import { reportingTimeZone } from "@/server/queries/time";
import { countBy, findMany, findOne } from "@/server/repository";

const RECENT_ACTIVITY_LIMIT = 20;

/**
 * `created_at`/`updated_at` are unix-ms integers rather than BSON dates, so bucketing by day has
 * to go through `$toDate` inside `$dateToString`; `$dateTrunc` cannot read a raw number.
 *
 * `timezone` is not optional. Without it `$dateToString` buckets by UTC day, which west of
 * Greenwich files an evening's activity under tomorrow - so an admin who signs a user up at 8pm
 * sees the dashboard's rightmost point stay flat.
 */
function stringBucket(field: string, format: string): MongoDocument {
  return {
    $dateToString: {
      format,
      date: { $toDate: `$${field}` },
      timezone: reportingTimeZone(),
    },
  };
}

const dayBucket = (field: string) => stringBucket(field, "%Y-%m-%d");
const hourBucket = (field: string) => stringBucket(field, "%H");

function formatDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Every calendar day in the window, oldest first.
 *
 * Stepping with `setDate` rather than adding 86,400,000ms: across a DST change a day is 23 or 25
 * hours long, so fixed-millisecond arithmetic drifts an hour and eventually emits one day twice
 * and skips another. `setDate` moves whole calendar days by definition.
 */
function windowDays(days: number): string[] {
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (days - 1));

  const keys: string[] = [];
  for (let index = 0; index < days; index += 1) {
    keys.push(formatDay(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

/**
 * Local midnight, not a rolling `days` x 24h from now: the buckets are calendar days, so a cutoff
 * partway through one makes the oldest point a partial day whose height depends on the hour you
 * loaded the page. Counting back `days - 1` keeps today in the window as the last day.
 */
function windowCutoff(days: number): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start.getTime();
}

/**
 * A day with no events comes back absent, not zero. Left sparse, an area chart draws a straight
 * line from the day before to the day after and the x-axis spaces its ticks by row rather than by
 * date - so a quiet week renders as a gentle slope instead of a flat line on the floor.
 */
function densify<T extends { date: string }>(
  rows: T[],
  days: number,
  empty: (date: string) => T,
): T[] {
  const found = new Map(rows.map((row) => [row.date, row]));
  return windowDays(days).map((date) => found.get(date) ?? empty(date));
}

async function dailyCounts(
  collection: CollectionName,
  match: Document,
  timestampField: string,
  days: number,
): Promise<DailyCount[]> {
  const docs = await getCollection(collection)
    .aggregate<{ _id: string; value: number }>([
      { $match: { ...match, [timestampField]: { $gte: windowCutoff(days) } } },
      { $group: { _id: dayBucket(timestampField), value: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  return densify(
    docs.map((doc) => ({ date: doc._id, count: doc.value })),
    days,
    (date) => ({ date, count: 0 }),
  );
}

async function dailyAmounts(
  collection: CollectionName,
  match: Document,
  timestampField: string,
  amountField: string,
  days: number,
): Promise<DailyAmount[]> {
  const docs = await getCollection(collection)
    .aggregate<{ _id: string; value: number }>([
      { $match: { ...match, [timestampField]: { $gte: windowCutoff(days) } } },
      { $group: { _id: dayBucket(timestampField), value: { $sum: `$${amountField}` } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  return densify(
    docs.map((doc) => ({ date: doc._id, amount: doc.value })),
    days,
    (date) => ({ date, amount: 0 }),
  );
}

/** Login attempts split by outcome, which is the only place `status: "failure"` is visible at all. */
async function dailyOutcomes(days: number): Promise<DailyOutcome[]> {
  const docs = await getCollection(COLLECTIONS.auditLogs)
    .aggregate<{ _id: { date: string; status: string }; value: number }>([
      {
        $match: {
          event_type: { $in: ["login", "signup"] },
          created_at: { $gte: windowCutoff(days) },
        },
      },
      {
        $group: {
          _id: { date: dayBucket("created_at"), status: "$status" },
          value: { $sum: 1 },
        },
      },
    ])
    .toArray();

  const byDate = new Map<string, DailyOutcome>();
  for (const doc of docs) {
    const row = byDate.get(doc._id.date) ?? { date: doc._id.date, success: 0, failure: 0 };
    if (doc._id.status === "failure") {
      row.failure += doc.value;
    } else {
      row.success += doc.value;
    }
    byDate.set(doc._id.date, row);
  }

  return densify([...byDate.values()], days, (date) => ({ date, success: 0, failure: 0 }));
}

type InterviewKind = "live" | "mock";

/**
 * Interviews per day, by kind, counted by `client_session_id` rather than by socket: a live
 * interview opens two, plus one per reconnect or language switch. Each is bucketed on the day of
 * its first start inside the window and takes its kind from that row, so a reconnect after
 * midnight does not count it twice.
 */
async function dailyInterviews(days: number): Promise<Record<InterviewKind, DailyCount[]>> {
  const docs = await getCollection(COLLECTIONS.auditLogs)
    .aggregate<{ _id: { date: string; kind: InterviewKind }; value: number }>([
      {
        $match: {
          event_type: "asr_start",
          created_at: { $gte: windowCutoff(days) },
          "metadata.client_session_id": { $type: "string" },
        },
      },
      {
        // Documents compare field by field, so `$min` of `{ created_at, kind }` is the earliest
        // start and its kind - without sorting the window first, and without `$top`, which needs
        // MongoDB 5.2. Keyed by user as well, so a client that reused an id cannot merge accounts.
        $group: {
          _id: { user: "$user_id", session: "$metadata.client_session_id" },
          first: { $min: { created_at: "$created_at", kind: "$metadata.kind" } },
        },
      },
      { $replaceWith: "$first" },
      { $match: { kind: { $in: ["live", "mock"] } } },
      {
        $group: {
          _id: { date: dayBucket("created_at"), kind: "$kind" },
          value: { $sum: 1 },
        },
      },
    ])
    .toArray();

  const series = (kind: InterviewKind) =>
    densify(
      docs
        .filter((doc) => doc._id.kind === kind)
        .map((doc) => ({ date: doc._id.date, count: doc.value })),
      days,
      (date) => ({ date, count: 0 }),
    );

  return { live: series("live"), mock: series("mock") };
}

/** A signed-in client pings every 5s, and on a slow link a ping can take up to 10s more. */
const APP_ONLINE_WINDOW_MS = 30_000;

/**
 * Bounds the open-socket scan. Backend's `booted_at` is the real bound - a restart drops every
 * socket without writing its `asr_stop` - and this one only caps the scan on a backend that has
 * been up for weeks. No interview runs for a day.
 */
const RUNNING_LOOKBACK_MS = 24 * 3_600_000;

/**
 * Apps online, and the interviews running in them.
 *
 * A socket is open while it has an `asr_start` and no `asr_stop`. Backend writes the stop even for
 * a killed app or a dead network, within about 40s, so the two rows pair up on every path but a
 * backend restart (excluded by `booted_at`) or a failed write. Requiring the user to have an app
 * online narrows that last case without closing it: the check is per account, not per app, so an
 * orphan start reads as running for up to `RUNNING_LOOKBACK_MS` while that account has any app
 * online. It takes a lost write to get there, which is rare enough to accept.
 */
async function liveNow(): Promise<AnalyticsOverview["now"]> {
  const now = Date.now();

  const [online, state] = await Promise.all([
    getCollection(COLLECTIONS.sessions)
      .aggregate<{ apps: number; users: unknown[] }>([
        { $match: { updated_at: { $gte: now - APP_ONLINE_WINDOW_MS } } },
        { $group: { _id: null, apps: { $sum: 1 }, users: { $addToSet: "$user_id" } } },
      ])
      .toArray(),
    findOne({
      collection: COLLECTIONS.globalState,
      schema: globalStateSchema,
      filter: { singleton_key: "global" },
    }),
  ]);

  const appsOnline = online[0]?.apps ?? 0;
  const onlineUserIds = online[0]?.users ?? [];
  const bootedAt = state?.booted_at ?? 0;
  const isStart = { $eq: ["$event_type", "asr_start"] };

  const running = onlineUserIds.length
    ? await getCollection(COLLECTIONS.auditLogs)
        .aggregate<{ _id: unknown; count: number }>([
          {
            $match: {
              event_type: { $in: ["asr_start", "asr_stop"] },
              created_at: { $gte: Math.max(bootedAt, now - RUNNING_LOOKBACK_MS) },
              user_id: { $in: onlineUserIds },
              "metadata.client_session_id": { $type: "string" },
            },
          },
          {
            $group: {
              _id: "$metadata.asr_session_id",
              starts: { $sum: { $cond: [isStart, 1, 0] } },
              stops: { $sum: { $cond: [isStart, 0, 1] } },
              user: { $first: "$user_id" },
              session: { $first: "$metadata.client_session_id" },
              opened: { $min: { created_at: "$created_at", kind: "$metadata.kind" } },
            },
          },
          { $match: { $expr: { $gt: ["$starts", "$stops"] } } },
          // One interview, one kind: its earliest open socket decides, as its first start does in
          // `dailyInterviews`, so sockets that disagree cannot count it under both.
          {
            $group: {
              _id: { user: "$user", session: "$session" },
              first: { $min: "$opened" },
            },
          },
          { $group: { _id: "$first.kind", count: { $sum: 1 } } },
        ])
        .toArray()
    : [];

  const byKind = new Map(running.map((doc) => [doc._id, doc.count]));
  return {
    apps_online: appsOnline,
    users_online: onlineUserIds.length,
    live_interviews: byKind.get("live") ?? 0,
    mock_interviews: byKind.get("mock") ?? 0,
  };
}

/** When the product is actually used, in the reporting zone. All 24 buckets always present. */
async function hourlyCounts(days: number): Promise<HourlyCount[]> {
  const docs = await getCollection(COLLECTIONS.auditLogs)
    .aggregate<{ _id: string; value: number }>([
      {
        $match: {
          event_type: { $in: ["login", "asr_start"] },
          created_at: { $gte: windowCutoff(days) },
        },
      },
      { $group: { _id: hourBucket("created_at"), value: { $sum: 1 } } },
    ])
    .toArray();

  const found = new Map(docs.map((doc) => [Number(doc._id), doc.value]));
  return Array.from({ length: 24 }, (_, hour) => ({ hour, count: found.get(hour) ?? 0 }));
}

async function sumField(
  collection: CollectionName,
  match: Document,
  field: string,
): Promise<number> {
  const docs = await getCollection(collection)
    .aggregate<{ total: number }>([
      { $match: match },
      { $group: { _id: null, total: { $sum: `$${field}` } } },
    ])
    .toArray();

  return docs[0]?.total ?? 0;
}

/** `$sum` of one field grouped by another, for revenue split by plan. */
async function sumBy(
  collection: CollectionName,
  match: Document,
  groupField: string,
  amountField: string,
): Promise<Record<string, number>> {
  const docs = await getCollection(collection)
    .aggregate<{ _id: unknown; total: number }>([
      { $match: match },
      { $group: { _id: `$${groupField}`, total: { $sum: `$${amountField}` } } },
    ])
    .toArray();

  return Object.fromEntries(
    docs
      .filter((doc) => doc._id !== null && doc._id !== undefined)
      .map((doc) => [String(doc._id), doc.total]),
  );
}

/**
 * How many distinct values a field takes. `countDocuments` would count events; this counts people,
 * which is what "active users" and "paying users" both mean.
 */
async function countDistinct(
  collection: CollectionName,
  match: Document,
  field: string,
): Promise<number> {
  const docs = await getCollection(collection)
    .aggregate<{ count: number }>([
      { $match: { ...match, [field]: { $ne: null } } },
      { $group: { _id: `$${field}` } },
      { $count: "count" },
    ])
    .toArray();

  return docs[0]?.count ?? 0;
}

/**
 * Everything here is computed from real documents. `global_state.active_sessions` is deliberately
 * never read: it is a simulated `random.gauss(260, 10)` value in backend, not a usage signal.
 */
export async function getAnalyticsOverview(days: AnalyticsRange): Promise<AnalyticsOverview> {
  const finished = { status: "finished" };
  // Money sums use this instead of `finished` alone. A partially-paid order is completed by a
  // *second* payment document - a follow-up leg, priced at the remainder and linked back by
  // `root_payment_id` - and backend now marks the root `finished` too once a leg finishes it. Both
  // documents therefore match `finished`, so summing `price_amount` across them bills the
  // remainder twice: a $100 order settled as $60 + $40 would report $140. The root's own
  // `price_amount` is the whole order total by construction, so counting roots alone is the exact
  // figure. (An order completed by a leg *before* backend began advancing the root is the one gap:
  // its root is still `partially_paid` and it now contributes nothing rather than the remainder it
  // used to. Bounded, historical, and in the honest direction for a revenue number.)
  const finishedOrders = { ...finished, root_payment_id: null };
  // `credits_outstanding` reads next to `revenue.total_usd` on the same KPI row, which frames it
  // as a liability against money received. Summed over every user it is not that: a 600-credit
  // trial grant never had a payment behind it, and neither does the balance on a staff account.
  // Excluding both roles is what keeps the figure answering the question its position on the
  // dashboard implies.
  //
  // It excludes accounts, not adjustments - a balance an admin hand-set through the edit sheet on
  // an ordinary `user` account is still counted here, because nothing on the user document says
  // where its credits came from. Netting those out would mean replaying the `credits_adjusted`
  // audit rows `updateUser` now writes, which is a different (and much heavier) query than this
  // one; the trail those rows leave is what that question gets answered from for now.
  const excludingTrialAndAdmin = { role: { $nin: ["trial_user", "admin"] } };
  const cutoff = windowCutoff(days);

  // Independent aggregations, all awaited together: the dashboard costs the slowest of them rather
  // than their sum. Keep additions inside this array.
  const [
    totalUsers,
    usersBeforeWindow,
    usersByRole,
    usersByStatus,
    signupsPerDay,
    revenueTotal,
    revenuePerDay,
    paymentsByStatus,
    revenueByPlan,
    payingUsers,
    totalPayments,
    creditsOutstanding,
    loginsPerDay,
    auditSignupsPerDay,
    asrSessionsPerDay,
    activeUsers,
    loginsByOutcome,
    byHour,
    recentActivity,
    interviewsPerDay,
    now,
  ] = await Promise.all([
    getCollection(COLLECTIONS.users).countDocuments({}),
    getCollection(COLLECTIONS.users).countDocuments({ created_at: { $lt: cutoff } }),
    countBy(COLLECTIONS.users, "role"),
    countBy(COLLECTIONS.users, "status"),
    dailyCounts(COLLECTIONS.users, {}, "created_at", days),
    sumField(COLLECTIONS.payments, finishedOrders, "price_amount"),
    dailyAmounts(COLLECTIONS.payments, finishedOrders, "updated_at", "price_amount", days),
    countBy(COLLECTIONS.payments, "status"),
    sumBy(COLLECTIONS.payments, finishedOrders, "plan", "price_amount"),
    countDistinct(COLLECTIONS.payments, finished, "user_id"),
    getCollection(COLLECTIONS.payments).countDocuments({}),
    sumField(COLLECTIONS.users, excludingTrialAndAdmin, "credits"),
    dailyCounts(COLLECTIONS.auditLogs, { event_type: "login" }, "created_at", days),
    dailyCounts(COLLECTIONS.auditLogs, { event_type: "signup" }, "created_at", days),
    dailyCounts(COLLECTIONS.auditLogs, { event_type: "asr_start" }, "created_at", days),
    countDistinct(COLLECTIONS.auditLogs, { created_at: { $gte: cutoff } }, "user_id"),
    dailyOutcomes(days),
    hourlyCounts(days),
    findMany({
      collection: COLLECTIONS.auditLogs,
      schema: auditLogSchema,
      sort: { created_at: -1 },
      limit: RECENT_ACTIVITY_LIMIT,
    }),
    dailyInterviews(days),
    liveNow(),
  ]);

  const newUsers = signupsPerDay.reduce((sum, day) => sum + day.count, 0);
  const windowRevenue = revenuePerDay.reduce((sum, day) => sum + day.amount, 0);
  const total = (series: DailyCount[]) => series.reduce((sum, day) => sum + day.count, 0);

  // Seeded with everyone who already existed, so the curve continues the real total rather than
  // restarting at zero on the left edge.
  let running = usersBeforeWindow;
  const cumulative = signupsPerDay.map((day) => {
    running += day.count;
    return { date: day.date, count: running };
  });

  return {
    window_days: days,
    users: {
      total: totalUsers,
      new_in_window: newUsers,
      by_role: usersByRole,
      by_status: usersByStatus,
      signups_per_day: signupsPerDay,
      cumulative_per_day: cumulative,
    },
    revenue: {
      total_usd: revenueTotal,
      window_usd: windowRevenue,
      per_day: revenuePerDay,
      payments_by_status: paymentsByStatus,
      by_plan_usd: revenueByPlan,
      paying_users: payingUsers,
      avg_per_paying_user: payingUsers > 0 ? revenueTotal / payingUsers : 0,
      success_rate: totalPayments > 0 ? (paymentsByStatus.finished ?? 0) / totalPayments : 0,
    },
    interviews: {
      live_per_day: interviewsPerDay.live,
      mock_per_day: interviewsPerDay.mock,
      live_in_window: total(interviewsPerDay.live),
      mock_in_window: total(interviewsPerDay.mock),
    },
    now,
    credits_outstanding: Math.round(creditsOutstanding),
    activity: {
      logins_per_day: loginsPerDay,
      signups_per_day: auditSignupsPerDay,
      asr_sessions_per_day: asrSessionsPerDay,
      active_users: activeUsers,
      logins_by_outcome: loginsByOutcome,
      by_hour: byHour,
    },
    recent_activity: recentActivity,
  };
}
