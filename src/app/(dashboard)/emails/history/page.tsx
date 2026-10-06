import type { Metadata } from "next";
import Link from "next/link";
import { PenLine } from "lucide-react";

import { ListSummary, shareOf } from "@/components/list-summary";
import { LinkPending } from "@/components/navigation-progress";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber } from "@/lib/format";
import {
  countActiveFilters,
  emailCampaignsSearchParamsSchema,
  parseSearchParams,
} from "@/lib/search-params";
import { describeEmailSetup } from "@/server/email/transport";
import {
  countCampaignsTabs,
  getCampaignsSummary,
  listEmailCampaigns,
} from "@/server/queries/email-campaigns";

import { CampaignsView } from "./campaigns-view";

export const metadata: Metadata = { title: "Email history" };

export default async function EmailHistoryPage({ searchParams }: PageProps<"/emails/history">) {
  const params = parseSearchParams(emailCampaignsSearchParamsSchema, await searchParams);

  const [page, summary, tabCounts] = await Promise.all([
    listEmailCampaigns(params),
    getCampaignsSummary(params),
    countCampaignsTabs(params),
  ]);

  // The stored campaign body is the fragment the admin wrote, not the document that was sent, so
  // the detail dialog re-renders it through the same layout - which needs the app name the footer
  // and header carry.
  const { appName } = describeEmailSetup();
  const filtered = countActiveFilters(params) > 0;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Email history"
        description="Every campaign sent from this dashboard, with the delivery result for each recipient."
        actions={
          <Button variant="outline" nativeButton={false} render={<Link href="/emails" />}>
            <PenLine data-icon="inline-start" />
            Compose
            <LinkPending />
          </Button>
        }
      />

      <ListSummary
        stats={[
          {
            label: filtered ? "Matching campaigns" : "Campaigns sent",
            value: formatNumber(summary.total),
          },
          {
            label: "Recipients",
            value: formatNumber(summary.recipients),
            hint: "Addresses on these send lists",
          },
          {
            label: "Delivered",
            value: formatNumber(summary.delivered),
            hint: shareOf(summary.delivered, summary.recipients, "recipients"),
          },
          {
            label: "Failed",
            value: formatNumber(summary.failed),
            hint: shareOf(summary.failed, summary.recipients, "recipients"),
            alert: summary.failed > 0,
          },
          {
            label: "Last send",
            value: summary.latest ? formatDate(summary.latest) : "—",
            hint: "Most recent campaign",
            text: true,
          },
        ]}
      />

      <CampaignsView
        params={params}
        page={page}
        tabCounts={tabCounts}
        appName={appName}
        year={new Date().getFullYear()}
      />
    </div>
  );
}
