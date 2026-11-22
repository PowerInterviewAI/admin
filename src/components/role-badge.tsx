import { Badge } from "@/components/ui/badge";
import { ACCOUNT_ROLE_LABELS, type AccountRole } from "@/lib/schemas/account";

/**
 * Admin reads as the emphasised state and guest as the quiet one. Shared so the header, the access table and the edit sheet cannot drift into three
 * conventions for the same words. Styling only: what a role may do is `src/lib/rbac.ts`.
 */
const ROLE_BADGE_VARIANTS: Record<AccountRole, "default" | "outline"> = {
  admin: "default",
  guest: "outline",
};

export function RoleBadge({ role }: { role: AccountRole }) {
  return <Badge variant={ROLE_BADGE_VARIANTS[role]}>{ACCOUNT_ROLE_LABELS[role]}</Badge>;
}
