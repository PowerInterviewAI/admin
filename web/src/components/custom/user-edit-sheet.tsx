"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Trash2 } from "lucide-react";

import { useDeleteUser, useUpdateUser, useUser } from "@/hooks/use-users";
import type { UserDetail } from "@/lib/types";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { formatDate, formatNumber, titleCase } from "@/lib/format";

const userFormSchema = z.object({
  username: z.string().min(1, "Username is required"),
  email: z.string().email("Enter a valid email"),
  role: z.enum(["user", "trial_user", "admin"]),
  status: z.enum(["active", "inactive"]),
  credits: z.number().int().min(0, "Credits cannot be negative"),
});

type UserFormValues = z.infer<typeof userFormSchema>;

interface UserEditSheetProps {
  userId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserEditSheet({ userId, open, onOpenChange }: UserEditSheetProps) {
  const { data, isLoading } = useUser(userId);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit user</SheetTitle>
          <SheetDescription>Update role, status, and credit balance.</SheetDescription>
        </SheetHeader>

        {isLoading || !data || !userId ? (
          <div className="flex flex-col gap-4 px-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          // Keyed by user id so the form mounts fresh (correct defaultValues, no async resync race)
          // every time a different user is selected, instead of reactively syncing in place.
          <UserEditForm key={userId} userId={userId} data={data} onClose={() => onOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function UserEditForm({
  userId,
  data,
  onClose,
}: {
  userId: string;
  data: UserDetail;
  onClose: () => void;
}) {
  const updateUser = useUpdateUser(userId);
  const deleteUser = useDeleteUser();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: {
      username: data.user.username,
      email: data.user.email,
      role: data.user.role,
      status: data.user.status,
      credits: data.user.credits,
    },
  });

  const onSubmit = handleSubmit((values) => {
    updateUser.mutate(values, { onSuccess: onClose });
  });

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4">
        <form id="user-edit-form" onSubmit={onSubmit}>
          <FieldGroup>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Badge variant="outline">{formatNumber(data.payment_count)} payments</Badge>
              <Badge variant="outline">{formatNumber(data.session_count)} sessions</Badge>
              <span>Joined {formatDate(data.user.created_at)}</span>
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
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="trial_user">Trial User</SelectItem>
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
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
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
              <FieldDescription>Selects the LLM tier; does not gate access.</FieldDescription>
              <FieldError errors={[errors.credits]} />
            </Field>
          </FieldGroup>
        </form>
      </div>

      <SheetFooter className="flex-row justify-between border-t">
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
            <Trash2 data-icon="inline-start" />
            Delete
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this user?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes {data.user.email} from the database. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  deleteUser.mutate(userId, {
                    onSuccess: () => {
                      setDeleteOpen(false);
                      onClose();
                    },
                  });
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Button type="submit" form="user-edit-form" disabled={!isDirty || updateUser.isPending}>
          {updateUser.isPending ? "Saving..." : "Save changes"}
        </Button>
      </SheetFooter>
    </>
  );
}
