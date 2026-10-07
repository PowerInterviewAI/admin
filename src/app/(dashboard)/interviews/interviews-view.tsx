"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";

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
import { LiveDot } from "@/components/live-dot";
import { RelatedLink } from "@/components/related-link";
import { useCanAccess } from "@/components/session-context";
import { Badge } from "@/components/ui/badge";
import { UserCell } from "@/components/user-cell";
import { useListParams } from "@/hooks/use-list-params";
import { formatDate, formatDuration, titleCase } from "@/lib/format";
import { INTERVIEWS_TABS, type ListTabCounts } from "@/lib/list-tabs";
import type { Page } from "@/lib/schemas/common";
import {
  INTERVIEW_KINDS,
  INTERVIEW_STATE_LABELS,
  INTERVIEW_STATES,
  type InterviewRow,
} from "@/lib/schemas/interview";
import { type InterviewsSearchParams, interviewsSearchParamsSchema } from "@/lib/search-params";
import { exportInterviewsCsv } from "@/server/actions/exports";

function StateBadge({ state }: { state: InterviewRow["state"] }) {
  if (state === "running") {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <LiveDot pulse />
        {INTERVIEW_STATE_LABELS.running}
      </Badge>
    );
  }
  return <Badge variant="outline">{INTERVIEW_STATE_LABELS[state]}</Badge>;
}

function buildColumns(canSeeAuditLog: boolean): ColumnDef<InterviewRow, unknown>[] {
  const columns: ColumnDef<InterviewRow, unknown>[] = [
    {
      accessorKey: "user_id",
      header: "User",
      cell: ({ row }) => <UserCell user={row.original.user} userId={row.original.user_id} />,
    },
    {
      accessorKey: "kind",
      header: "Kind",
      cell: ({ row }) => (
        <Badge variant={row.original.kind === "live" ? "default" : "outline"}>
          {titleCase(row.original.kind)}
        </Badge>
      ),
    },
    {
      accessorKey: "state",
      header: "State",
      cell: ({ row }) => <StateBadge state={row.original.state} />,
    },
    {
      accessorKey: "started_at",
      header: "Started",
      enableSorting: true,
      cell: ({ row }) => formatDate(row.original.started_at),
    },
    {
      accessorKey: "ended_at",
      header: "Ended",
      cell: ({ row }) => (row.original.ended_at ? formatDate(row.original.ended_at) : "-"),
    },
    {
      accessorKey: "duration_ms",
      header: "Duration",
      enableSorting: true,
      cell: ({ row }) =>
        row.original.duration_ms === null ? "-" : formatDuration(row.original.duration_ms),
    },
    {
      accessorKey: "sockets",
      header: "Sockets",
      cell: ({ row }) => row.original.sockets,
    },
  ];

  if (canSeeAuditLog) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <RelatedLink
          href={`/audit-logs?user_id=${row.original.user_id}&group=asr`}
          label="ASR log"
        />
      ),
    });
  }

  return columns;
}

/** Rarely needed, available from the Columns menu. */
const HIDDEN_BY_DEFAULT = ["sockets"];

export function InterviewsView({
  params,
  page,
  tabCounts,
}: {
  params: InterviewsSearchParams;
  page: Page<InterviewRow>;
  tabCounts: ListTabCounts;
}) {
  const { setParams, resetFilters, activeFilterCount, isPending } = useListParams(
    interviewsSearchParamsSchema,
    params,
  );
  const canSeeAuditLog = useCanAccess("/audit-logs");
  const columns = useMemo(() => buildColumns(canSeeAuditLog), [canSeeAuditLog]);

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
          sort_by: sortBy as InterviewsSearchParams["sort_by"],
          sort_dir: sortDir,
        }),
    }),
    [params.sort_by, params.sort_dir, setParams],
  );

  return (
    <>
      <FilterTabs
        tabs={INTERVIEWS_TABS}
        params={params}
        counts={tabCounts}
        onSelect={(patch) => setParams(patch)}
      />

      <FilterBar activeCount={activeFilterCount} onReset={resetFilters}>
        {params.user_id && (
          <FilterChip
            label={`One user: ${page.items[0]?.user?.username ?? params.user_id}`}
            onClear={() => setParams({ user_id: undefined })}
          />
        )}
        <SearchInput
          label="Search interviews by user"
          placeholder="Search username or email..."
          value={params.q}
          onChange={(q) => setParams({ q }, { replace: true })}
          className="max-w-xs"
        />
        <FilterSelect
          label="Filter by kind"
          allLabel="Any kind"
          value={params.kind}
          options={INTERVIEW_KINDS}
          onChange={(kind) => setParams({ kind })}
          className="w-36"
        />
        <FilterSelect
          label="Filter by state"
          allLabel="Any state"
          value={params.state}
          options={INTERVIEW_STATES}
          onChange={(state) => setParams({ state })}
          formatOption={(value) => INTERVIEW_STATE_LABELS[value]}
          className="w-36"
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
        getRowId={(row) => row.id}
        emptyTitle="No interviews"
        emptyMessage="No interviews match these filters."
        isPending={isPending}
        pagination={pagination}
        sorting={sorting}
        defaultHiddenColumns={HIDDEN_BY_DEFAULT}
        toolbar={<ExportButton run={() => exportInterviewsCsv(params)} />}
      />
    </>
  );
}
