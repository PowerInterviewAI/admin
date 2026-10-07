import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { requireAccount } from "@/server/auth/guard";
import { countAccountSessions } from "@/server/auth/accounts";

import { AccountView } from "./account-view";

export const metadata: Metadata = { title: "Your account" };

/**
 * Your own account: who you are signed in as, and the two things you can change about it without
 * an admin - your name and your password.
 *
 * Reachable by every signed-in account regardless of role. Changing your own password is not a
 * write a guest should have to ask permission for, which is why the actions behind this page are
 * guarded by `denySelfService` rather than a permission - they act only on the caller.
 */
export default async function AccountPage() {
  const account = await requireAccount();
  const sessionCount = await countAccountSessions(account._id);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Your account"
        description="Your sign-in to this dashboard. Separate from any Power Interview account you may have."
        autoRefresh={false}
      />

      <AccountView account={account} sessionCount={sessionCount} />
    </div>
  );
}
