import { Badge } from "@/components/ui/badge";
import { ACCOUNT_ROLE_LABELS, type AccountRole } from "@/lib/schemas/account";

/**
 * Admin reads as the emphasised state and guest as the quiet one, everywhere the pair appears.
 * Shared so the header, the access table and the edit sheet cannot drift into three conventions
 * for the same two words.
 */
export function RoleBadge({ role }: { role: AccountRole }) {
  return (
    <Badge variant={role === "admin" ? "default" : "outline"}>{ACCOUNT_ROLE_LABELS[role]}</Badge>
  );
}
