"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";

import { DataTable } from "@/components/data-table";
import { FilterTabs } from "@/components/filter-tabs";
import { FilterBar, SearchInput } from "@/components/filters";
import { saleColumns } from "@/components/reseller-sale-columns";
import { settlementColumns } from "@/components/reseller-settlement-columns";
import { Badge } from "@/components/ui/badge";
import { useListParams } from "@/hooks/use-list-params";
import { formatDate, formatNumber, titleCase } from "@/lib/format";
import { RESELLER_PORTAL_TABS } from "@/lib/list-tabs";
import type { Page } from "@/lib/schemas/common";
import type {
  ResellerCustomer,
  ResellerSaleRow,
  ResellerSettlementRow,
} from "@/lib/schemas/reseller";
import {
  type ResellerPortalSearchParams,
  resellerPortalSearchParamsSchema,
} from "@/lib/search-params";

const customerColumns: ColumnDef<ResellerCustomer, unknown>[] = [
  { accessorKey: "username", header: "Name" },
  { accessorKey: "email", header: "Email" },
  {
    accessorKey: "credits",
    header: "Credits left",
    cell: ({ row }) => formatNumber(row.original.credits),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={row.original.status === "active" ? "secondary" : "outline"}>
        {titleCase(row.original.status)}
      </Badge>
    ),
  },
  {
    accessorKey: "created_at",
    header: "Created",
    cell: ({ row }) => formatDate(row.original.created_at),
  },
];

export function ResellerPortalView({
  params,
  counts,
  customers,
  sales,
  settlements,
}: {
  params: ResellerPortalSearchParams;
  counts: Record<ResellerPortalSearchParams["view"], number>;
  customers: Page<ResellerCustomer> | null;
  sales: Page<ResellerSaleRow> | null;
  settlements: Page<ResellerSettlementRow> | null;
}) {
  const { setParams, resetFilters, activeFilterCount, isPending } = useListParams(
    resellerPortalSearchParamsSchema,
    params,
  );

  const sales_ = useMemo(() => saleColumns(false), []);
  const settlements_ = useMemo(() => settlementColumns(false), []);

  const total =
    (params.view === "customers" ? customers?.total : params.view === "sales" ? sales?.total : settlements?.total) ?? 0;

  const pagination = useMemo(
    () => ({
      page: params.page,
      pageSize: params.per_page,
      total,
      onPageChange: (next: number) => setParams({ page: next }),
      onPageSizeChange: (next: number) => setParams({ per_page: next }),
    }),
    [total, params.page, params.per_page, setParams],
  );

  return (
    <>
      <FilterTabs
        tabs={RESELLER_PORTAL_TABS}
        params={params}
        counts={counts}
        // A different table, so the search typed for the last one does not carry over.
        onSelect={(patch) => setParams({ ...patch, q: undefined })}
      />

      {params.view !== "settlements" && (
        // Keyed by view so switching tables remounts the uncontrolled search box empty.
        <FilterBar key={params.view} activeCount={activeFilterCount} onReset={resetFilters}>
          <SearchInput
            label={params.view === "customers" ? "Search customers" : "Search sales"}
            placeholder={
              params.view === "customers" ? "Name or email..." : "Order reference or email..."
            }
            value={params.q}
            onChange={(q) => setParams({ q }, { replace: true })}
            className="max-w-xs"
          />
        </FilterBar>
      )}

      {params.view === "customers" && customers && (
        <DataTable
          columns={customerColumns}
          data={customers.items}
          getRowId={(row) => row._id}
          emptyTitle="No customers yet"
          emptyMessage="Customers your app creates through the API appear here."
          isPending={isPending}
          pagination={pagination}
        />
      )}

      {params.view === "sales" && sales && (
        <DataTable
          columns={sales_}
          data={sales.items}
          getRowId={(row) => row._id}
          emptyTitle="No sales yet"
          emptyMessage="Every customer you create and every top-up is recorded here."
          isPending={isPending}
          pagination={pagination}
          defaultHiddenColumns={["note"]}
        />
      )}

      {params.view === "settlements" && settlements && (
        <DataTable
          columns={settlements_}
          data={settlements.items}
          getRowId={(row) => row._id}
          emptyTitle="Nothing settled yet"
          emptyMessage="Each day's total is settled an hour after the day ends (UTC)."
          isPending={isPending}
          pagination={pagination}
        />
      )}
    </>
  );
}
