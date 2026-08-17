import "server-only";

import type { Document as MongoDocument } from "mongodb";

import type { AnalyticsOverview, DailyAmount, DailyCount } from "@/lib/schemas/analytics";
import { auditLogSchema } from "@/lib/schemas/audit-log";
import { COLLECTIONS, type CollectionName, type Document, currentTimestampMs, getCollection } from "@/server/db";
import { countBy, findMany } from "@/server/repository";

export const ANALYTICS_WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;
const RECENT_ACTIVITY_LIMIT = 20;

/**
 * Node reads `TZ` for both `Intl` and `Date`'s local-time methods, so this and `windowCutoff` can
 * never disagree about where a day starts. Overriding the zone means setting `TZ`, not a new var.
 */
function reportingTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * `created_at`/`updated_at` are unix-ms integers rather than BSON dates, so bucketing by day has
 * to go through `$toDate` inside `$dateToString`; `$dateTrunc` cannot read a raw number.
 *
 * `timezone` is not optional. Without it `$dateToString` buckets by UTC day, which west of
 * Greenwich files an evening's activity under tomorrow - so an admin who signs a user up at 8pm
 * sees the dashboard's rightmost point stay flat.
 */
function dayBucket(field: string): MongoDocument {
  return {
    $dateToString: {
      format: "%Y-%m-%d",
      date: { $toDate: `$${field}` },
      timezone: reportingTimeZone(),
    },
  };
}

/**
 * Local midnight, not a rolling 30x24h from now: the buckets are calendar days, so a cutoff partway
 * through one makes the oldest point a partial day whose height depends on the hour you loaded the
 * page. Counting back `DAYS - 1` keeps today in the window as the 30th day.
 */
function windowCutoff(): number {
  const startOfToday = new Date(currentTimestampMs());
  startOfToday.setHours(0, 0, 0, 0);
  return startOfToday.getTime() - (ANALYTICS_WINDOW_DAYS - 1) * MS_PER_DAY;
}

async function dailyCounts(
  collection: CollectionName,
  match: Document,
  timestampField: string,
): Promise<DailyCount[]> {
  const docs = await getCollection(collection)
    .aggregate<{ _id: string; value: number }>([
      { $match: { ...match, [timestampField]: { $gte: windowCutoff() } } },
      { $group: { _id: dayBucket(timestampField), value: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  return docs.map((doc) => ({ date: doc._id, count: doc.value }));
}

async function dailyAmounts(
  collection: CollectionName,
  match: Document,
  timestampField: string,
  amountField: string,
): Promise<DailyAmount[]> {
  const docs = await getCollection(collection)
    .aggregate<{ _id: string; value: number }>([
      { $match: { ...match, [timestampField]: { $gte: windowCutoff() } } },
      { $group: { _id: dayBucket(timestampField), value: { $sum: `$${amountField}` } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  return docs.map((doc) => ({ date: doc._id, amount: doc.value }));
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

/**
 * Everything here is computed from real documents. `global_state.active_sessions` is deliberately
 * never read: it is a simulated `random.gauss(260, 10)` value in backend, not a usage signal.
 */
export async function getAnalyticsOverview(): Promise<AnalyticsOverview> {
  const finished = { status: "finished" };

  // Eleven independent aggregations. Awaiting them one at a time would make the dashboard as slow
  // as their sum instead of their max.
  const [
    totalUsers,
    usersByRole,
    usersByStatus,
    signupsPerDay,
    revenueTotal,
    revenuePerDay,
    paymentsByStatus,
    creditsOutstanding,
    loginsPerDay,
    auditSignupsPerDay,
    asrSessionsPerDay,
    recentActivity,
  ] = await Promise.all([
    getCollection(COLLECTIONS.users).countDocuments({}),
    countBy(COLLECTIONS.users, "role"),
    countBy(COLLECTIONS.users, "status"),
    dailyCounts(COLLECTIONS.users, {}, "created_at"),
    sumField(COLLECTIONS.payments, finished, "price_amount"),
    dailyAmounts(COLLECTIONS.payments, finished, "updated_at", "price_amount"),
    countBy(COLLECTIONS.payments, "status"),
    sumField(COLLECTIONS.users, {}, "credits"),
    dailyCounts(COLLECTIONS.auditLogs, { event_type: "login" }, "created_at"),
    dailyCounts(COLLECTIONS.auditLogs, { event_type: "signup" }, "created_at"),
    dailyCounts(COLLECTIONS.auditLogs, { event_type: "asr_start" }, "created_at"),
    findMany({
      collection: COLLECTIONS.auditLogs,
      schema: auditLogSchema,
      sort: { created_at: -1 },
      limit: RECENT_ACTIVITY_LIMIT,
    }),
  ]);

  return {
    users: {
      total: totalUsers,
      by_role: usersByRole,
      by_status: usersByStatus,
      signups_per_day: signupsPerDay,
    },
    revenue: {
      total_usd: revenueTotal,
      per_day: revenuePerDay,
      payments_by_status: paymentsByStatus,
    },
    credits_outstanding: Math.round(creditsOutstanding),
    activity: {
      logins_per_day: loginsPerDay,
      signups_per_day: auditSignupsPerDay,
      asr_sessions_per_day: asrSessionsPerDay,
    },
    recent_activity: recentActivity,
  };
}
