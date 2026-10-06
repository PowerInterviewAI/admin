"use client";

import Link from "next/link";

import { LinkPending } from "@/components/navigation-progress";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLiveCampaigns } from "@/hooks/use-live-campaigns";
import { formatDate, formatNumber } from "@/lib/format";
import { EMAIL_AUDIENCE_LABELS, type EmailCampaignRow } from "@/lib/schemas/email";

import { CampaignStatusBadge } from "./campaign-status-badge";

/**
 * Last few sends, so the composer is never written blind to what already went out this week.
 *
 * A client component only so the counts stay live: a run started from another tab - or the one
 * this page started, once its progress card has been dismissed - keeps advancing in the
 * background, and a server-rendered strip would sit on the count it was rendered with.
 */
export function RecentCampaigns({ campaigns }: { campaigns: EmailCampaignRow[] }) {
  const rows = useLiveCampaigns(campaigns);

  if (rows.length === 0) return null;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Recent sends</CardTitle>
        <CardDescription>The last {rows.length} campaigns sent from here.</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/emails/history" />}>
            View all
            <LinkPending />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {rows.map((campaign) => (
          <div
            key={campaign._id}
            className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{campaign.subject}</span>
              <span className="text-xs text-muted-foreground">
                {formatDate(campaign.created_at)} - {EMAIL_AUDIENCE_LABELS[campaign.audience]}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {formatNumber(campaign.sent_count)}/{formatNumber(campaign.total)} sent
              </span>
              <CampaignStatusBadge campaign={campaign} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
