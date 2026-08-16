import type { Metadata } from "next";
import Link from "next/link";
import { PenLine } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { emailCampaignsSearchParamsSchema, parseSearchParams } from "@/lib/search-params";
import { listEmailCampaigns } from "@/server/queries/email-campaigns";

import { CampaignsView } from "./campaigns-view";

export const metadata: Metadata = { title: "Email history" };

export default async function EmailHistoryPage({ searchParams }: PageProps<"/emails/history">) {
  const params = parseSearchParams(emailCampaignsSearchParamsSchema, await searchParams);
  const page = await listEmailCampaigns(params);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Email history"
        description="Every campaign sent from this dashboard, with the delivery result for each recipient."
        actions={
          <Button variant="outline" render={<Link href="/emails" />}>
            <PenLine data-icon="inline-start" />
            Compose
          </Button>
        }
      />
      <CampaignsView params={params} page={page} />
    </div>
  );
}
