"use client";

import { KeyRound, LogOut, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { AccountPasswordDialog } from "@/components/account-password-dialog";
import { useCanWrite } from "@/components/session-context";
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldTitle,
} from "@/components/ui/field";
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
import { formatDate, formatNumber } from "@/lib/format";
import {
  ACCOUNT_ROLES,
  ACCOUNT_ROLE_DESCRIPTIONS,
  ACCOUNT_ROLE_LABELS,
  type AccountRole,
  type AccountRow,
} from "@/lib/schemas/account";
import {
  deleteAdminAccount,
  setAccountRole,
  signOutAccountEverywhere,
} from "@/server/actions/accounts";

interface AccountEditSheetProps {
  account: AccountRow | null;
  isSelf: boolean;
  onClose: () => void;
}

export function AccountEditSheet({ account, isSelf, onClose }: AccountEditSheetProps) {
  return (
    <Sheet open={!!account} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Dashboard account</SheetTitle>
          <SheetDescription>
            What this person can do in the admin tool. Nothing here affects their Power Interview
            account, if they have one.
          </SheetDescription>
        </SheetHeader>

        {account && (
          // Keyed by id so every control starts from the selected account's own values rather
          // than resyncing in place - the same rule the user and payment sheets follow.
          <AccountEditForm key={account._id} account={account} isSelf={isSelf} onClose={onClose} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function AccountEditForm({
  account,
  isSelf,
  onClose,
}: {
  account: AccountRow;
  isSelf: boolean;
  onClose: () => void;
}) {
  const canWrite = useCanWrite();
  const [role, setRole] = useState<AccountRole>(account.role);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isSaving, startSaving] = useTransition();
  const [isRevoking, startRevoking] = useTransition();
  const [isDeleting, startDeleting] = useTransition();

  /**
   * An admin cannot demote, sign out, or delete their own account. That is the lockout guard, and
   * the action enforces it too - disabling the controls here is what stops the server's refusal
   * reading as a bug. Changing your own password is the one thing you may do to yourself, which is
   * why the password row is not covered by this.
   */
  const canActOnAccount = canWrite && !isSelf;

  const onSaveRole = () => {
    startSaving(async () => {
      const result = await setAccountRole(account._id, { role });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${account.email} is now ${ACCOUNT_ROLE_LABELS[role].toLowerCase()}`);
      onClose();
    });
  };

  const onRevoke = () => {
    startRevoking(async () => {
      const result = await signOutAccountEverywhere(account._id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Signed out of every device");
    });
  };

  const onDelete = () => {
    startDeleting(async () => {
      const result = await deleteAdminAccount(account._id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Account deleted");
      setDeleteOpen(false);
      onClose();
    });
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4">
        <FieldGroup>
          <div className="flex flex-col gap-1 rounded-md border px-3 py-2">
            <span className="font-medium">{account.name || "Unnamed"}</span>
            <span className="text-sm text-muted-foreground">{account.email}</span>
            <span className="pt-1 text-xs text-muted-foreground">
              Added {formatDate(account.created_at)} - last signed in{" "}
              {account.last_login_at ? formatDate(account.last_login_at) : "never"}
            </span>
          </div>

          <Field>
            <FieldLabel htmlFor="account-role">Role</FieldLabel>
            <Select
              value={role}
              onValueChange={(value) => value && setRole(value as AccountRole)}
              disabled={!canActOnAccount}
            >
              <SelectTrigger id="account-role" className="w-full">
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
            <FieldDescription>
              {isSelf
                ? "You cannot change your own role. Another admin has to do it."
                : ACCOUNT_ROLE_DESCRIPTIONS[role]}
            </FieldDescription>
          </Field>

          <FieldSeparator>Sessions</FieldSeparator>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Password</FieldTitle>
              <FieldDescription>
                Sets a new password without the current one, and signs this account out everywhere.
              </FieldDescription>
            </FieldContent>
            <Button
              variant="outline"
              size="sm"
              disabled={!canWrite}
              onClick={() => setPasswordOpen(true)}
            >
              <KeyRound data-icon="inline-start" />
              Set password
            </Button>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>
                {account.session_count > 0
                  ? `${formatNumber(account.session_count)} live ${
                      account.session_count === 1 ? "session" : "sessions"
                    }`
                  : "No live sessions"}
              </FieldTitle>
              <FieldDescription>
                Ends every sign-in this account holds. The password keeps working.
              </FieldDescription>
            </FieldContent>
            <Button
              variant="outline"
              size="sm"
              disabled={!canActOnAccount || isRevoking || account.session_count === 0}
              onClick={onRevoke}
            >
              <LogOut data-icon="inline-start" />
              {isRevoking ? "Signing out..." : "Sign out"}
            </Button>
          </Field>
        </FieldGroup>
      </div>

      <SheetFooter className="flex-row justify-between border-t">
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogTrigger
            render={<Button variant="destructive" size="sm" disabled={!canActOnAccount} />}
          >
            <Trash2 data-icon="inline-start" />
            Delete
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this account?</AlertDialogTitle>
              <AlertDialogDescription>
                {account.email} loses access to this dashboard immediately, on every device. Their
                Power Interview account, if they have one, is untouched.
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

        <Button
          disabled={!canActOnAccount || role === account.role || isSaving}
          onClick={onSaveRole}
        >
          {isSaving ? "Saving..." : "Save role"}
        </Button>
      </SheetFooter>

      <AccountPasswordDialog
        accountId={account._id}
        email={account.email}
        isSelf={isSelf}
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />
    </>
  );
}
