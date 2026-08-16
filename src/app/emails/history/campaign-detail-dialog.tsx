"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatNumber, titleCase } from "@/lib/format";
import {
  EMAIL_AUDIENCE_LABELS,
  type EmailCampaign,
  type EmailCampaignRow,
  type EmailDelivery,
} from "@/lib/schemas/email";

import { CampaignStatusBadge } from "../campaign-status-badge";

type DeliveryFilter = "all" | "failed";

interface CampaignDetailDialogProps {
  /** Row data, available the moment the row is clicked. */
  campaign: EmailCampaignRow | null;
  /** The same campaign with its delivery log, once the round trip finishes. */
  detail: EmailCampaign | null;
  isLoading: boolean;
  onClose: () => void;
}

export function CampaignDetailDialog({
  campaign,
  detail,
  isLoading,
  onClose,
}: CampaignDetailDialogProps) {
  return (
    <Dialog open={!!campaign} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        {campaign && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-8">{campaign.subject}</DialogTitle>
              <DialogDescription>
                {formatDate(campaign.created_at)} - {EMAIL_AUDIENCE_LABELS[campaign.audience]} -{" "}
                {titleCase(campaign.template)} style
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-2">
              <CampaignStatusBadge campaign={campaign} />
              <Badge variant="outline">{formatNumber(campaign.total)} recipients</Badge>
              <Badge variant="secondary">{formatNumber(campaign.sent_count)} sent</Badge>
              {campaign.failed_count > 0 && (
                <Badge variant="destructive">{formatNumber(campaign.failed_count)} failed</Badge>
              )}
            </div>

            {campaign.interrupted && (
              <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                This run stopped before it finished, most likely because the dashboard restarted
                mid-send. Recipients still marked pending were never contacted; re-sending to just
                those means picking them by hand.
              </p>
            )}

            {campaign.error && <p className="text-sm text-destructive">{campaign.error}</p>}

            {/* Keyed by campaign so switching rows resets the tab and the filter. */}
            <CampaignBody key={campaign._id} detail={detail} isLoading={isLoading} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CampaignBody({
  detail,
  isLoading,
}: {
  detail: EmailCampaign | null;
  isLoading: boolean;
}) {
  const [filter, setFilter] = useState<DeliveryFilter>("all");

  if (isLoading || !detail) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  const failed = detail.recipients.filter((entry) => entry.status === "failed");
  const shown = filter === "failed" ? failed : detail.recipients;

  return (
    <Tabs defaultValue="recipients">
      <TabsList>
        <TabsTrigger value="recipients">Recipients</TabsTrigger>
        <TabsTrigger value="content">Content</TabsTrigger>
      </TabsList>

      <TabsContent value="recipients" className="flex flex-col gap-2 pt-3">
        {failed.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <FilterChip current={filter} value="all" onSelect={setFilter}>
              All {formatNumber(detail.recipients.length)}
            </FilterChip>
            <FilterChip current={filter} value="failed" onSelect={setFilter}>
              Failed {formatNumber(failed.length)}
            </FilterChip>
          </div>
        )}

        <div className="max-h-80 overflow-y-auto rounded-lg border">
          {shown.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No recipients were recorded.</p>
          ) : (
            <ul className="divide-y">
              {shown.map((entry, index) => (
                <DeliveryRow key={`${entry.email}-${index}`} entry={entry} />
              ))}
            </ul>
          )}
        </div>
      </TabsContent>

      <TabsContent value="content" className="pt-3">
        <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
          {detail.body}
        </pre>
      </TabsContent>
    </Tabs>
  );
}

const DELIVERY_BADGE: Record<EmailDelivery["status"], { label: string; className: string }> = {
  sent: { label: "Sent", className: "text-emerald-600" },
  failed: { label: "Failed", className: "text-destructive" },
  pending: { label: "Not sent", className: "text-muted-foreground" },
};

function DeliveryRow({ entry }: { entry: EmailDelivery }) {
  const badge = DELIVERY_BADGE[entry.status];

  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm">{entry.email}</span>
        {entry.error && <span className="text-xs text-destructive">{entry.error}</span>}
      </div>
      <span className={`shrink-0 text-xs ${badge.className}`}>{badge.label}</span>
    </li>
  );
}

function FilterChip({
  current,
  value,
  onSelect,
  children,
}: {
  current: DeliveryFilter;
  value: DeliveryFilter;
  onSelect: (value: DeliveryFilter) => void;
  children: React.ReactNode;
}) {
  const isActive = current === value;
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={() => onSelect(value)}
      className={
        isActive
          ? "rounded-full bg-primary px-2.5 py-1 text-primary-foreground"
          : "rounded-full border px-2.5 py-1 text-muted-foreground hover:bg-muted"
      }
    >
      {children}
    </button>
  );
}
