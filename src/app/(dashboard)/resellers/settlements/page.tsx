import type { Metadata } from "next";

import { ListSummary } from "@/components/list-summary";
import { PageHeader } from "@/components/page-header";
import { formatNumber, formatUsd } from "@/lib/format";
import {
  countActiveFilters,
  parseSearchParams,
  resellerSettlementsSearchParamsSchema,
} from "@/lib/search-params";
import { listResellerAccounts } from "@/server/auth/api-keys";
import {
  countResellerSettlementsTabs,
  getResellerSettlementsSummary,
  listResellerSettlements,
} from "@/server/queries/resellers";

import { SettlementsView } from "./settlements-view";

export const metadata: Metadata = { title: "Reseller settlements" };

/**
 * One row per reseller per UTC day, written by backend's settlement worker an hour after the day
 * closes. This page is where an admin collects payment by hand: nothing is sent anywhere.
 */
export default async function ResellerSettlementsPage({
  searchParams,
}: PageProps<"/resellers/settlements">) {
  const params = parseSearchParams(resellerSettlementsSearchParamsSchema, await searchParams);

  const [page, summary, tabCounts, resellers] = await Promise.all([
    listResellerSettlements(params),
    getResellerSettlementsSummary(params),
    countResellerSettlementsTabs(params),
    listResellerAccounts(),
  ]);

  const filtered = countActiveFilters(params) > 0;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Settlements"
        description="What each reseller owes per day (UTC), at the rate each sale was made at. Mark a day paid once collected."
      />

      <ListSummary
        stats={[
          { label: filtered ? "Matching days" : "Days", value: formatNumber(summary.days) },
          { label: "Credits", value: formatNumber(summary.credits) },
          {
            label: "Open",
            value: formatUsd(summary.open_cents / 100),
            hint: "Owed, not yet marked paid",
            alert: summary.open_cents > 0,
          },
          { label: "Paid", value: formatUsd(summary.paid_cents / 100) },
          {
            label: "Unpriced days",
            value: formatNumber(summary.unpriced_days),
            hint: "Credits sold with no rate set",
            alert: summary.unpriced_days > 0,
          },
        ]}
      />

      <SettlementsView
        params={params}
        page={page}
        tabCounts={tabCounts}
        resellers={resellers.map(({ id, name, email }) => ({ id, name, email }))}
      />
    </div>
  );
}
