"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { useCan } from "@/components/session-context";
import { Button } from "@/components/ui/button";
import type { ResellerSettlementRow } from "@/lib/schemas/reseller";
import { setSettlementStatus } from "@/server/actions/resellers";

/**
 * Flips a day between open and paid. No confirmation: it is undone with the same button, and it
 * moves no money - it only records that the admin collected it.
 */
export function MarkPaidButton({ settlement }: { settlement: ResellerSettlementRow }) {
  const canManage = useCan("resellers:manage");
  const [isSaving, startSaving] = useTransition();
  const paid = settlement.status === "paid";

  const onClick = (event: React.MouseEvent) => {
    // The row is clickable in some tables; a button inside it must not also activate the row.
    event.stopPropagation();
    startSaving(async () => {
      const result = await setSettlementStatus(settlement._id, { status: paid ? "open" : "paid" });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(paid ? `${settlement.day} is open again` : `${settlement.day} marked paid`);
    });
  };

  return (
    <Button
      variant={paid ? "ghost" : "outline"}
      size="sm"
      disabled={!canManage || isSaving}
      title={canManage ? undefined : "Your account cannot change settlements"}
      onClick={onClick}
    >
      {isSaving ? "Saving..." : paid ? "Reopen" : "Mark paid"}
    </Button>
  );
}
