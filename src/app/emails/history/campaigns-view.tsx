"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { FilterSelect } from "@/components/filters";
import { CAMPAIGN_POLL_INTERVAL_MS, useLiveCampaigns } from "@/hooks/use-live-campaigns";
import { useListParams } from "@/hooks/use-list-params";
import { usePoll } from "@/hooks/use-poll";
import { formatDate, formatNumber } from "@/lib/format";
import type { Page } from "@/lib/schemas/common";
import {
  EMAIL_AUDIENCE_LABELS,
  type EmailCampaign,
  type EmailCampaignRow,
  emailCampaignStatusSchema,
  isCampaignLive,
} from "@/lib/schemas/email";
import {
  type EmailCampaignsSearchParams,
  PAGE_SIZE,
  emailCampaignsSearchParamsSchema,
} from "@/lib/search-params";
import { loadEmailCampaign } from "@/server/actions/email-campaigns";

import { CampaignStatusBadge } from "../campaign-status-badge";
import { CampaignDetailDialog } from "./campaign-detail-dialog";

const CAMPAIGN_STATUSES = emailCampaignStatusSchema.options;

const columns: ColumnDef<EmailCampaignRow, unknown>[] = [
  {
    accessorKey: "subject",
    header: "Campaign",
    cell: ({ row }) => (
      <div className="flex max-w-md flex-col">
        <span className="truncate font-medium">{row.original.subject}</span>
        <span className="text-xs text-muted-foreground">
          {EMAIL_AUDIENCE_LABELS[row.original.audience]}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <CampaignStatusBadge campaign={row.original} />,
  },
  {
    accessorKey: "total",
    header: "Recipients",
    enableSorting: true,
    cell: ({ row }) => formatNumber(row.original.total),
  },
  {
    accessorKey: "sent_count",
    header: "Delivered",
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        {formatNumber(row.original.sent_count)}
        {row.original.failed_count > 0 && (
          <span className="text-destructive">
            {formatNumber(row.original.failed_count)} failed
          </span>
        )}
      </span>
    ),
  },
  {
    accessorKey: "created_at",
    header: "Sent",
    enableSorting: true,
    cell: ({ row }) => formatDate(row.original.created_at),
  },
];

export function CampaignsView({
  params,
  page,
}: {
  params: EmailCampaignsSearchParams;
  page: Page<EmailCampaignRow>;
}) {
  const { setParams, isPending } = useListParams(emailCampaignsSearchParamsSchema, params);

  // Sending outlives the request that started it, so the rows this page was rendered with go stale
  // on their own. Anything still running keeps its counters current here.
  const rows = useLiveCampaigns(page.items);

  // The dialog opens from the row the table already has and fills in the delivery log when it
  // arrives, rather than making the admin wait on a round trip before anything appears.
  const [selected, setSelected] = useState<EmailCampaignRow | null>(null);
  const [detail, setDetail] = useState<EmailCampaign | null>(null);
  const [isLoadingDetail, startLoadingDetail] = useTransition();

  // The click captures a snapshot, but the dialog renders the live row where there still is one,
  // so its badges move with the table's. The snapshot is the fallback for a row that left the page
  // underneath an open dialog.
  const selectedRow = useMemo(
    () => (selected ? (rows.find((row) => row._id === selected._id) ?? selected) : null),
    [rows, selected],
  );

  const openCampaign = (row: EmailCampaignRow) => {
    setSelected(row);
    setDetail(null);
    startLoadingDetail(async () => {
      const result = await loadEmailCampaign(row._id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDetail(result.data);
    });
  };

  const closeCampaign = () => {
    setSelected(null);
    setDetail(null);
  };

  // The counters come from the table's poll, but the per-recipient list does not: it lives in the
  // campaign document, which is the one read here. Reloaded outside `startLoadingDetail` so a
  // refresh swaps the rows in place instead of replacing the open list with a skeleton, and only
  // while the run is live - this is the app's one read that pulls a whole delivery log.
  const reloadDetail = useCallback(async () => {
    if (!selectedRow) return;
    const result = await loadEmailCampaign(selectedRow._id);
    if (result.ok) setDetail(result.data);
  }, [selectedRow]);

  usePoll(
    selectedRow !== null && isCampaignLive(selectedRow),
    CAMPAIGN_POLL_INTERVAL_MS,
    reloadDetail,
  );

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
        setParams({ sort_by: sortBy as EmailCampaignsSearchParams["sort_by"], sort_dir: sortDir }),
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
          options={CAMPAIGN_STATUSES}
          onChange={(status) => setParams({ status })}
          className="w-44"
        />
      </div>

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row._id}
        onRowClick={openCampaign}
        emptyTitle="No campaigns yet"
        emptyMessage="Campaigns sent from the compose page show up here."
        isPending={isPending}
        pagination={pagination}
        sorting={sorting}
      />

      <CampaignDetailDialog
        campaign={selectedRow}
        detail={detail}
        isLoading={isLoadingDetail}
        onClose={closeCampaign}
      />
    </>
  );
}
