import { Badge } from "@/components/ui/badge";
import { ACCOUNT_STATUS_LABELS, type AccountStatus } from "@/lib/schemas/account";

/**
 * Pending is the one that wants attention, so it gets the emphasised variant rather than approved:
 * an approved account is the resting state and needs no colour, while a pending one is a decision
 * somebody still owes. Rejected reads as destructive because that is what it did.
 */
const STATUS_VARIANT: Record<AccountStatus, "default" | "secondary" | "destructive"> = {
  pending: "default",
  approved: "secondary",
  rejected: "destructive",
};

export function StatusBadge({ status }: { status: AccountStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{ACCOUNT_STATUS_LABELS[status]}</Badge>;
}
