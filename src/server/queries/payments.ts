import "server-only";

import type { Filter, Sort } from "mongodb";

import { PAYMENTS_TABS } from "@/lib/list-tabs";
import { escapeRegExp } from "@/lib/regex";
import type { PaymentsSummary } from "@/lib/schemas/analytics";
import type { Page } from "@/lib/schemas/common";
import {
  PAYMENT_STATUS_BUCKETS,
  type PaymentBucket,
  type PaymentRow,
  paymentSchema,
} from "@/lib/schemas/payment";
import type { PaymentsSearchParams } from "@/lib/search-params";
import { COLLECTIONS, type Document, getCollection, toObjectId } from "@/server/db";
import { countListTabs, countWhere, summarize } from "@/server/queries/list-stats";
import { getUserLabels } from "@/server/queries/user-labels";
import { dayRangeMs } from "@/server/queries/time";
import { findUserIdsMatching } from "@/server/queries/user-search";
import { findPage } from "@/server/repository";

/**
 * A payment names itself three ways depending on where the admin copied the reference from: the
 * order id this app generated, NOWPayments' own id from the webhook, and the purchase id on a
 * top-up. All three are matched, alongside the buyer, so one box handles "find this payment" and
 * "find this person's payments" without the admin having to know which they hold.
 */
async function searchClauses(q: string): Promise<Document[]> {
  const pattern = new RegExp(escapeRegExp(q), "i");
  const clauses: Document[] = [
    { order_id: pattern },
    { payment_id: pattern },
    { purchase_id: pattern },
  ];

  const owners = await findUserIdsMatching(q);
  if (owners.length > 0) {
    clauses.push({ user_id: { $in: owners } });
  }

  return clauses;
}

/**
 * `unapplied` is a finished *order* whose credits were never granted, so it is a clause rather than
 * a status list. Kept here beside the status buckets so the tab, its count, and the summary's
 * "credits owed" figure cannot come to mean three different things.
 */
function bucketClause(bucket: PaymentBucket): Document {
  if (bucket === "unapplied") {
    // `root_payment_id: null` matches a missing field as well as an explicit null, so this is
    // "roots only" and picks up documents written before the field existed. It mirrors
    // `UNAPPLIED_EXPR`, which the summary counts with - see there for why a follow-up leg is
    // never something credits can be owed for.
    return {
      status: { $in: PAYMENT_STATUS_BUCKETS.finished },
      credits_applied: { $ne: true },
      root_payment_id: null,
    };
  }
  return { status: { $in: PAYMENT_STATUS_BUCKETS[bucket] } };
}

async function buildPaymentsFilter(
  params: PaymentsSearchParams,
): Promise<Filter<Document>> {
  const and: Document[] = [];

  if (params.status) and.push({ status: params.status });
  if (params.bucket) and.push(bucketClause(params.bucket));
  if (params.plan) and.push({ plan: params.plan });
  if (params.user_id) and.push({ user_id: toObjectId(params.user_id) });
  if (params.applied) and.push({ credits_applied: params.applied === "yes" });
  if (params.q) and.push({ $or: await searchClauses(params.q) });

  const amount: Record<string, number> = {};
  if (params.min_amount !== undefined) amount.$gte = params.min_amount;
  if (params.max_amount !== undefined) amount.$lte = params.max_amount;
  if (Object.keys(amount).length > 0) and.push({ price_amount: amount });

  const created = dayRangeMs(params.from, params.to);
  if (created) and.push({ created_at: created });

  return and.length > 0 ? { $and: and } : {};
}

function buildPaymentsSort(params: PaymentsSearchParams): Sort {
  return { [params.sort_by]: params.sort_dir === "desc" ? -1 : 1 };
}

export async function listPayments(params: PaymentsSearchParams): Promise<Page<PaymentRow>> {
  const page = await findPage({
    collection: COLLECTIONS.payments,
    schema: paymentSchema,
    filter: await buildPaymentsFilter(params),
    sort: buildPaymentsSort(params),
    offset: (params.page - 1) * params.per_page,
    limit: params.per_page,
  });

  const labels = await getUserLabels(page.items.map((payment) => payment.user_id));

  return {
    ...page,
    items: page.items.map((payment) => ({
      ...payment,
      user: labels.get(payment.user_id) ?? null,
    })),
  };
}

/** Aggregation-expression forms of the two clauses above, so the strip and the tabs agree. */
const FINISHED_EXPR: Document = { $in: ["$status", PAYMENT_STATUS_BUCKETS.finished] };
/**
 * Revenue counts finished *orders*, not finished payment documents. A partially-paid order is
 * completed by a follow-up leg priced at the remainder, and backend marks the root `finished` too
 * once that leg lands - so summing `price_amount` over everything `finished` bills the remainder
 * twice. The root's `price_amount` is the whole order total, so roots alone is the exact figure.
 * See the matching note in `analytics.ts`.
 */
const FINISHED_ORDER_EXPR: Document = {
  $and: [FINISHED_EXPR, { $eq: [{ $ifNull: ["$root_payment_id", null] }, null] }],
};
/**
 * Built on `FINISHED_ORDER_EXPR`, not on `FINISHED_EXPR`, for the same root-vs-leg reason revenue
 * is: backend claims an order's credits against its *root* document and never writes
 * `credits_applied` onto the follow-up leg that completed it. A leg therefore sits at `finished`
 * with `credits_applied` false permanently, and counting it here reported every successfully
 * settled partial payment as an order somebody is still owed credits for - a KPI that alerts (see
 * `payments/page.tsx`) and a tab that lists rows no admin can ever action, because there is
 * nothing wrong with them. Restricting to roots is exact rather than merely quieter: a root whose
 * grant genuinely failed still carries `credits_applied` false and is still counted, whether the
 * order was paid in one leg or several.
 */
const UNAPPLIED_EXPR: Document = {
  $and: [FINISHED_ORDER_EXPR, { $ne: [{ $ifNull: ["$credits_applied", false] }, true] }],
};

export async function getPaymentsSummary(params: PaymentsSearchParams): Promise<PaymentsSummary> {
  return summarize<PaymentsSummary>({
    collection: COLLECTIONS.payments,
    filter: await buildPaymentsFilter(params),
    group: {
      total: { $sum: 1 },
      revenue_usd: { $sum: { $cond: [FINISHED_ORDER_EXPR, { $ifNull: ["$price_amount", 0] }, 0] } },
      finished: countWhere(FINISHED_EXPR),
      in_flight: countWhere({ $in: ["$status", PAYMENT_STATUS_BUCKETS.in_flight] }),
      credits_owed: countWhere(UNAPPLIED_EXPR),
    },
    empty: { total: 0, revenue_usd: 0, finished: 0, in_flight: 0, credits_owed: 0 },
  });
}

export function countPaymentsTabs(params: PaymentsSearchParams) {
  return countListTabs(PAYMENTS_TABS, params, async (tab) =>
    getCollection(COLLECTIONS.payments).countDocuments(await buildPaymentsFilter(tab)),
  );
}
