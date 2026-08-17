"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, KeyRound } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type UserPassword, type UserRow, userPasswordSchema } from "@/lib/schemas/user";
import { setUserPassword } from "@/server/actions/users";

export function SetPasswordDialog({ user }: { user: UserRow }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <KeyRound data-icon="inline-start" />
        Set password
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set a new password</DialogTitle>
          <DialogDescription>
            This replaces {user.email}&apos;s password immediately and signs out every device they
            are currently signed in on.
          </DialogDescription>
        </DialogHeader>

        {/* Mounted only while open, so each visit starts on an empty form rather than showing the
            password typed the last time the dialog was opened. */}
        {open && <SetPasswordForm user={user} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function SetPasswordForm({ user, onDone }: { user: UserRow; onDone: () => void }) {
  const [reveal, setReveal] = useState(false);
  const [isSaving, startSaving] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UserPassword>({
    resolver: zodResolver(userPasswordSchema),
    defaultValues: { password: "", confirm_password: "" },
  });

  const onSubmit = handleSubmit((values) => {
    startSaving(async () => {
      const result = await setUserPassword(user._id, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Password set. Existing sessions were revoked.");
      onDone();
    });
  });

  return (
    <form onSubmit={onSubmit}>
      <FieldGroup>
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
          <div className="flex gap-1.5">
            <Input
              id="new-password"
              // The admin has to read this back to the person it belongs to, so the field can be
              // revealed. Autocomplete is off in both states: this is someone else's credential
              // and has no business landing in the browser's password manager.
              type={reveal ? "text" : "password"}
              autoComplete="off"
              autoFocus
              aria-invalid={!!errors.password}
              {...register("password")}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label={reveal ? "Hide password" : "Show password"}
              onClick={() => setReveal((current) => !current)}
            >
              {reveal ? <EyeOff /> : <Eye />}
            </Button>
          </div>
          <FieldError errors={[errors.password]} />
        </Field>

        <Field data-invalid={!!errors.confirm_password}>
          <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
          <Input
            id="confirm-password"
            type={reveal ? "text" : "password"}
            autoComplete="off"
            aria-invalid={!!errors.confirm_password}
            {...register("confirm_password")}
          />
          <FieldError errors={[errors.confirm_password]} />
        </Field>
      </FieldGroup>

      <DialogFooter className="mt-4">
        <Button type="button" variant="outline" disabled={isSaving} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Setting..." : "Set password"}
        </Button>
      </DialogFooter>
    </form>
  );
}
