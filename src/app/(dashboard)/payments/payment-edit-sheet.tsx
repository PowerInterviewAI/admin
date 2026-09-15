"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { ReadOnlyNotice } from "@/components/read-only-notice";
import { RelatedLink } from "@/components/related-link";
import { useCanAccess, useCanWrite } from "@/components/session-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDate, formatUsd, titleCase } from "@/lib/format";
import {
  PAYMENT_STATUSES,
  type PaymentPatch,
  type PaymentRow,
  paymentPatchSchema,
} from "@/lib/schemas/payment";
import { updatePayment } from "@/server/actions/payments";

interface PaymentEditSheetProps {
  payment: PaymentRow | null;
  onClose: () => void;
}

export function PaymentEditSheet({ payment, onClose }: PaymentEditSheetProps) {
  return (
    <Sheet open={!!payment} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit payment</SheetTitle>
          <SheetDescription>
            Manual override only - does not call NOWPayments or re-run webhook logic.
          </SheetDescription>
        </SheetHeader>

        {payment && (
          // Keyed by payment id so the form mounts fresh (correct defaultValues, no async resync
          // race) every time a different payment is selected, instead of syncing in place.
          <PaymentEditForm key={payment._id} payment={payment} onClose={onClose} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function PaymentEditForm({ payment, onClose }: { payment: PaymentRow; onClose: () => void }) {
  const canWrite = useCanWrite();
  const canSeeAuditLog = useCanAccess("/audit-logs");
  const [isSaving, startSaving] = useTransition();

  const { control, handleSubmit, formState } = useForm<PaymentPatch>({
    resolver: zodResolver(paymentPatchSchema),
    defaultValues: { status: payment.status, credits_applied: payment.credits_applied },
  });

  const onSubmit = handleSubmit((values) => {
    startSaving(async () => {
      const result = await updatePayment(payment._id, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Payment updated");
      onClose();
    });
  });

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4">
        <ReadOnlyNotice
          className="mt-4"
          message="Your account has read-only access, so this payment can be viewed but not changed."
        />

        <form id="payment-edit-form" onSubmit={onSubmit}>
          {/* Same fieldset trick as the user sheet: the browser takes every control inside out of
              the tab order and refuses to submit them. */}
          <fieldset disabled={!canWrite}>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="col-span-2">
                <InfoRow label="Order ID" value={payment.order_id} mono />
              </div>
              <InfoRow label="Plan" value={titleCase(payment.plan)} />
              <InfoRow label="Amount" value={formatUsd(payment.price_amount)} />
              <InfoRow label="Credits" value={String(payment.credits_amount)} />
              <InfoRow label="Created" value={formatDate(payment.created_at)} />
              <InfoRow label="Updated" value={formatDate(payment.updated_at)} />
            </div>

            {payment.user && (
              <div className="flex flex-wrap items-center gap-2">
                <RelatedLink
                  href={`/users?q=${encodeURIComponent(payment.user.email)}`}
                  label={payment.user.username}
                />
                <RelatedLink
                  href={`/payments?user_id=${payment.user_id}`}
                  label="Their payments"
                />
                {/* `/audit-logs` is admin-only, so a guest gets no link to it. */}
                {canSeeAuditLog && (
                  <RelatedLink href={`/audit-logs?user_id=${payment.user_id}`} label="Audit log" />
                )}
              </div>
            )}

            <Field>
              <FieldLabel htmlFor="status">Status</FieldLabel>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="status" className="w-full">
                      <SelectValue>{(v: string) => titleCase(v)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {titleCase(status)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field orientation="horizontal">
              <Controller
                control={control}
                name="credits_applied"
                render={({ field }) => (
                  <Checkbox
                    id="credits_applied"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                )}
              />
              <FieldLabel htmlFor="credits_applied" className="font-normal">
                Credits applied to user balance
              </FieldLabel>
            </Field>
            <FieldDescription>
              Toggling this does not itself credit or debit the user - it only records whether it
              happened.
            </FieldDescription>
          </FieldGroup>
          </fieldset>
        </form>
      </div>

      <SheetFooter className="border-t">
        <Button
          type="submit"
          form="payment-edit-form"
          disabled={!canWrite || !formState.isDirty || isSaving}
        >
          {isSaving ? "Saving..." : "Save changes"}
        </Button>
      </SheetFooter>
    </>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Badge variant="outline" className={mono ? "font-mono w-fit" : "w-fit"}>
        {value}
      </Badge>
    </div>
  );
}
