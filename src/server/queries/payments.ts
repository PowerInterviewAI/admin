import "server-only";

import type { Filter, Sort } from "mongodb";

import { escapeRegExp } from "@/lib/regex";
import type { Page } from "@/lib/schemas/common";
import { type PaymentRow, paymentSchema } from "@/lib/schemas/payment";
import type { PaymentsSearchParams } from "@/lib/search-params";
import { COLLECTIONS, type Document, toObjectId } from "@/server/db";
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

async function buildPaymentsFilter(
  params: PaymentsSearchParams,
): Promise<Filter<Document>> {
  const and: Document[] = [];

  if (params.status) and.push({ status: params.status });
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
