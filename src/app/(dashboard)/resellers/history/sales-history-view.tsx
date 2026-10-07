"use client";

import { useMemo } from "react";

import { DataTable } from "@/components/data-table";
import { ExportButton } from "@/components/export-button";
import { FilterTabs } from "@/components/filter-tabs";
import { DateRangeFilter, FilterBar, FilterSelect, SearchInput } from "@/components/filters";
import { saleColumns } from "@/components/reseller-sale-columns";
import { useListParams } from "@/hooks/use-list-params";
import { RESELLER_SALES_TABS, type ListTabCounts } from "@/lib/list-tabs";
import type { Page } from "@/lib/schemas/common";
import {
  LEDGER_KIND_LABELS,
  LEDGER_KINDS,
  type LedgerKind,
  type ResellerLabel,
  type ResellerSaleRow,
} from "@/lib/schemas/reseller";
import {
  type ResellerSalesSearchParams,
  resellerSalesSearchParamsSchema,
} from "@/lib/search-params";
import { exportResellerSalesCsv } from "@/server/actions/exports";

import { ResolveSaleButtons } from "./resolve-sale-buttons";

const HIDDEN_BY_DEFAULT = ["note", "rate"];

export function SalesHistoryView({
  params,
  page,
  tabCounts,
  resellers,
}: {
  params: ResellerSalesSearchParams;
  page: Page<ResellerSaleRow>;
  tabCounts: ListTabCounts;
  resellers: ResellerLabel[];
}) {
  const { setParams, resetFilters, activeFilterCount, isPending } = useListParams(
    resellerSalesSearchParamsSchema,
    params,
  );

  const columns = useMemo(
    () => [
      ...saleColumns(true),
      // Only rows in the review queue have anything to decide; the others render nothing here.
      {
        id: "review",
        cell: ({ row }: { row: { original: ResellerSaleRow } }) => (
          <ResolveSaleButtons sale={row.original} />
        ),
      },
    ],
    [],
  );
  const resellerIds = useMemo(() => resellers.map((reseller) => reseller.id), [resellers]);
  const resellerName = useMemo(
    () => new Map(resellers.map((reseller) => [reseller.id, reseller.name || reseller.email])),
    [resellers],
  );

  const pagination = useMemo(
    () => ({
      page: params.page,
      pageSize: params.per_page,
      total: page.total,
      onPageChange: (next: number) => setParams({ page: next }),
      onPageSizeChange: (next: number) => setParams({ per_page: next }),
    }),
    [page.total, params.page, params.per_page, setParams],
  );

  const sorting = useMemo(
    () => ({
      sortBy: params.sort_by,
      sortDir: params.sort_dir,
      onSortChange: (sortBy: string, sortDir: "asc" | "desc") =>
        setParams({ sort_by: sortBy as ResellerSalesSearchParams["sort_by"], sort_dir: sortDir }),
    }),
    [params.sort_by, params.sort_dir, setParams],
  );

  return (
    <>
      <FilterTabs
        tabs={RESELLER_SALES_TABS}
        params={params}
        counts={tabCounts}
        onSelect={(patch) => setParams(patch)}
      />

      <FilterBar activeCount={activeFilterCount} onReset={resetFilters}>
        <SearchInput
          label="Search sales"
          placeholder="Order reference or customer email..."
          value={params.q}
          onChange={(q) => setParams({ q }, { replace: true })}
          className="max-w-xs"
        />
        <FilterSelect
          label="Filter by reseller"
          allLabel="All resellers"
          value={params.reseller_id}
          options={resellerIds}
          onChange={(reseller_id) => setParams({ reseller_id })}
          formatOption={(id) => resellerName.get(id) ?? id}
          className="w-48"
        />
        <FilterSelect<LedgerKind>
          label="Filter by kind"
          allLabel="Any kind"
          value={params.kind}
          options={LEDGER_KINDS}
          onChange={(kind) => setParams({ kind })}
          formatOption={(kind) => LEDGER_KIND_LABELS[kind]}
          className="w-40"
        />
        <DateRangeFilter
          fromLabel="Sold from"
          toLabel="Sold to"
          from={params.from}
          to={params.to}
          onChange={({ from, to }) => setParams({ from, to })}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={page.items}
        getRowId={(row) => row._id}
        emptyMessage="No sales match these filters."
        isPending={isPending}
        pagination={pagination}
        sorting={sorting}
        defaultHiddenColumns={HIDDEN_BY_DEFAULT}
        toolbar={<ExportButton run={() => exportResellerSalesCsv(params)} />}
      />
    </>
  );
}
