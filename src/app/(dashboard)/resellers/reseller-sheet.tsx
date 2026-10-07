"use client";

import { KeyRound } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ReadOnlyNotice } from "@/components/read-only-notice";
import { RelatedLink } from "@/components/related-link";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDate, formatRate } from "@/lib/format";
import type { ResellerOverviewRow } from "@/lib/schemas/reseller";
import { revokeResellerApiKey, setResellerRate } from "@/server/actions/resellers";

export function ResellerSheet({
  reseller,
  onClose,
}: {
  reseller: ResellerOverviewRow | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!reseller} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{reseller?.name || reseller?.email || "Reseller"}</SheetTitle>
          <SheetDescription>
            Their sign-in is managed from Access. Here: what they are charged, and their key.
          </SheetDescription>
        </SheetHeader>

        {/* Keyed by id so the rate field mounts with this reseller's value rather than resyncing. */}
        {reseller && <ResellerDetail key={reseller.id} reseller={reseller} />}
      </SheetContent>
    </Sheet>
  );
}

function ResellerDetail({ reseller }: { reseller: ResellerOverviewRow }) {
  const canManage = useCan("resellers:manage");
  const [rate, setRate] = useState(
    reseller.rate_cents_per_hour === null ? "" : (reseller.rate_cents_per_hour / 100).toFixed(2),
  );
  const [isSaving, startSaving] = useTransition();
  const [isRevoking, startRevoking] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const onSaveRate = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = rate.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && !Number.isFinite(value)) {
      toast.error("Enter the rate as a number of dollars, like 12.50");
      return;
    }
    startSaving(async () => {
      const result = await setResellerRate(reseller.id, { usd_per_hour: value });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(value === null ? "Rate cleared" : "Rate saved");
    });
  };

  const onRevoke = () => {
    startRevoking(async () => {
      const result = await revokeResellerApiKey(reseller.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Key revoked. Their app is cut off until they issue a new one.");
      setConfirmOpen(false);
    });
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-6">
      <ReadOnlyNotice permission="resellers:manage" className="mt-4" />

      <FieldGroup className="mt-4">
        <div className="flex flex-wrap gap-2">
          <RelatedLink href={`/resellers/history?reseller_id=${reseller.id}`} label="Their sales" />
          <RelatedLink
            href={`/resellers/settlements?reseller_id=${reseller.id}`}
            label="Their settlements"
          />
        </div>

        <form onSubmit={onSaveRate}>
          <fieldset disabled={!canManage || isSaving}>
            <Field>
              <FieldLabel htmlFor="reseller-rate">Rate (USD per interview hour)</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="reseller-rate"
                  inputMode="decimal"
                  placeholder="Not set"
                  value={rate}
                  onChange={(event) => setRate(event.target.value)}
                />
                <Button type="submit">{isSaving ? "Saving..." : "Save"}</Button>
              </div>
              <FieldDescription>
                Currently {formatRate(reseller.rate_cents_per_hour).toLowerCase()}. One hour is 600
                credits. A change prices sales from now on; past sales keep the rate they were sold
                at. Left empty, sales are recorded as unpriced and their days show no amount.
              </FieldDescription>
            </Field>
          </fieldset>
        </form>

        <Field>
          <FieldLabel>API key</FieldLabel>
          {reseller.key.prefix ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <KeyRound className="size-4 text-muted-foreground" />
                <span className="font-mono">{reseller.key.prefix}...</span>
              </span>
              <span className="text-xs text-muted-foreground">
                issued {formatDate(reseller.key.created_at)}
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No key. The reseller issues one from their own portal.
            </p>
          )}
          <FieldDescription>
            Only the reseller can see a key, once, when they issue it. Revoking stops their app at
            once without signing them out; to stop everything, reject the account in Access.
          </FieldDescription>
        </Field>

        {reseller.key.prefix && canManage && (
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger render={<Button variant="destructive" className="self-start" />}>
              Revoke key
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke this reseller&apos;s key?</AlertDialogTitle>
                <AlertDialogDescription>
                  Their app stops working immediately. They can issue a new key from their portal
                  unless you also reject their account.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" disabled={isRevoking} onClick={onRevoke}>
                  {isRevoking ? "Revoking..." : "Revoke"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </FieldGroup>
    </div>
  );
}
