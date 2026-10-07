"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { ExportButton } from "@/components/export-button";
import { FilterTabs } from "@/components/filter-tabs";
import {
  DateRangeFilter,
  FilterBar,
  FilterSelect,
  NumberRangeFilter,
  SearchInput,
} from "@/components/filters";
import { LiveDot } from "@/components/live-dot";
import { LinkPending } from "@/components/navigation-progress";
import { Badge } from "@/components/ui/badge";
import { useListParams } from "@/hooks/use-list-params";
import { formatDate, formatNumber, titleCase } from "@/lib/format";
import { USERS_TABS, type ListTabCounts } from "@/lib/list-tabs";
import type { Page } from "@/lib/schemas/common";
import { USER_ROLES, USER_STATUSES, type UserRole, type UserRow } from "@/lib/schemas/user";
import {
  YES_NO_OPTIONS,
  type UsersSearchParams,
  usersSearchParamsSchema,
} from "@/lib/search-params";
import { exportUsersCsv } from "@/server/actions/exports";

import { UserEditSheet } from "./user-edit-sheet";

const ROLE_BADGE_VARIANT: Record<UserRole, "default" | "secondary" | "outline"> = {
  admin: "default",
  user: "secondary",
  trial_user: "outline",
};

/** The product's activation signal: an account with a name or a CV has been set up for a session. */
function isConfigured(user: UserRow): boolean {
  return !!(user.interview_config?.full_name || user.interview_config?.profile_data);
}

/** Online, and what the account is doing in the app. Empty when no app is signed in. */
function PresenceCell({ user }: { user: UserRow }) {
  const { presence } = user;
  if (!presence) return null;

  if (!presence.interview) {
    return (
      <Badge variant="outline" className="gap-1.5">
        <LiveDot />
        Online
      </Badge>
    );
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      {/* The row opens the edit sheet, so the link keeps its click to itself. */}
      <Link
        href={`/interviews?user_id=${user._id}&state=running`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        className="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Badge variant="secondary" className="gap-1.5 hover:bg-secondary/80">
          <LiveDot pulse />
          In {presence.interview.kind} interview
          <LinkPending />
        </Badge>
      </Link>
      <span className="text-xs text-muted-foreground">
        since {formatDate(presence.interview.started_at)}
      </span>
    </div>
  );
}

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
    accessorKey: "email",
    header: "Email",
    enableSorting: true,
    cell: ({ row }) => <span className="text-sm">{row.original.email}</span>,
  },
  {
    id: "presence",
    header: "Now",
    cell: ({ row }) => <PresenceCell user={row.original} />,
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
    id: "configured",
    header: "Setup",
    cell: ({ row }) =>
      isConfigured(row.original) ? (
        <Badge variant="secondary">Ready</Badge>
      ) : (
        <Badge variant="outline">Empty</Badge>
      ),
  },
  {
    accessorKey: "credits",
    header: "Credits",
    enableSorting: true,
    cell: ({ row }) => formatNumber(row.original.credits),
  },
  {
    accessorKey: "payment_count",
    header: "Payments",
    cell: ({ row }) => formatNumber(row.original.payment_count),
  },
  {
    accessorKey: "session_count",
    header: "Sessions",
    cell: ({ row }) => formatNumber(row.original.session_count),
  },
  {
    accessorKey: "created_at",
    header: "Joined",
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

/** Already shown inside the User cell, or rarely needed - available from the Columns menu. */
const HIDDEN_BY_DEFAULT = ["email", "updated_at"];

export function UsersView({
  params,
  page,
  tabCounts,
}: {
  params: UsersSearchParams;
  page: Page<UserRow>;
  tabCounts: ListTabCounts;
}) {
  const { setParams, resetFilters, activeFilterCount, isPending } = useListParams(
    usersSearchParamsSchema,
    params,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Derived from the current page rather than held in state, so a row edited through the sheet
  // shows its new values as soon as the action refreshes the server render.
  const selected = selectedId ? (page.items.find((user) => user._id === selectedId) ?? null) : null;

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
        setParams({ sort_by: sortBy as UsersSearchParams["sort_by"], sort_dir: sortDir }),
    }),
    [params.sort_by, params.sort_dir, setParams],
  );

  return (
    <>
      <FilterTabs
        tabs={USERS_TABS}
        params={params}
        counts={tabCounts}
        onSelect={(patch) => setParams(patch)}
      />

      <FilterBar activeCount={activeFilterCount} onReset={resetFilters}>
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
        <FilterSelect
          label="Filter by app online"
          allLabel="Online or not"
          value={params.online}
          options={YES_NO_OPTIONS}
          onChange={(online) => setParams({ online })}
          formatOption={(value) => (value === "yes" ? "Online now" : "Offline")}
          className="w-40"
        />
        <FilterSelect
          label="Filter by interview setup"
          allLabel="Any setup"
          value={params.configured}
          options={YES_NO_OPTIONS}
          onChange={(configured) => setParams({ configured })}
          formatOption={(value) => (value === "yes" ? "Set up" : "Not set up")}
          className="w-40"
        />
        <NumberRangeFilter
          label="Credits"
          min={params.min_credits}
          max={params.max_credits}
          onChange={({ min, max }) => setParams({ min_credits: min, max_credits: max })}
        />
        <DateRangeFilter
          fromLabel="Joined from"
          toLabel="Joined to"
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
        emptyMessage="No users match these filters."
        isPending={isPending}
        pagination={pagination}
        sorting={sorting}
        defaultHiddenColumns={HIDDEN_BY_DEFAULT}
        toolbar={<ExportButton run={() => exportUsersCsv(params)} />}
      />

      <UserEditSheet user={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}
