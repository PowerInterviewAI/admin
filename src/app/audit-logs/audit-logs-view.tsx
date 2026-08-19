"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { DateFilter, FilterSelect, SearchInput } from "@/components/filters";
import { Badge } from "@/components/ui/badge";
import { useListParams } from "@/hooks/use-list-params";
import { formatDate, titleCase } from "@/lib/format";
import {
  AUDIT_EVENT_TYPES,
  AUDIT_STATUSES,
  type AuditLog,
} from "@/lib/schemas/audit-log";
import type { Page } from "@/lib/schemas/common";
import {
  AUDIT_LOG_PAGE_SIZE,
  type AuditLogsSearchParams,
  auditLogsSearchParamsSchema,
} from "@/lib/search-params";

import { AuditLogDialog } from "./audit-log-dialog";

const columns: ColumnDef<AuditLog, unknown>[] = [
  {
    accessorKey: "event_type",
    header: "Event",
    cell: ({ row }) => <span className="font-medium">{titleCase(row.original.event_type)}</span>,
  },
  {
    accessorKey: "email",
    header: "User",
    cell: ({ row }) => row.original.email ?? "—",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={row.original.status === "success" ? "secondary" : "destructive"}>
        {row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: "ip_address",
    header: "IP",
    cell: ({ row }) => row.original.ip_address ?? "—",
  },
  {
    accessorKey: "created_at",
    header: "When",
    cell: ({ row }) => formatDate(row.original.created_at),
  },
];

export function AuditLogsView({
  params,
  page,
}: {
  params: AuditLogsSearchParams;
  page: Page<AuditLog>;
}) {
  const { setParams, isPending } = useListParams(auditLogsSearchParamsSchema, params);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = selectedId ? (page.items.find((log) => log._id === selectedId) ?? null) : null;

  const pagination = useMemo(
    () => ({
      page: params.page,
      pageSize: AUDIT_LOG_PAGE_SIZE,
      total: page.total,
      onPageChange: (next: number) => setParams({ page: next }),
    }),
    [page.total, params.page, setParams],
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 pb-4">
        <SearchInput
          label="Search by user"
          placeholder="Search username or email..."
          value={params.q}
          onChange={(q) => setParams({ q }, { replace: true })}
          className="max-w-xs"
        />
        <FilterSelect
          label="Filter by event type"
          allLabel="All events"
          value={params.event_type}
          options={AUDIT_EVENT_TYPES}
          onChange={(event_type) => setParams({ event_type })}
          className="w-56"
        />
        <FilterSelect
          label="Filter by status"
          allLabel="All statuses"
          value={params.status}
          options={AUDIT_STATUSES}
          onChange={(status) => setParams({ status })}
          className="w-40"
        />
        <DateFilter
          label="From date"
          value={params.from}
          onChange={(from) => setParams({ from })}
          className="w-40"
        />
        <span className="text-sm text-muted-foreground">to</span>
        <DateFilter
          label="To date"
          value={params.to}
          onChange={(to) => setParams({ to })}
          className="w-40"
        />
      </div>

      <DataTable
        columns={columns}
        data={page.items}
        getRowId={(row) => row._id}
        onRowClick={(row) => setSelectedId(row._id)}
        emptyMessage="No audit events match these filters."
        isPending={isPending}
        pagination={pagination}
      />

      <AuditLogDialog log={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}
