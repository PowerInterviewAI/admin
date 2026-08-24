"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { ExportButton } from "@/components/export-button";
import { FilterTabs } from "@/components/filter-tabs";
import {
  DateRangeFilter,
  FilterBar,
  FilterChip,
  FilterSelect,
  SearchInput,
} from "@/components/filters";
import { Badge } from "@/components/ui/badge";
import { useListParams } from "@/hooks/use-list-params";
import { formatDate, titleCase } from "@/lib/format";
import { AUDIT_LOGS_TABS, type ListTabCounts } from "@/lib/list-tabs";
import { AUDIT_EVENT_TYPES, AUDIT_STATUSES, type AuditLog } from "@/lib/schemas/audit-log";
import type { Page } from "@/lib/schemas/common";
import { type AuditLogsSearchParams, auditLogsSearchParamsSchema } from "@/lib/search-params";
import { exportAuditLogsCsv } from "@/server/actions/exports";

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
    accessorKey: "user_agent",
    header: "Device",
    cell: ({ row }) => (
      <span className="block max-w-md truncate text-xs text-muted-foreground">
        {row.original.user_agent ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "created_at",
    header: "When",
    enableSorting: true,
    cell: ({ row }) => formatDate(row.original.created_at),
  },
];

/** Long enough to push everything else off screen, and only wanted when chasing one device. */
const HIDDEN_BY_DEFAULT = ["user_agent"];

export function AuditLogsView({
  params,
  page,
  tabCounts,
}: {
  params: AuditLogsSearchParams;
  page: Page<AuditLog>;
  tabCounts: ListTabCounts;
}) {
  const { setParams, resetFilters, activeFilterCount, isPending } = useListParams(
    auditLogsSearchParamsSchema,
    params,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = selectedId ? (page.items.find((log) => log._id === selectedId) ?? null) : null;

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

  // The only sortable key is `created_at`; the table still routes it through the URL so a link to
  // "oldest first" survives being shared.
  const sorting = useMemo(
    () => ({
      sortBy: "created_at",
      sortDir: params.sort_dir,
      onSortChange: (_sortBy: string, sortDir: "asc" | "desc") => setParams({ sort_dir: sortDir }),
    }),
    [params.sort_dir, setParams],
  );

  return (
    <>
      <FilterTabs
        tabs={AUDIT_LOGS_TABS}
        params={params}
        counts={tabCounts}
        onSelect={(patch) => setParams(patch)}
      />

      <FilterBar activeCount={activeFilterCount} onReset={resetFilters}>
        {params.user_id && (
          <FilterChip
            label={`One user: ${page.items[0]?.email ?? params.user_id}`}
            onClear={() => setParams({ user_id: undefined })}
          />
        )}
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
        <SearchInput
          label="Filter by IP address"
          placeholder="IP address..."
          value={params.ip}
          onChange={(ip) => setParams({ ip }, { replace: true })}
          className="w-44"
        />
        <DateRangeFilter
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
        emptyMessage="No audit events match these filters."
        isPending={isPending}
        pagination={pagination}
        sorting={sorting}
        defaultHiddenColumns={HIDDEN_BY_DEFAULT}
        toolbar={<ExportButton run={() => exportAuditLogsCsv(params)} />}
      />

      <AuditLogDialog log={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}
