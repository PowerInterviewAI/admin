"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ACCOUNT_ROLES,
  ACCOUNT_ROLE_DESCRIPTIONS,
  ACCOUNT_ROLE_LABELS,
  type AccountCreateInput,
  type AccountRole,
  accountCreateSchema,
} from "@/lib/schemas/account";
import { createAdminAccount } from "@/server/actions/accounts";

/**
 * Creates an account for somebody else, with its password set here and its role chosen up front.
 *
 * Sign-up is open, so this is not the only way in - but it is the only way to hand someone admin
 * access in one step, and the only way to make an account for a person who is not sitting at the
 * keyboard. The password is typed by the admin and told to the recipient out of band; there is no
 * mail in this flow, which is the honest shape for a tool with a handful of operators.
 */
export function NewAccountDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <UserPlus data-icon="inline-start" />
        New account
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a dashboard account</DialogTitle>
          <DialogDescription>
            Gives someone a sign-in to this admin tool. It is not a Power Interview account and
            grants nothing in the product.
          </DialogDescription>
        </DialogHeader>

        {/* Mounted only while open, so reopening starts clean rather than showing the last
            account's details and password. */}
        {open && <NewAccountForm onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function NewAccountForm({ onDone }: { onDone: () => void }) {
  const [isSaving, startSaving] = useTransition();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<AccountCreateInput>({
    resolver: zodResolver(accountCreateSchema),
    defaultValues: { name: "", email: "", role: "guest", password: "" },
  });

  const onSubmit = handleSubmit((values) => {
    startSaving(async () => {
      const result = await createAdminAccount(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${values.email} can now sign in`);
      onDone();
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="new-account-name">Name</FieldLabel>
          <Input id="new-account-name" aria-invalid={!!errors.name} {...register("name")} />
          <FieldError errors={[errors.name]} />
        </Field>

        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="new-account-email">Email</FieldLabel>
          <Input
            id="new-account-email"
            type="email"
            aria-invalid={!!errors.email}
            {...register("email")}
          />
          <FieldError errors={[errors.email]} />
        </Field>

        <Field>
          <FieldLabel htmlFor="new-account-role">Role</FieldLabel>
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <>
                <Select value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                  <SelectTrigger id="new-account-role" className="w-full">
                    <SelectValue>
                      {(value: string) => ACCOUNT_ROLE_LABELS[value as AccountRole] ?? ""}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_ROLES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {ACCOUNT_ROLE_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>{ACCOUNT_ROLE_DESCRIPTIONS[field.value]}</FieldDescription>
              </>
            )}
          />
        </Field>

        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="new-account-password">Password</FieldLabel>
          <Input
            id="new-account-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          <FieldDescription>
            At least 8 characters. Pass it on yourself - nothing is emailed.
          </FieldDescription>
          <FieldError errors={[errors.password]} />
        </Field>
      </FieldGroup>

      <DialogFooter className="mt-6">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Creating..." : "Create account"}
        </Button>
      </DialogFooter>
    </form>
  );
}
