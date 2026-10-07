"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { useCan } from "@/components/session-context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import type { ResellerSaleRow } from "@/lib/schemas/reseller";
import { resolveUnresolvedSale } from "@/server/actions/resellers";

type Decision = "committed" | "void";

/**
 * The two answers to "did this top-up reach the customer?". Nothing here can be inferred from the
 * row, so each is a confirmed decision with the evidence to check spelled out: this is the point
 * where a reseller either is or is not billed for credits.
 */
export function ResolveSaleButtons({ sale }: { sale: ResellerSaleRow }) {
  const canManage = useCan("resellers:manage");
  const [asking, setAsking] = useState<Decision | null>(null);
  const [isSaving, startSaving] = useTransition();

  if (sale.state !== "unresolved") return null;

  const decide = (decision: Decision) => {
    startSaving(async () => {
      const result = await resolveUnresolvedSale(sale._id, { state: decision });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(decision === "committed" ? "Marked as applied and billed" : "Voided, not billed");
      setAsking(null);
    });
  };

  const who = sale.user?.email ?? sale.customer_email;
  const credits = formatNumber(sale.credits);

  return (
    <div className="flex gap-2" onClick={(event) => event.stopPropagation()}>
      <AlertDialog open={asking === "committed"} onOpenChange={(open) => setAsking(open ? "committed" : null)}>
        <AlertDialogTrigger render={<Button variant="outline" size="sm" disabled={!canManage} />}>
          It was applied
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bill this sale?</AlertDialogTitle>
            <AlertDialogDescription>
              Choose this only if {who} actually received {credits} credits from it: check their
              balance and their audit log. The reseller is billed for them from today, and their app
              stays blocked from retrying this reference.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={isSaving} onClick={() => decide("committed")}>
              {isSaving ? "Saving..." : "Bill it"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={asking === "void"} onOpenChange={(open) => setAsking(open ? "void" : null)}>
        <AlertDialogTrigger render={<Button variant="ghost" size="sm" disabled={!canManage} />}>
          It was not
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this sale?</AlertDialogTitle>
            <AlertDialogDescription>
              Choose this only if {who} did <strong>not</strong> receive these {credits} credits. It
              is not billed, and the reseller must use a new reference to sell again. If the credits
              did arrive, voiding gives them away unbilled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={isSaving} onClick={() => decide("void")}>
              {isSaving ? "Saving..." : "Void it"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
