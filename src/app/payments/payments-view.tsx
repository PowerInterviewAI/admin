"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { FilterSelect } from "@/components/filters";
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
import { PAGE_SIZE, type PaymentsSearchParams, paymentsSearchParamsSchema } from "@/lib/search-params";

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
    accessorKey: "created_at",
    header: "Created",
    enableSorting: true,
    cell: ({ row }) => formatDate(row.original.created_at),
  },
];

export function PaymentsView({
  params,
  page,
}: {
  params: PaymentsSearchParams;
  page: Page<PaymentRow>;
}) {
  const { setParams, isPending } = useListParams(paymentsSearchParamsSchema, params);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = selectedId
    ? (page.items.find((payment) => payment._id === selectedId) ?? null)
    : null;

  const pagination = useMemo(
    () => ({
      page: params.page,
      pageSize: PAGE_SIZE,
      total: page.total,
      onPageChange: (next: number) => setParams({ page: next }),
    }),
    [page.total, params.page, setParams],
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
      <div className="flex flex-wrap items-center gap-2 pb-4">
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
      </div>

      <DataTable
        columns={columns}
        data={page.items}
        getRowId={(row) => row._id}
        onRowClick={(row) => setSelectedId(row._id)}
        emptyMessage="No payments match these filters."
        isPending={isPending}
        pagination={pagination}
        sorting={sorting}
      />

      <PaymentEditSheet payment={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}
