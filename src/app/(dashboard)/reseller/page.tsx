import type { Metadata } from "next";

import { ListSummary } from "@/components/list-summary";
import { PageHeader } from "@/components/page-header";
import { formatNumber, formatRate, formatUsd } from "@/lib/format";
import {
  parseSearchParams,
  resellerPortalSearchParamsSchema,
  resellerSalesSearchParamsSchema,
  resellerSettlementsSearchParamsSchema,
} from "@/lib/search-params";
import { listResellerAccounts, readApiKeyStatus } from "@/server/auth/api-keys";
import { requireAccount } from "@/server/auth/guard";
import {
  countResellerCustomers,
  getResellerSalesSummary,
  getResellerSettlementsSummary,
  lastResellerSaleAt,
  listResellerCustomers,
  listResellerSales,
  listResellerSettlements,
} from "@/server/queries/resellers";

import { ApiKeyCard } from "./api-key-card";
import { IntegrationGuide } from "./integration-guide";
import { ResellerPortalView } from "./reseller-portal-view";

export const metadata: Metadata = { title: "Reseller API" };

/**
 * Everything here is scoped to the signed-in account's own id, taken from the session and never
 * from the URL - so there is no parameter a reseller could change to read somebody else's sales.
 */
export default async function ResellerPortalPage({ searchParams }: PageProps<"/reseller">) {
  const account = await requireAccount();
  const resellerId = account._id;
  const params = parseSearchParams(resellerPortalSearchParamsSchema, await searchParams);

  // The other two tables' params, at their defaults: the portal pages only the table on screen.
  const salesParams = {
    ...resellerSalesSearchParamsSchema.parse({}),
    q: params.view === "sales" ? params.q : undefined,
    page: params.page,
    per_page: params.per_page,
  };
  const settlementParams = {
    ...resellerSettlementsSearchParamsSchema.parse({}),
    page: params.page,
    per_page: params.per_page,
  };
  const allSales = resellerSalesSearchParamsSchema.parse({});

  const [key, lastSaleAt, customerCount, salesSummary, settlementsSummary, info, customers, sales, settlements] =
    await Promise.all([
      readApiKeyStatus(resellerId),
      lastResellerSaleAt(resellerId),
      countResellerCustomers(resellerId),
      getResellerSalesSummary(allSales, resellerId),
      getResellerSettlementsSummary(resellerSettlementsSearchParamsSchema.parse({}), resellerId),
      listResellerAccounts({ ids: [resellerId] }),
      params.view === "customers" ? listResellerCustomers(resellerId, params) : null,
      params.view === "sales" ? listResellerSales(salesParams, resellerId) : null,
      params.view === "settlements" ? listResellerSettlements(settlementParams, resellerId) : null,
    ]);

  const rate = info[0]?.rate_cents_per_hour ?? null;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Reseller API"
        description="Your API key, the customers your app has created, and what you have sold."
      />

      <ListSummary
        stats={[
          { label: "Customers", value: formatNumber(customerCount) },
          { label: "Credits sold", value: formatNumber(salesSummary.credits), hint: "All time" },
          { label: "Sales", value: formatNumber(salesSummary.total), hint: "Creates and top-ups" },
          { label: "Your rate", value: formatRate(rate), hint: "Set by Power Interview AI" },
          {
            label: "Open balance",
            value: formatUsd(settlementsSummary.open_cents / 100),
            hint: "Settled days not yet paid",
          },
        ]}
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <ApiKeyCard status={key} lastSaleAt={lastSaleAt} />
        <IntegrationGuide />
      </div>

      <ResellerPortalView
        params={params}
        counts={{
          customers: customerCount,
          sales: salesSummary.total,
          settlements: settlementsSummary.days,
        }}
        customers={customers}
        sales={sales}
        settlements={settlements}
      />
    </div>
  );
}
