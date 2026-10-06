import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { History } from "lucide-react";

import { LinkPending } from "@/components/navigation-progress";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { describeEmailSetup } from "@/server/email/transport";
import { listRecentEmailCampaigns } from "@/server/queries/email-campaigns";
import { countMailableUsers, searchMailableUsers } from "@/server/queries/email-recipients";

import { EmailComposer } from "./email-composer";
import { RecentCampaigns } from "./recent-campaigns";

export const metadata: Metadata = { title: "Email" };

export default async function EmailsPage() {
  // Like the dashboard, this route reads no search params, so without an explicit request
  // dependency Next prerenders it at build time - against a database that is not running then, and
  // baking in an SMTP configuration read from whatever environment the build happened to have.
  await connection();

  const setup = describeEmailSetup();

  const [mailableCount, initialRecipients, recent] = await Promise.all([
    countMailableUsers(),
    searchMailableUsers(""),
    listRecentEmailCampaigns(),
  ]);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Email marketing"
        description="Compose an announcement, preview it exactly as it will arrive, and send it to one user, a chosen few, or the whole active user base."
        // The composer holds an unsent campaign in client state, and the campaign counters below
        // it already poll for themselves.
        autoRefresh={false}
        actions={
          // `nativeButton={false}` because the render prop is an anchor: Base UI otherwise warns
          // that it is stripping native button semantics. Same as `PaginationLink`.
          <Button variant="outline" nativeButton={false} render={<Link href="/emails/history" />}>
            <History data-icon="inline-start" />
            History
            <LinkPending />
          </Button>
        }
      />

      <EmailComposer
        setup={setup}
        mailableCount={mailableCount}
        initialRecipients={initialRecipients}
        year={new Date().getFullYear()}
      />

      <RecentCampaigns campaigns={recent} />
    </div>
  );
}
