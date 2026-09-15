import type { Metadata } from "next";

import { ListSummary } from "@/components/list-summary";
import { PageHeader } from "@/components/page-header";
import { formatDate, formatNumber } from "@/lib/format";
import { listAccounts } from "@/server/auth/accounts";
import { requireAccount } from "@/server/auth/guard";

import { AccessView } from "./access-view";

export const metadata: Metadata = { title: "Dashboard access" };

/**
 * Who can sign in to this dashboard, and as what.
 *
 * Readable by guests like every other page here, which is the whole shape of the two roles: a
 * guest sees the same thing an admin sees and can change none of it. The controls are disabled
 * rather than hidden so the panel still explains what an admin would be able to do.
 */
export default async function AccessPage() {
  // Resolved again rather than passed down, so the table can mark which row is you - and so the
  // "you cannot act on your own account" rule is visible in the UI, not only in the action.
  const [account, accounts] = await Promise.all([requireAccount(), listAccounts()]);

  const pending = accounts.filter((row) => row.status === "pending").length;
  const approved = accounts.filter((row) => row.status === "approved");
  const admins = approved.filter((row) => row.role === "admin").length;
  const signedIn = accounts.reduce((total, row) => total + row.session_count, 0);
  const lastLogin = accounts.reduce<number | null>(
    (latest, row) =>
      row.last_login_at && (!latest || row.last_login_at > latest) ? row.last_login_at : latest,
    null,
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Dashboard access"
        description="Accounts that can sign in to this admin tool. Separate from Power Interview's own users - nothing here grants access to the product."
      />

      <ListSummary
        stats={[
          {
            label: "Waiting for approval",
            value: formatNumber(pending),
            hint: pending === 0 ? "Nothing to decide" : "Cannot sign in until approved",
            // The one number on this page that means somebody is blocked on a person.
            alert: pending > 0,
          },
          {
            label: "Approved",
            value: formatNumber(approved.length),
            hint: `of ${formatNumber(accounts.length)} accounts`,
          },
          {
            label: "Admins",
            value: formatNumber(admins),
            hint: "Can edit, delete, and send email",
          },
          {
            label: "Live sessions",
            value: formatNumber(signedIn),
            hint: "Across every account and device",
          },
          {
            label: "Last sign-in",
            value: formatDate(lastLogin),
            text: true,
          },
        ]}
      />

      <AccessView accounts={accounts} currentAccountId={account._id} />
    </div>
  );
}
