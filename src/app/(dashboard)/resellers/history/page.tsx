import type { Metadata } from "next";

import { ListSummary } from "@/components/list-summary";
import { PageHeader } from "@/components/page-header";
import { formatGrant, formatNumber, formatUsd } from "@/lib/format";
import {
  countActiveFilters,
  parseSearchParams,
  resellerSalesSearchParamsSchema,
} from "@/lib/search-params";
import { listResellerAccounts } from "@/server/auth/api-keys";
import {
  countResellerSalesTabs,
  getResellerSalesSummary,
  listResellerSales,
} from "@/server/queries/resellers";

import { SalesHistoryView } from "./sales-history-view";

export const metadata: Metadata = { title: "Reseller sales" };

export default async function ResellerHistoryPage({
  searchParams,
}: PageProps<"/resellers/history">) {
  const params = parseSearchParams(resellerSalesSearchParamsSchema, await searchParams);

  const [page, summary, tabCounts, resellers] = await Promise.all([
    listResellerSales(params),
    getResellerSalesSummary(params),
    countResellerSalesTabs(params),
    listResellerAccounts(),
  ]);

  const filtered = countActiveFilters(params) > 0;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Sales history"
        description="Every customer created and every extension, across all resellers, as their apps reported them."
      />

      <ListSummary
        stats={[
          { label: filtered ? "Matching sales" : "Sales", value: formatNumber(summary.total) },
          { label: "New customers", value: formatNumber(summary.customers_created) },
          {
            label: "Days sold",
            value: formatNumber(summary.days),
            hint: summary.credits > 0 ? `Plus ${formatNumber(summary.credits)} legacy credits` : undefined,
          },
          {
            // The review queue is not billed, so its figure is what it would come to, not a charge.
            label: params.state === "unresolved" ? "If billed" : "Billable",
            value: formatUsd(summary.owed_cents / 100),
            hint:
              params.state === "unresolved"
                ? "Only if an admin confirms they were applied"
                : "Days x each sale's monthly rate / 30. Settlements round per day",
          },
          {
            label: "Unpriced",
            value: formatGrant(summary.unpriced_days, summary.unpriced_credits),
            hint: "Sold while the reseller had no rate",
            alert: summary.unpriced_days + summary.unpriced_credits > 0,
          },
        ]}
      />

      <SalesHistoryView
        params={params}
        page={page}
        tabCounts={tabCounts}
        resellers={resellers.map(({ id, name, email }) => ({ id, name, email }))}
      />
    </div>
  );
}
