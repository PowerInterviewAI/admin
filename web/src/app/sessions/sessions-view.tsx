"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";

import { DataTable } from "@/components/data-table";
import { UserCell } from "@/components/user-cell";
import { useListParams } from "@/hooks/use-list-params";
import { formatDate } from "@/lib/format";
import type { Page } from "@/lib/schemas/common";
import type { SessionRow } from "@/lib/schemas/session";
import { PAGE_SIZE, type SessionsSearchParams, sessionsSearchParamsSchema } from "@/lib/search-params";

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
    accessorKey: "created_at",
    header: "Started",
    enableSorting: true,
    cell: ({ row }) => formatDate(row.original.created_at),
  },
  {
    accessorKey: "updated_at",
    header: "Last active",
    enableSorting: true,
    cell: ({ row }) => formatDate(row.original.updated_at ?? row.original.created_at),
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
  const { setParams, isPending } = useListParams(sessionsSearchParamsSchema, params);

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
        setParams({ sort_by: sortBy as SessionsSearchParams["sort_by"], sort_dir: sortDir }),
    }),
    [params.sort_by, params.sort_dir, setParams],
  );

  return (
    <DataTable
      columns={columns}
      data={page.items}
      getRowId={(row) => row._id}
      emptyTitle="No sessions"
      emptyMessage="Nobody is signed in right now."
      isPending={isPending}
      pagination={pagination}
      sorting={sorting}
    />
  );
}
