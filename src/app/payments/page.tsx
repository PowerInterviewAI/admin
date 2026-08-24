import type { Metadata } from "next";

import { ListSummary, shareOf } from "@/components/list-summary";
import { PageHeader } from "@/components/page-header";
import { formatNumber, formatUsd } from "@/lib/format";
import {
  countActiveFilters,
  parseSearchParams,
  paymentsSearchParamsSchema,
} from "@/lib/search-params";
import { countPaymentsTabs, getPaymentsSummary, listPayments } from "@/server/queries/payments";

import { PaymentsView } from "./payments-view";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const params = parseSearchParams(paymentsSearchParamsSchema, await searchParams);

  const [page, summary, tabCounts] = await Promise.all([
    listPayments(params),
    getPaymentsSummary(params),
    countPaymentsTabs(params),
  ]);

  const filtered = countActiveFilters(params) > 0;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Payments"
        description="Every payment record, with manual status overrides."
      />

      <ListSummary
        stats={[
          {
            label: filtered ? "Matching payments" : "Total payments",
            value: formatNumber(summary.total),
          },
          {
            label: "Revenue",
            value: formatUsd(summary.revenue_usd),
            hint: "Finished payments only",
          },
          {
            label: "Finished",
            value: formatNumber(summary.finished),
            hint: shareOf(summary.finished, summary.total),
          },
          {
            label: "In flight",
            value: formatNumber(summary.in_flight),
            hint: "Not settled either way",
          },
          {
            label: "Credits owed",
            value: formatNumber(summary.credits_owed),
            hint: "Finished, credits never granted",
            alert: summary.credits_owed > 0,
          },
        ]}
      />

      <PaymentsView params={params} page={page} tabCounts={tabCounts} />
    </div>
  );
}
