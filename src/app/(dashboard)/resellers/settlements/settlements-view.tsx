"use client";

import { useMemo } from "react";

import { DataTable } from "@/components/data-table";
import { ExportButton } from "@/components/export-button";
import { FilterTabs } from "@/components/filter-tabs";
import { DateRangeFilter, FilterBar, FilterSelect } from "@/components/filters";
import { settlementColumns } from "@/components/reseller-settlement-columns";
import { useListParams } from "@/hooks/use-list-params";
import { RESELLER_SETTLEMENTS_TABS, type ListTabCounts } from "@/lib/list-tabs";
import type { Page } from "@/lib/schemas/common";
import type { ResellerLabel, ResellerSettlementRow } from "@/lib/schemas/reseller";
import {
  type ResellerSettlementsSearchParams,
  resellerSettlementsSearchParamsSchema,
} from "@/lib/search-params";
import { exportResellerSettlementsCsv } from "@/server/actions/exports";

import { MarkPaidButton } from "./mark-paid-button";

export function SettlementsView({
  params,
  page,
  tabCounts,
  resellers,
}: {
  params: ResellerSettlementsSearchParams;
  page: Page<ResellerSettlementRow>;
  tabCounts: ListTabCounts;
  resellers: ResellerLabel[];
}) {
  const { setParams, resetFilters, activeFilterCount, isPending } = useListParams(
    resellerSettlementsSearchParamsSchema,
    params,
  );

  const columns = useMemo(
    () => [
      ...settlementColumns(true),
      {
        id: "actions",
        cell: ({ row }: { row: { original: ResellerSettlementRow } }) => (
          <MarkPaidButton settlement={row.original} />
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
        setParams({
          sort_by: sortBy as ResellerSettlementsSearchParams["sort_by"],
          sort_dir: sortDir,
        }),
    }),
    [params.sort_by, params.sort_dir, setParams],
  );

  return (
    <>
      <FilterTabs
        tabs={RESELLER_SETTLEMENTS_TABS}
        params={params}
        counts={tabCounts}
        onSelect={(patch) => setParams(patch)}
      />

      <FilterBar activeCount={activeFilterCount} onReset={resetFilters}>
        <FilterSelect
          label="Filter by reseller"
          allLabel="All resellers"
          value={params.reseller_id}
          options={resellerIds}
          onChange={(reseller_id) => setParams({ reseller_id })}
          formatOption={(id) => resellerName.get(id) ?? id}
          className="w-48"
        />
        <DateRangeFilter
          fromLabel="Day from (UTC)"
          toLabel="Day to (UTC)"
          from={params.from}
          to={params.to}
          onChange={({ from, to }) => setParams({ from, to })}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={page.items}
        getRowId={(row) => row._id}
        emptyMessage="No settled days match these filters. A day is settled an hour after it ends (UTC)."
        isPending={isPending}
        pagination={pagination}
        sorting={sorting}
        toolbar={<ExportButton run={() => exportResellerSettlementsCsv(params)} />}
      />
    </>
  );
}
