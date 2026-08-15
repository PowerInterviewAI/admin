"use client";

import { useForm, Controller } from "react-hook-form";

import { useUpdatePayment } from "@/hooks/use-payments";
import type { Payment, PaymentStatus } from "@/lib/types";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate, formatUsd, titleCase } from "@/lib/format";

const STATUSES: PaymentStatus[] = [
  "pending",
  "waiting",
  "confirming",
  "confirmed",
  "sending",
  "partially_paid",
  "finished",
  "failed",
  "refunded",
  "expired",
];

interface PaymentFormValues {
  status: PaymentStatus;
  credits_applied: boolean;
}

interface PaymentEditSheetProps {
  payment: Payment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PaymentEditSheet({ payment, open, onOpenChange }: PaymentEditSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit payment</SheetTitle>
          <SheetDescription>
            Manual override only - does not call NOWPayments or re-run webhook logic.
          </SheetDescription>
        </SheetHeader>

        {payment && (
          // Keyed by payment id so the form mounts fresh (correct defaultValues, no async resync race)
          // every time a different payment is selected, instead of reactively syncing in place.
          <PaymentEditForm key={payment._id} payment={payment} onClose={() => onOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function PaymentEditForm({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const updatePayment = useUpdatePayment(payment._id);

  const { control, handleSubmit, formState } = useForm<PaymentFormValues>({
    defaultValues: { status: payment.status, credits_applied: payment.credits_applied },
  });

  const onSubmit = handleSubmit((values) => {
    updatePayment.mutate(values, { onSuccess: onClose });
  });

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4">
        <form id="payment-edit-form" onSubmit={onSubmit}>
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
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {titleCase(s)}
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
              Toggling this does not itself credit or debit the user - it only records whether it happened.
            </FieldDescription>
          </FieldGroup>
        </form>
      </div>

      <SheetFooter className="border-t">
        <Button type="submit" form="payment-edit-form" disabled={!formState.isDirty || updatePayment.isPending}>
          {updatePayment.isPending ? "Saving..." : "Save changes"}
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
