"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type AccountPassword, accountPasswordSchema } from "@/lib/schemas/account";
import { setAccountPassword } from "@/server/actions/accounts";

interface AccountPasswordDialogProps {
  accountId: string;
  email: string;
  /** True when this is the signed-in account changing its own password. */
  isSelf: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Sets a dashboard account's password. Used twice: from the account menu on yourself, and from the
 * access panel on somebody else. The two differ only in what the copy has to warn about, since
 * setting your own password keeps the tab you set it in while setting someone else's ends every
 * session they have.
 */
export function AccountPasswordDialog({
  accountId,
  email,
  isSelf,
  open,
  onOpenChange,
}: AccountPasswordDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isSelf ? "Change your password" : "Set a new password"}</DialogTitle>
          <DialogDescription>
            {isSelf
              ? "Signs out every other device you are signed in on. This tab stays signed in."
              : `Replaces ${email}'s password and signs that account out everywhere.`}
          </DialogDescription>
        </DialogHeader>

        {/* Mounted only while open, so reopening never shows what was typed last time - the same
            rule the product user's set-password dialog follows. */}
        {open && (
          <AccountPasswordForm
            accountId={accountId}
            isSelf={isSelf}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AccountPasswordForm({
  accountId,
  isSelf,
  onDone,
}: {
  accountId: string;
  isSelf: boolean;
  onDone: () => void;
}) {
  const [reveal, setReveal] = useState(false);
  const [isSaving, startSaving] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AccountPassword>({
    resolver: zodResolver(accountPasswordSchema),
    defaultValues: { password: "", confirm_password: "" },
  });

  const onSubmit = handleSubmit((values) => {
    startSaving(async () => {
      const result = await setAccountPassword(accountId, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(isSelf ? "Your password was changed" : "Password set");
      onDone();
    });
  });

  return (
    <form onSubmit={onSubmit}>
      <FieldGroup>
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="account-password">New password</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="account-password"
              type={reveal ? "text" : "password"}
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              {...register("password")}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={reveal ? "Hide password" : "Show password"}
              onClick={() => setReveal((value) => !value)}
            >
              {reveal ? <EyeOff /> : <Eye />}
            </Button>
          </div>
          <FieldError errors={[errors.password]} />
        </Field>

        <Field data-invalid={!!errors.confirm_password}>
          <FieldLabel htmlFor="account-confirm-password">Confirm password</FieldLabel>
          <Input
            id="account-confirm-password"
            type={reveal ? "text" : "password"}
            autoComplete="new-password"
            aria-invalid={!!errors.confirm_password}
            {...register("confirm_password")}
          />
          <FieldError errors={[errors.confirm_password]} />
        </Field>
      </FieldGroup>

      <DialogFooter className="mt-6">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Set password"}
        </Button>
      </DialogFooter>
    </form>
  );
}
