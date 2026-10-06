"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { ReadOnlyNotice } from "@/components/read-only-notice";
import { RelatedLink } from "@/components/related-link";
import { useCanAccess, useCanWrite } from "@/components/session-context";
import { Button } from "@/components/ui/button";
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldTitle,
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatNumber, titleCase } from "@/lib/format";
import {
  EMPTY_INTERVIEW_CONFIG,
  USER_ROLES,
  USER_STATUSES,
  type UserPatch,
  type UserRow,
  userPatchSchema,
} from "@/lib/schemas/user";
import { deleteUser, updateUser } from "@/server/actions/users";

import { SetPasswordDialog } from "./set-password-dialog";

interface UserEditSheetProps {
  user: UserRow | null;
  onClose: () => void;
}

export function UserEditSheet({ user, onClose }: UserEditSheetProps) {
  return (
    <Sheet open={!!user} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Edit user</SheetTitle>
          <SheetDescription>
            Update the account, credit balance, and interview setup.
          </SheetDescription>
        </SheetHeader>

        {user && (
          // Keyed by user id so the form mounts fresh (correct defaultValues, no async resync race)
          // every time a different user is selected, instead of reactively syncing in place.
          <UserEditForm key={user._id} user={user} onClose={onClose} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function UserEditForm({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const canWrite = useCanWrite();
  const canSeeSessions = useCanAccess("/sessions");
  const canSeeAuditLog = useCanAccess("/audit-logs");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isSaving, startSaving] = useTransition();
  const [isDeleting, startDeleting] = useTransition();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<UserPatch>({
    resolver: zodResolver(userPatchSchema),
    defaultValues: {
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      credits: user.credits,
      interview_config: user.interview_config ?? EMPTY_INTERVIEW_CONFIG,
    },
  });

  const onSubmit = handleSubmit((values) => {
    startSaving(async () => {
      const result = await updateUser(user._id, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("User updated");
      onClose();
    });
  });

  const onDelete = () => {
    startDeleting(async () => {
      const result = await deleteUser(user._id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("User deleted");
      setDeleteOpen(false);
      onClose();
    });
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4">
        <ReadOnlyNotice
          className="mt-4"
          message="Your account has read-only access, so this user can be viewed but not changed."
        />

        <form id="user-edit-form" onSubmit={onSubmit}>
          {/* One `disabled` on the fieldset rather than on twenty inputs: the browser takes every
              control inside out of the tab order and refuses to submit them, which is exactly the
              read-only behaviour, and it cannot be forgotten on a field added later. */}
          <fieldset disabled={!canWrite}>
          <FieldGroup>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <RelatedLink
                href={`/payments?user_id=${user._id}`}
                label={`${formatNumber(user.payment_count)} payments`}
              />
              {/* Dropped for a guest rather than left pointing at the gate: both targets are
                  admin-only, and a link to a refusal is worse than no link. */}
              {canSeeSessions && (
                <RelatedLink
                  href={`/sessions?user_id=${user._id}`}
                  label={`${formatNumber(user.session_count)} sessions`}
                />
              )}
              {canSeeAuditLog && (
                <RelatedLink href={`/audit-logs?user_id=${user._id}`} label="Audit log" />
              )}
              <span className="ml-auto">Joined {formatDate(user.created_at)}</span>
            </div>

            <Field data-invalid={!!errors.username}>
              <FieldLabel htmlFor="username">Username</FieldLabel>
              <Input id="username" aria-invalid={!!errors.username} {...register("username")} />
              <FieldError errors={[errors.username]} />
            </Field>

            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" aria-invalid={!!errors.email} {...register("email")} />
              <FieldError errors={[errors.email]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="role">Role</FieldLabel>
              <Controller
                control={control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="role" className="w-full">
                      <SelectValue>{(v: string) => titleCase(v)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {USER_ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {titleCase(role)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

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
                      {USER_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {titleCase(status)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field data-invalid={!!errors.credits}>
              <FieldLabel htmlFor="credits">Credits</FieldLabel>
              <Input
                id="credits"
                type="number"
                min={0}
                aria-invalid={!!errors.credits}
                {...register("credits", { valueAsNumber: true })}
              />
              <FieldDescription>
                Live and mock interviews both spend 10 credits a minute. A session needs a minute
                of credit to start and stops at zero; this balance also selects the LLM tier.
              </FieldDescription>
              <FieldError errors={[errors.credits]} />
            </Field>

            <FieldSeparator>Interview configuration</FieldSeparator>

            {!user.interview_config && (
              <FieldDescription>
                This user has not set up an interview yet. Saving here creates the configuration.
              </FieldDescription>
            )}

            <Field>
              <FieldLabel htmlFor="interview-full-name">Full name</FieldLabel>
              <Input id="interview-full-name" {...register("interview_config.full_name")} />
              <FieldDescription>The name the assistant answers as during a session.</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="interview-profile-data">Profile / CV</FieldLabel>
              <Textarea
                id="interview-profile-data"
                rows={8}
                // The base Textarea is `field-sizing-content`, so a long CV would grow unbounded.
                className="max-h-72 overflow-y-auto"
                {...register("interview_config.profile_data")}
              />
              <FieldDescription>Resume text the answers are grounded in.</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="interview-context">Context</FieldLabel>
              <Textarea
                id="interview-context"
                rows={5}
                className="max-h-72 overflow-y-auto"
                {...register("interview_config.context")}
              />
              <FieldDescription>
                Role, company, or interview details that steer the answers.
              </FieldDescription>
            </Field>
          </FieldGroup>
          </fieldset>
        </form>

        {/* Outside the form on purpose. The footer's submit is bound to `user-edit-form` by id, so
            a password field living inside it would ride along with every ordinary save, and a
            nested <form> is not valid HTML either. */}
        <FieldGroup className="mt-5">
          <FieldSeparator>Password</FieldSeparator>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Overwrite the password</FieldTitle>
              <FieldDescription>
                Sets a new password without the current one. Signs out every device.
              </FieldDescription>
            </FieldContent>
            {canWrite ? (
              <SetPasswordDialog user={user} />
            ) : (
              <span className="text-sm text-muted-foreground">Admins only</span>
            )}
          </Field>
        </FieldGroup>
      </div>

      <SheetFooter className="flex-row justify-between border-t">
        {canWrite ? (
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
            <Trash2 data-icon="inline-start" />
            Delete
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this user?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes {user.email} from the database. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" disabled={isDeleting} onClick={onDelete}>
                {isDeleting ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        ) : (
          <span />
        )}

        <Button
          type="submit"
          form="user-edit-form"
          disabled={!canWrite || !isDirty || isSaving}
        >
          {isSaving ? "Saving..." : "Save changes"}
        </Button>
      </SheetFooter>
    </>
  );
}
