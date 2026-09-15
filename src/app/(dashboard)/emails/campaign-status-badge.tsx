import { Badge } from "@/components/ui/badge";
import type { EmailCampaignRow } from "@/lib/schemas/email";

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

/**
 * Four states, not three. A run whose Node process went away mid-send stays `sending` in the
 * database forever, and showing that as "Sending" would have an admin waiting on a progress bar
 * that will never move again.
 */
export function CampaignStatusBadge({
  campaign,
}: {
  campaign: Pick<EmailCampaignRow, "status" | "interrupted">;
}) {
  if (campaign.interrupted) {
    return <Badge variant="destructive">Interrupted</Badge>;
  }

  const { label, variant } = DESCRIPTIONS[campaign.status];
  return <Badge variant={variant}>{label}</Badge>;
}

const DESCRIPTIONS: Record<
  EmailCampaignRow["status"],
  { label: string; variant: BadgeVariant }
> = {
  sending: { label: "Sending", variant: "default" },
  completed: { label: "Completed", variant: "secondary" },
  failed: { label: "Failed", variant: "destructive" },
};
