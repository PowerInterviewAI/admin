import { Badge } from "@/components/ui/badge";
import type { EmailCampaignRow } from "@/lib/schemas/email";

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

/**
 * More states than the enum. A run whose Node process went away mid-send stays `sending` in the
 * database forever, and showing that as "Sending" would have an admin waiting on a progress bar
 * that will never move again.
 */
export function CampaignStatusBadge({
  campaign,
}: {
  campaign: Pick<EmailCampaignRow, "status" | "interrupted" | "control">;
}) {
  if (campaign.interrupted) {
    return <Badge variant="destructive">Interrupted</Badge>;
  }
  // Requested but not yet acted on: the run finishes the message in flight first.
  if (campaign.status === "sending" && campaign.control) {
    return (
      <Badge variant="outline">{campaign.control === "pause" ? "Pausing..." : "Stopping..."}</Badge>
    );
  }

  const { label, variant } = DESCRIPTIONS[campaign.status];
  return <Badge variant={variant}>{label}</Badge>;
}

const DESCRIPTIONS: Record<
  EmailCampaignRow["status"],
  { label: string; variant: BadgeVariant }
> = {
  sending: { label: "Sending", variant: "default" },
  paused: { label: "Paused", variant: "outline" },
  completed: { label: "Completed", variant: "secondary" },
  stopped: { label: "Stopped", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" },
};
