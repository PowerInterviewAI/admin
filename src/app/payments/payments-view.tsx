"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { ExportButton } from "@/components/export-button";
import {
  DateRangeFilter,
  FilterBar,
  FilterChip,
  FilterSelect,
  NumberRangeFilter,
  SearchInput,
} from "@/components/filters";
import { Badge } from "@/components/ui/badge";
import { UserCell } from "@/components/user-cell";
import { useListParams } from "@/hooks/use-list-params";
import { formatDate, formatUsd, titleCase } from "@/lib/format";
import type { Page } from "@/lib/schemas/common";
import {
  PAYMENT_PLANS,
  PAYMENT_STATUSES,
  type PaymentRow,
  type PaymentStatus,
} from "@/lib/schemas/payment";
import {
  YES_NO_OPTIONS,
  type PaymentsSearchParams,
  paymentsSearchParamsSchema,
} from "@/lib/search-params";
import { exportPaymentsCsv } from "@/server/actions/exports";

import { PaymentEditSheet } from "./payment-edit-sheet";

const STATUS_BADGE_VARIANT: Record<
  PaymentStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  finished: "secondary",
  confirmed: "secondary",
  pending: "outline",
  waiting: "outline",
  confirming: "outline",
  sending: "outline",
  partially_paid: "outline",
  failed: "destructive",
  refunded: "destructive",
  expired: "destructive",
};

const columns: ColumnDef<PaymentRow, unknown>[] = [
  {
    accessorKey: "user_id",
    header: "User",
    cell: ({ row }) => <UserCell user={row.original.user} userId={row.original.user_id} />,
  },
  {
    accessorKey: "order_id",
    header: "Order",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.order_id}</span>,
  },
  {
    accessorKey: "plan",
    header: "Plan",
    cell: ({ row }) => titleCase(row.original.plan),
  },
  {
    accessorKey: "status",
    header: "Status",
    enableSorting: true,
    cell: ({ row }) => (
      <Badge variant={STATUS_BADGE_VARIANT[row.original.status]}>
        {titleCase(row.original.status)}
      </Badge>
    ),
  },
  {
    accessorKey: "price_amount",
    header: "Amount",
    enableSorting: true,
    cell: ({ row }) => formatUsd(row.original.price_amount),
  },
  {
    accessorKey: "credits_amount",
    header: "Credits",
    enableSorting: true,
  },
  {
    accessorKey: "credits_applied",
    header: "Applied",
    cell: ({ row }) => (
      <Badge variant={row.original.credits_applied ? "secondary" : "outline"}>
        {row.original.credits_applied ? "Yes" : "No"}
      </Badge>
    ),
  },
  {
    id: "pay_currency",
    header: "Paid in",
    cell: ({ row }) => (
      <span className="text-sm">
        {row.original.pay_currency ? row.original.pay_currency.toUpperCase() : "—"}
        {row.original.pay_amount !== null && row.original.pay_amount !== undefined && (
          <span className="ml-1 text-xs text-muted-foreground">{row.original.pay_amount}</span>
        )}
      </span>
    ),
  },
  {
    accessorKey: "created_at",
    header: "Created",
    enableSorting: true,
    cell: ({ row }) => formatDate(row.original.created_at),
  },
  {
    accessorKey: "updated_at",
    header: "Updated",
    enableSorting: true,
    cell: ({ row }) => formatDate(row.original.updated_at),
  },
];

const HIDDEN_BY_DEFAULT = ["pay_currency", "updated_at"];

export function PaymentsView({
  params,
  page,
}: {
  params: PaymentsSearchParams;
  page: Page<PaymentRow>;
}) {
  const { setParams, resetFilters, activeFilterCount, isPending } = useListParams(
    paymentsSearchParamsSchema,
    params,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = selectedId
    ? (page.items.find((payment) => payment._id === selectedId) ?? null)
    : null;

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
        setParams({ sort_by: sortBy as PaymentsSearchParams["sort_by"], sort_dir: sortDir }),
    }),
    [params.sort_by, params.sort_dir, setParams],
  );

  return (
    <>
      <FilterBar activeCount={activeFilterCount} onReset={resetFilters}>
        {params.user_id && (
          <FilterChip
            label={`One user: ${page.items[0]?.user?.username ?? params.user_id}`}
            onClear={() => setParams({ user_id: undefined })}
          />
        )}
        <SearchInput
          label="Search payments"
          placeholder="Order, payment id, or user..."
          value={params.q}
          onChange={(q) => setParams({ q }, { replace: true })}
          className="max-w-xs"
        />
        <FilterSelect
          label="Filter by status"
          allLabel="All statuses"
          value={params.status}
          options={PAYMENT_STATUSES}
          onChange={(status) => setParams({ status })}
          className="w-44"
        />
        <FilterSelect
          label="Filter by plan"
          allLabel="All plans"
          value={params.plan}
          options={PAYMENT_PLANS}
          onChange={(plan) => setParams({ plan })}
          className="w-40"
        />
        <FilterSelect
          label="Filter by credits applied"
          allLabel="Applied or not"
          value={params.applied}
          options={YES_NO_OPTIONS}
          onChange={(applied) => setParams({ applied })}
          formatOption={(value) => (value === "yes" ? "Credits applied" : "Not applied")}
          className="w-44"
        />
        <NumberRangeFilter
          label="Amount in USD"
          minPlaceholder="$ min"
          maxPlaceholder="$ max"
          step="0.01"
          min={params.min_amount}
          max={params.max_amount}
          onChange={({ min, max }) => setParams({ min_amount: min, max_amount: max })}
        />
        <DateRangeFilter
          fromLabel="Created from"
          toLabel="Created to"
          from={params.from}
          to={params.to}
          onChange={({ from, to }) => setParams({ from, to })}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={page.items}
        getRowId={(row) => row._id}
        onRowClick={(row) => setSelectedId(row._id)}
        emptyMessage="No payments match these filters."
        isPending={isPending}
        pagination={pagination}
        sorting={sorting}
        defaultHiddenColumns={HIDDEN_BY_DEFAULT}
        toolbar={<ExportButton run={() => exportPaymentsCsv(params)} />}
      />

      <PaymentEditSheet payment={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}
