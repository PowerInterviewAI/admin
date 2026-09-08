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
import type { AnalyticsRange } from "@/lib/search-params";
import { COLLECTIONS, type CollectionName, type Document, getCollection } from "@/server/db";
import { reportingTimeZone } from "@/server/queries/time";
import { countBy, findMany } from "@/server/repository";

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
  // trial grant never had a payment behind it, and neither does a balance an admin hand-set
  // through the edit sheet. Excluding both is what keeps the figure answering the question its
  // position on the dashboard implies.
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
  ]);

  const newUsers = signupsPerDay.reduce((sum, day) => sum + day.count, 0);
  const windowRevenue = revenuePerDay.reduce((sum, day) => sum + day.amount, 0);

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
