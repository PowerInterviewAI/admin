"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { usePayments } from "@/hooks/use-payments";
import type { Payment, PaymentPlan, PaymentStatus } from "@/lib/types";
import { PageHeader } from "@/components/custom/page-header";
import { DataTable } from "@/components/custom/data-table";
import { UserCell } from "@/components/custom/user-cell";
import { PaymentEditSheet } from "@/components/custom/payment-edit-sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatUsd, titleCase } from "@/lib/format";

const PAGE_SIZE = 20;

const STATUS_BADGE_VARIANT: Record<PaymentStatus, "default" | "secondary" | "outline" | "destructive"> = {
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

export default function PaymentsPage() {
  const [pageIndex, setPageIndex] = useState(0);
  const [status, setStatus] = useState<PaymentStatus | "all">("all");
  const [plan, setPlan] = useState<PaymentPlan | "all">("all");
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = usePayments({
    status: status === "all" ? undefined : status,
    plan: plan === "all" ? undefined : plan,
    offset: pageIndex * PAGE_SIZE,
    limit: PAGE_SIZE,
  });

  const columns = useMemo<ColumnDef<Payment, unknown>[]>(
    () => [
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
        cell: ({ row }) => formatDate(row.original.created_at),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col">
      <PageHeader title="Payments" description="Every payment record, with manual status overrides." />

      <div className="flex flex-wrap items-center gap-2 pb-4">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as PaymentStatus | "all");
            setPageIndex(0);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status">
              {(v: string) => (v === "all" ? "All statuses" : titleCase(v))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.keys(STATUS_BADGE_VARIANT).map((s) => (
              <SelectItem key={s} value={s}>
                {titleCase(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={plan}
          onValueChange={(v) => {
            setPlan(v as PaymentPlan | "all");
            setPageIndex(0);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Plan">
              {(v: string) => (v === "all" ? "All plans" : titleCase(v))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All plans</SelectItem>
            <SelectItem value="starter">Starter</SelectItem>
            <SelectItem value="pro">Pro</SelectItem>
            <SelectItem value="enterprise">Enterprise</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        onPageChange={setPageIndex}
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        emptyMessage="No payments match these filters."
        getRowId={(row) => row._id}
        onRowClick={(row) => setSelectedPaymentId(row._id)}
      />

      <PaymentEditSheet
        payment={data?.items.find((p) => p._id === selectedPaymentId) ?? null}
        open={!!selectedPaymentId}
        onOpenChange={(open) => !open && setSelectedPaymentId(null)}
      />
    </div>
  );
}
