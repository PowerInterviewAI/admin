import Link from "next/link";

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber } from "@/lib/format";
import { EMAIL_AUDIENCE_LABELS, type EmailCampaignRow } from "@/lib/schemas/email";

import { CampaignStatusBadge } from "./campaign-status-badge";

/** Last few sends, so the composer is never written blind to what already went out this week. */
export function RecentCampaigns({ campaigns }: { campaigns: EmailCampaignRow[] }) {
  if (campaigns.length === 0) return null;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Recent sends</CardTitle>
        <CardDescription>The last {campaigns.length} campaigns sent from here.</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" render={<Link href="/emails/history" />}>
            View all
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {campaigns.map((campaign) => (
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
