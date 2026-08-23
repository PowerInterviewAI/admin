"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";

import { DataTable } from "@/components/data-table";
import { ExportButton } from "@/components/export-button";
import {
  DateRangeFilter,
  FilterBar,
  FilterChip,
  FilterSelect,
  SearchInput,
} from "@/components/filters";
import { Badge } from "@/components/ui/badge";
import { UserCell } from "@/components/user-cell";
import { useListParams } from "@/hooks/use-list-params";
import { formatDate, titleCase } from "@/lib/format";
import type { Page } from "@/lib/schemas/common";
import type { SessionRow } from "@/lib/schemas/session";
import { type SessionsSearchParams, sessionsSearchParamsSchema } from "@/lib/search-params";
import { SESSION_ACTIVITIES, SESSION_ACTIVITY_LABELS } from "@/lib/session-activity";
import { exportSessionsCsv } from "@/server/actions/exports";

import { RevokeSessionButton } from "./revoke-session-button";

const columns: ColumnDef<SessionRow, unknown>[] = [
  {
    accessorKey: "user_id",
    header: "User",
    cell: ({ row }) => <UserCell user={row.original.user} userId={row.original.user_id} />,
  },
  {
    accessorKey: "device_info",
    header: "Device",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="text-sm">{row.original.device_info.ip_address || "—"}</span>
        <span className="max-w-md truncate text-xs text-muted-foreground">
          {row.original.device_info.user_agent}
        </span>
      </div>
    ),
  },
  {
    id: "activity",
    header: "Activity",
    cell: ({ row }) => (
      <Badge variant={row.original.activity === "active" ? "secondary" : "outline"}>
        {titleCase(row.original.activity)}
      </Badge>
    ),
  },
  {
    accessorKey: "created_at",
    header: "Started",
    enableSorting: true,
    cell: ({ row }) => formatDate(row.original.created_at),
  },
  {
    accessorKey: "updated_at",
    header: "Last active",
    enableSorting: true,
    cell: ({ row }) => formatDate(row.original.last_active_at),
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => <RevokeSessionButton session={row.original} />,
  },
];

export function SessionsView({
  params,
  page,
}: {
  params: SessionsSearchParams;
  page: Page<SessionRow>;
}) {
  const { setParams, resetFilters, activeFilterCount, isPending } = useListParams(
    sessionsSearchParamsSchema,
    params,
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
        setParams({ sort_by: sortBy as SessionsSearchParams["sort_by"], sort_dir: sortDir }),
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
          label="Search sessions by user"
          placeholder="Search username or email..."
          value={params.q}
          onChange={(q) => setParams({ q }, { replace: true })}
          className="max-w-xs"
        />
        <FilterSelect
          label="Filter by activity"
          allLabel="Any activity"
          value={params.activity}
          options={SESSION_ACTIVITIES}
          onChange={(activity) => setParams({ activity })}
          formatOption={(value) => SESSION_ACTIVITY_LABELS[value]}
          className="w-44"
        />
        <DateRangeFilter
          fromLabel="Started from"
          toLabel="Started to"
          from={params.from}
          to={params.to}
          onChange={({ from, to }) => setParams({ from, to })}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={page.items}
        getRowId={(row) => row._id}
        emptyTitle="No sessions"
        emptyMessage="Nobody matching these filters is signed in."
        isPending={isPending}
        pagination={pagination}
        sorting={sorting}
        toolbar={<ExportButton run={() => exportSessionsCsv(params)} />}
      />
    </>
  );
}
