import "server-only";

import type { Document, Filter } from "mongodb";

import { RESELLER_SALES_TABS, RESELLER_SETTLEMENTS_TABS, type ListTabCounts } from "@/lib/list-tabs";
import { escapeRegExp } from "@/lib/regex";
import type { Page } from "@/lib/schemas/common";
import {
  type ResellerCustomer,
  type ResellerLabel,
  type ResellerOverviewRow,
  type ResellerSaleRow,
  type ResellerSettlementRow,
  owedCents,
  resellerCustomerSchema,
  resellerSaleSchema,
  resellerSettlementSchema,
} from "@/lib/schemas/reseller";
import type {
  AnalyticsRange,
  ResellerPortalSearchParams,
  ResellerSalesSearchParams,
  ResellerSettlementsSearchParams,
} from "@/lib/search-params";
import { listResellerAccounts } from "@/server/auth/api-keys";
import { COLLECTIONS, getCollection, toObjectId } from "@/server/db";
import { countListTabs, countWhere, summarize } from "@/server/queries/list-stats";
import { dayRangeMs, startOfLocalDay } from "@/server/queries/time";
import { getUserLabels } from "@/server/queries/user-labels";
import { findPage } from "@/server/repository";

/**
 * Reads over backend's reseller ledger and settlements.
 *
 * **Every sales read is restricted to `state: "committed"`.** Backend reserves a ledger row as
 * `pending` before creating the customer or adding the credits and only commits it afterwards, so a
 * pending row is a request in flight or one that died before its side effect. Showing it would be
 * reporting - and billing - a sale that may never have happened.
 *
 * A reseller's portal calls the same functions with `resellerId` set from their own session, which
 * is the only thing that scopes what they see. It is never taken from the URL.
 */
const COMMITTED = { state: "committed" } as const;

async function getResellerLabels(ids: string[]): Promise<Map<string, ResellerLabel>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const accounts = await listResellerAccounts({ ids: unique });
  return new Map(accounts.map((account) => [account.id, { id: account.id, name: account.name, email: account.email }]));
}

/* --------------------------------------------------------------------------------------------- */
/* Sales (the ledger)                                                                             */
/* --------------------------------------------------------------------------------------------- */

function buildSalesFilter(params: ResellerSalesSearchParams, resellerId?: string): Filter<Document> {
  const and: Document[] = [COMMITTED];

  // The session's own id wins over anything in the URL, so a reseller cannot widen their portal
  // to somebody else's sales with `?reseller_id=`.
  const scopedTo = resellerId ?? params.reseller_id;
  if (scopedTo) and.push({ reseller_id: toObjectId(scopedTo) });
  if (params.kind) and.push({ kind: params.kind });

  const range = dayRangeMs(params.from, params.to);
  if (range) and.push({ committed_at: range });

  if (params.q) {
    const pattern = { $regex: escapeRegExp(params.q.trim()), $options: "i" };
    and.push({ $or: [{ reference: pattern }, { customer_email: pattern }] });
  }

  return { $and: and };
}

export async function listResellerSales(
  params: ResellerSalesSearchParams,
  resellerId?: string,
): Promise<Page<ResellerSaleRow>> {
  const page = await findPage({
    collection: COLLECTIONS.resellerLedger,
    schema: resellerSaleSchema,
    filter: buildSalesFilter(params, resellerId),
    sort: { [params.sort_by]: params.sort_dir === "asc" ? 1 : -1, _id: -1 },
    offset: (params.page - 1) * params.per_page,
    limit: params.per_page,
  });

  const [resellers, users] = await Promise.all([
    getResellerLabels(page.items.map((sale) => sale.reseller_id)),
    getUserLabels(page.items.flatMap((sale) => (sale.user_id ? [sale.user_id] : []))),
  ]);

  return {
    ...page,
    items: page.items.map((sale) => ({
      ...sale,
      reseller: resellers.get(sale.reseller_id) ?? null,
      user: sale.user_id ? (users.get(sale.user_id) ?? null) : null,
    })),
  };
}

export interface ResellerSalesSummary {
  total: number;
  customers_created: number;
  credits: number;
  /** `sum(credits x rate)` over the priced sales; turned into cents once, by `owedCents`. */
  priced_credit_cents: number;
  unpriced_credits: number;
}

export interface ResellerSalesSummaryView extends ResellerSalesSummary {
  owed_cents: number;
}

export async function getResellerSalesSummary(
  params: ResellerSalesSearchParams,
  resellerId?: string,
): Promise<ResellerSalesSummaryView> {
  const hasRate = { $ne: [{ $ifNull: ["$rate_cents_per_hour", null] }, null] };
  const summary = await summarize<ResellerSalesSummary>({
    collection: COLLECTIONS.resellerLedger,
    filter: buildSalesFilter(params, resellerId),
    group: {
      total: { $sum: 1 },
      customers_created: countWhere({ $eq: ["$kind", "user_created"] }),
      credits: { $sum: "$credits" },
      priced_credit_cents: {
        $sum: { $cond: [hasRate, { $multiply: ["$credits", "$rate_cents_per_hour"] }, 0] },
      },
      unpriced_credits: { $sum: { $cond: [hasRate, 0, "$credits"] } },
    },
    empty: { total: 0, customers_created: 0, credits: 0, priced_credit_cents: 0, unpriced_credits: 0 },
  });
  return { ...summary, owed_cents: owedCents(summary.priced_credit_cents) };
}

export async function countResellerSalesTabs(params: ResellerSalesSearchParams): Promise<ListTabCounts> {
  return countListTabs(RESELLER_SALES_TABS, params, (tabParams) =>
    getCollection(COLLECTIONS.resellerLedger).countDocuments(buildSalesFilter(tabParams)),
  );
}

/* --------------------------------------------------------------------------------------------- */
/* Settlements                                                                                    */
/* --------------------------------------------------------------------------------------------- */

/**
 * `day` is a UTC calendar date written by backend ("YYYY-MM-DD"), so the date filter compares the
 * strings directly rather than converting through the reporting zone the rest of the app uses. A
 * settlement day is the unit an invoice is drawn up in, and it is UTC on both ends.
 */
function buildSettlementsFilter(
  params: ResellerSettlementsSearchParams,
  resellerId?: string,
): Filter<Document> {
  const and: Document[] = [];

  const scopedTo = resellerId ?? params.reseller_id;
  if (scopedTo) and.push({ reseller_id: toObjectId(scopedTo) });
  if (params.status) and.push({ status: params.status });
  if (params.from) and.push({ day: { $gte: params.from } });
  if (params.to) and.push({ day: { $lte: params.to } });

  return and.length > 0 ? { $and: and } : {};
}

export async function listResellerSettlements(
  params: ResellerSettlementsSearchParams,
  resellerId?: string,
): Promise<Page<ResellerSettlementRow>> {
  const page = await findPage({
    collection: COLLECTIONS.resellerSettlements,
    schema: resellerSettlementSchema,
    filter: buildSettlementsFilter(params, resellerId),
    sort: { [params.sort_by]: params.sort_dir === "asc" ? 1 : -1, _id: -1 },
    offset: (params.page - 1) * params.per_page,
    limit: params.per_page,
  });

  const resellers = await getResellerLabels(page.items.map((row) => row.reseller_id));
  return {
    ...page,
    items: page.items.map((row) => ({ ...row, reseller: resellers.get(row.reseller_id) ?? null })),
  };
}

export interface ResellerSettlementsSummary {
  days: number;
  credits: number;
  open_cents: number;
  paid_cents: number;
  /** Days whose amount is unknown because some credits were sold without a rate. */
  unpriced_days: number;
}

export async function getResellerSettlementsSummary(
  params: ResellerSettlementsSearchParams,
  resellerId?: string,
): Promise<ResellerSettlementsSummary> {
  const amount = { $ifNull: ["$amount_owed_cents", 0] };
  return summarize<ResellerSettlementsSummary>({
    collection: COLLECTIONS.resellerSettlements,
    filter: buildSettlementsFilter(params, resellerId),
    group: {
      days: { $sum: 1 },
      credits: { $sum: "$credits" },
      open_cents: { $sum: { $cond: [{ $eq: ["$status", "open"] }, amount, 0] } },
      paid_cents: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, amount, 0] } },
      unpriced_days: countWhere({ $eq: [{ $ifNull: ["$amount_owed_cents", null] }, null] }),
    },
    empty: { days: 0, credits: 0, open_cents: 0, paid_cents: 0, unpriced_days: 0 },
  });
}

export async function countResellerSettlementsTabs(
  params: ResellerSettlementsSearchParams,
): Promise<ListTabCounts> {
  return countListTabs(RESELLER_SETTLEMENTS_TABS, params, (tabParams) =>
    getCollection(COLLECTIONS.resellerSettlements).countDocuments(buildSettlementsFilter(tabParams)),
  );
}

/* --------------------------------------------------------------------------------------------- */
/* Overview                                                                                       */
/* --------------------------------------------------------------------------------------------- */

/**
 * One row per reseller account: key, rate, what they sold in the window, and what they owe now.
 * "Owed now" is every open settlement regardless of the window - an invoice does not stop being
 * due because the admin is looking at the last seven days.
 */
export async function getResellerOverview(days: AnalyticsRange): Promise<ResellerOverviewRow[]> {
  const cutoff = startOfLocalDay(days - 1);

  const [accounts, sales, open] = await Promise.all([
    listResellerAccounts(),
    getCollection(COLLECTIONS.resellerLedger)
      .aggregate<{ _id: unknown; customers: number; credits: number; last_sale_at: number | null }>([
        { $match: { ...COMMITTED, committed_at: { $gte: cutoff } } },
        {
          $group: {
            _id: "$reseller_id",
            customers: countWhere({ $eq: ["$kind", "user_created"] }),
            credits: { $sum: "$credits" },
            last_sale_at: { $max: "$committed_at" },
          },
        },
      ])
      .toArray(),
    getCollection(COLLECTIONS.resellerSettlements)
      .aggregate<{ _id: unknown; owed: number; unpriced: number }>([
        { $match: { status: "open" } },
        {
          $group: {
            _id: "$reseller_id",
            owed: { $sum: { $ifNull: ["$amount_owed_cents", 0] } },
            unpriced: { $sum: "$unpriced_credits" },
          },
        },
      ])
      .toArray(),
  ]);

  const salesBy = new Map(sales.map((row) => [String(row._id), row]));
  const openBy = new Map(open.map((row) => [String(row._id), row]));

  return accounts.map((account) => ({
    ...account,
    customers: salesBy.get(account.id)?.customers ?? 0,
    credits: salesBy.get(account.id)?.credits ?? 0,
    last_sale_at: salesBy.get(account.id)?.last_sale_at ?? null,
    owed_open_cents: openBy.get(account.id)?.owed ?? 0,
    unpriced_open_credits: openBy.get(account.id)?.unpriced ?? 0,
  }));
}

/* --------------------------------------------------------------------------------------------- */
/* A reseller's own portal                                                                        */
/* --------------------------------------------------------------------------------------------- */

/**
 * The customers a reseller created. The projection is the point: `users` documents carry the
 * customer's CV and job description (`interview_config`) and a password hash, and neither is read,
 * let alone handed to a reseller.
 */
export async function listResellerCustomers(
  resellerId: string,
  params: ResellerPortalSearchParams,
): Promise<Page<ResellerCustomer>> {
  const and: Document[] = [{ reseller_id: toObjectId(resellerId) }];
  if (params.q) {
    const pattern = { $regex: escapeRegExp(params.q.trim()), $options: "i" };
    and.push({ $or: [{ username: pattern }, { email: pattern }] });
  }

  return findPage({
    collection: COLLECTIONS.users,
    schema: resellerCustomerSchema,
    filter: { $and: and },
    sort: { created_at: -1, _id: -1 },
    offset: (params.page - 1) * params.per_page,
    limit: params.per_page,
    projection: { username: 1, email: 1, credits: 1, status: 1, created_at: 1, updated_at: 1 },
  });
}

export async function countResellerCustomers(resellerId: string): Promise<number> {
  return getCollection(COLLECTIONS.users).countDocuments({ reseller_id: toObjectId(resellerId) });
}

/** The newest committed sale, which is what "last used" honestly means: reads are not recorded. */
export async function lastResellerSaleAt(resellerId: string): Promise<number | null> {
  const doc = await getCollection(COLLECTIONS.resellerLedger).findOne(
    { ...COMMITTED, reseller_id: toObjectId(resellerId) },
    { sort: { committed_at: -1 }, projection: { committed_at: 1 } },
  );
  return typeof doc?.committed_at === "number" ? doc.committed_at : null;
}
