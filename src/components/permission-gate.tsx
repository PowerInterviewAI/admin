import { ShieldAlert } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { hasPermission, type Permission } from "@/lib/rbac";
import { ACCOUNT_ROLE_LABELS } from "@/lib/schemas/account";
import { getCurrentAccount } from "@/server/auth/session";

/**
 * Wraps the layout of every gated segment, and is the real control behind the hidden sidebar
 * entries: an account that types the URL, follows a bookmark, or signs in with `?next=/emails`
 * lands here instead of on the page.
 *
 * The page is `children`, an element this never renders without the permission, so its queries
 * never run - nothing about those rows is fetched, let alone serialised into the response. Putting
 * the check in the segment layout rather than at the top of each page is the same rule
 * `(dashboard)/layout` follows for `requireAccount`: a route added under `/emails` tomorrow
 * inherits it.
 *
 * It explains rather than redirects. An account bounced elsewhere would be looking at a page they
 * did not ask for with nothing on screen saying why the one they wanted went away.
 */
export async function PermissionGate({
  need,
  children,
}: {
  need: Permission;
  children: React.ReactNode;
}) {
  const account = await getCurrentAccount();
  if (account && hasPermission(account.role, need)) return children;

  const role = account ? ACCOUNT_ROLE_LABELS[account.role].toLowerCase() : null;

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ShieldAlert />
        </EmptyMedia>
        <EmptyTitle>Not available to your account</EmptyTitle>
        <EmptyDescription>
          {role ? `Your account has ${role} access, and this page is not part of it.` : null} An
          admin can change your role from Dashboard access.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
