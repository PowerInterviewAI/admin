import "server-only";

import type { Filter } from "mongodb";

import type { Page } from "@/lib/schemas/common";
import { type PaymentRow, paymentSchema } from "@/lib/schemas/payment";
import { PAGE_SIZE, type PaymentsSearchParams } from "@/lib/search-params";
import { COLLECTIONS, type Document, toObjectId } from "@/server/db";
import { getUserLabels } from "@/server/queries/user-labels";
import { findPage } from "@/server/repository";

export async function listPayments(params: PaymentsSearchParams): Promise<Page<PaymentRow>> {
  const filter: Filter<Document> = {};

  if (params.status) filter.status = params.status;
  if (params.plan) filter.plan = params.plan;
  if (params.user_id) filter.user_id = toObjectId(params.user_id);

  const page = await findPage({
    collection: COLLECTIONS.payments,
    schema: paymentSchema,
    filter,
    sort: { [params.sort_by]: params.sort_dir === "desc" ? -1 : 1 },
    offset: (params.page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
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
