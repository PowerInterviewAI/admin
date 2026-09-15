import { ShieldAlert } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { isAdminRequest } from "@/server/auth/guard";

/**
 * Wraps the layout of every segment under `ADMIN_ONLY_PATHS`, and is the real control behind the
 * hidden sidebar entries: a guest who types the URL, follows a bookmark, or signs in with
 * `?next=/emails` lands here instead of on the page.
 *
 * The page is `children`, an element this never renders for a guest, so its queries never run -
 * nothing about those rows is fetched, let alone serialised into the response. Putting the check
 * in the segment layout rather than at the top of each page is the same rule `(dashboard)/layout`
 * follows for `requireAccount`: a route added under `/emails` tomorrow inherits it.
 *
 * It explains rather than redirects. A guest bounced to the dashboard would be looking at a page
 * they did not ask for with nothing on screen saying why the one they wanted went away.
 */
export async function AdminGate({ children }: { children: React.ReactNode }) {
  if (await isAdminRequest()) return children;

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ShieldAlert />
        </EmptyMedia>
        <EmptyTitle>Admins only</EmptyTitle>
        <EmptyDescription>
          Your account has guest access, which covers the product data this dashboard reports on.
          This page is not part of that. An admin can change your role from Dashboard access.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
