"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { FilterSelect, SearchInput } from "@/components/filters";
import { Badge } from "@/components/ui/badge";
import { useListParams } from "@/hooks/use-list-params";
import { formatDate, formatNumber, titleCase } from "@/lib/format";
import type { Page } from "@/lib/schemas/common";
import { USER_ROLES, USER_STATUSES, type UserRole, type UserRow } from "@/lib/schemas/user";
import { PAGE_SIZE, type UsersSearchParams, usersSearchParamsSchema } from "@/lib/search-params";

import { UserEditSheet } from "./user-edit-sheet";

const ROLE_BADGE_VARIANT: Record<UserRole, "default" | "secondary" | "outline"> = {
  admin: "default",
  user: "secondary",
  trial_user: "outline",
};

const columns: ColumnDef<UserRow, unknown>[] = [
  {
    accessorKey: "username",
    header: "User",
    enableSorting: true,
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.username}</span>
        <span className="text-xs text-muted-foreground">{row.original.email}</span>
      </div>
    ),
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) => (
      <Badge variant={ROLE_BADGE_VARIANT[row.original.role]}>{titleCase(row.original.role)}</Badge>
    ),
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
    accessorKey: "credits",
    header: "Credits",
    enableSorting: true,
    cell: ({ row }) => formatNumber(row.original.credits),
  },
  {
    accessorKey: "created_at",
    header: "Joined",
    enableSorting: true,
    cell: ({ row }) => formatDate(row.original.created_at),
  },
];

export function UsersView({ params, page }: { params: UsersSearchParams; page: Page<UserRow> }) {
  const { setParams, isPending } = useListParams(usersSearchParamsSchema, params);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Derived from the current page rather than held in state, so a row edited through the sheet
  // shows its new values as soon as the action refreshes the server render.
  const selected = selectedId ? (page.items.find((user) => user._id === selectedId) ?? null) : null;

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
        setParams({ sort_by: sortBy as UsersSearchParams["sort_by"], sort_dir: sortDir }),
    }),
    [params.sort_by, params.sort_dir, setParams],
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 pb-4">
        <SearchInput
          label="Search users"
          placeholder="Search username or email..."
          value={params.q}
          onChange={(q) => setParams({ q }, { replace: true })}
          className="max-w-xs"
        />
        <FilterSelect
          label="Filter by role"
          allLabel="All roles"
          value={params.role}
          options={USER_ROLES}
          onChange={(role) => setParams({ role })}
          className="w-40"
        />
        <FilterSelect
          label="Filter by status"
          allLabel="All statuses"
          value={params.status}
          options={USER_STATUSES}
          onChange={(status) => setParams({ status })}
          className="w-40"
        />
      </div>

      <DataTable
        columns={columns}
        data={page.items}
        getRowId={(row) => row._id}
        onRowClick={(row) => setSelectedId(row._id)}
        emptyMessage="No users match these filters."
        isPending={isPending}
        pagination={pagination}
        sorting={sorting}
      />

      <UserEditSheet user={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}
