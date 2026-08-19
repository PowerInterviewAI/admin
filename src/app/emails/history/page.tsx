import type { Metadata } from "next";
import Link from "next/link";
import { PenLine } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { emailCampaignsSearchParamsSchema, parseSearchParams } from "@/lib/search-params";
import { describeEmailSetup } from "@/server/email/transport";
import { listEmailCampaigns } from "@/server/queries/email-campaigns";

import { CampaignsView } from "./campaigns-view";

export const metadata: Metadata = { title: "Email history" };

export default async function EmailHistoryPage({ searchParams }: PageProps<"/emails/history">) {
  const params = parseSearchParams(emailCampaignsSearchParamsSchema, await searchParams);
  const page = await listEmailCampaigns(params);
  // The stored campaign body is the fragment the admin wrote, not the document that was sent, so
  // the detail dialog re-renders it through the same layout - which needs the app name the footer
  // and header carry.
  const { appName } = describeEmailSetup();

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Email history"
        description="Every campaign sent from this dashboard, with the delivery result for each recipient."
        actions={
          <Button variant="outline" nativeButton={false} render={<Link href="/emails" />}>
            <PenLine data-icon="inline-start" />
            Compose
          </Button>
        }
      />
      <CampaignsView
        params={params}
        page={page}
        appName={appName}
        year={new Date().getFullYear()}
      />
    </div>
  );
}
