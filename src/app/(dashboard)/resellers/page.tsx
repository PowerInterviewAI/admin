import type { Metadata } from "next";

import { ListSummary } from "@/components/list-summary";
import { PageHeader } from "@/components/page-header";
import { formatNumber, formatUsd } from "@/lib/format";
import { dashboardSearchParamsSchema, parseSearchParams } from "@/lib/search-params";
import { getResellerOverview } from "@/server/queries/resellers";

import { RangeSelect } from "../range-select";
import { ResellersView } from "./resellers-view";

export const metadata: Metadata = { title: "Resellers" };

export default async function ResellersPage({ searchParams }: PageProps<"/resellers">) {
  const { days } = parseSearchParams(dashboardSearchParamsSchema, await searchParams);
  const rows = await getResellerOverview(days);

  const owed = rows.reduce((sum, row) => sum + row.owed_open_cents, 0);
  const unpriced = rows.reduce((sum, row) => sum + row.unpriced_open_credits, 0);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Resellers"
        description="Partners selling access through their own apps, what they sold, and what they owe."
        actions={<RangeSelect value={days} path="/resellers" />}
      />

      <ListSummary
        stats={[
          { label: "Resellers", value: formatNumber(rows.length) },
          {
            label: "Live keys",
            value: formatNumber(rows.filter((row) => row.key.prefix && row.status === "approved").length),
            hint: "Approved, with a key issued",
          },
          {
            label: "Customers created",
            value: formatNumber(rows.reduce((sum, row) => sum + row.customers, 0)),
            hint: `Last ${days} days`,
          },
          {
            label: "Credits sold",
            value: formatNumber(rows.reduce((sum, row) => sum + row.credits, 0)),
            hint: `Last ${days} days`,
          },
          {
            label: "Owed now",
            value: formatUsd(owed / 100),
            hint: unpriced > 0 ? `Plus ${formatNumber(unpriced)} unpriced credits` : "Open settlements",
            alert: unpriced > 0,
          },
        ]}
      />

      <ResellersView rows={rows} days={days} />
    </div>
  );
}
