"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, LogOut, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { RoleBadge } from "@/components/role-badge";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatDate, formatNumber } from "@/lib/format";
import {
  ACCOUNT_ROLE_DESCRIPTIONS,
  type Account,
  type AccountProfile,
  type OwnPassword,
  accountProfileSchema,
  ownPasswordSchema,
} from "@/lib/schemas/account";
import {
  changeOwnPassword,
  signOutOtherDevices,
  updateOwnProfile,
} from "@/server/actions/accounts";

export function AccountView({
  account,
  sessionCount,
}: {
  account: Account;
  sessionCount: number;
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <IdentityCard account={account} />
      {/* Keyed by name so the field resets to whatever the server last saved once the action's
          refresh lands, rather than holding the value that was in flight. */}
      <ProfileCard key={account.name} account={account} />
      <PasswordCard />
      <DevicesCard sessionCount={sessionCount} />
    </div>
  );
}

function IdentityCard({ account }: { account: Account }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Signed in as</CardTitle>
        <CardDescription>
          Your email is your login and cannot be changed here. An admin sets your role.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Detail label="Email">
            <span className="font-medium">{account.email}</span>
          </Detail>
          <Detail label="Access">
            <span className="flex flex-wrap items-center gap-2">
              <RoleBadge role={account.role} />
              <StatusBadge status={account.status} />
              {account.is_bootstrap && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ShieldCheck className="size-3" />
                  Built-in admin
                </span>
              )}
            </span>
          </Detail>
          <Detail label="Account created">{formatDate(account.created_at)}</Detail>
          <Detail label="Last sign-in">{formatDate(account.last_login_at)}</Detail>
        </dl>

        <p className="mt-4 border-t pt-4 text-sm text-muted-foreground">
          {ACCOUNT_ROLE_DESCRIPTIONS[account.role]}
        </p>
      </CardContent>
    </Card>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ProfileCard({ account }: { account: Account }) {
  const [isSaving, startSaving] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<AccountProfile>({
    resolver: zodResolver(accountProfileSchema),
    defaultValues: { name: account.name },
  });

  const onSubmit = handleSubmit((values) => {
    startSaving(async () => {
      const result = await updateOwnProfile(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Name saved");
    });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Display name</CardTitle>
        <CardDescription>What other admins see beside your email in the access panel.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="account-name">Name</FieldLabel>
              <Input id="account-name" aria-invalid={!!errors.name} {...register("name")} />
              <FieldError errors={[errors.name]} />
            </Field>
          </FieldGroup>

          <div className="mt-5 flex justify-end">
            <Button type="submit" disabled={!isDirty || isSaving}>
              {isSaving ? "Saving..." : "Save name"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const [reveal, setReveal] = useState(false);
  const [isSaving, startSaving] = useTransition();

  // Bumped after a successful change to remount the form, which is how the three fields clear
  // without an effect resyncing them - the same "remount, don't resync" rule the edit sheets use.
  const [formKey, setFormKey] = useState(0);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OwnPassword>({
    resolver: zodResolver(ownPasswordSchema),
    defaultValues: { current_password: "", password: "", confirm_password: "" },
  });

  const onSubmit = handleSubmit((values) => {
    startSaving(async () => {
      const result = await changeOwnPassword(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Password changed. Every other device was signed out.");
      setFormKey((value) => value + 1);
    });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          Changing it signs out every other device. This tab stays signed in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form key={formKey} onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <Field data-invalid={!!errors.current_password}>
              <FieldLabel htmlFor="current-password">Current password</FieldLabel>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!errors.current_password}
                {...register("current_password")}
              />
              <FieldError errors={[errors.current_password]} />
            </Field>

            <Field data-invalid={!!errors.password}>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="new-password"
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
              <FieldDescription>At least 8 characters.</FieldDescription>
              <FieldError errors={[errors.password]} />
            </Field>

            <Field data-invalid={!!errors.confirm_password}>
              <FieldLabel htmlFor="confirm-new-password">Confirm new password</FieldLabel>
              <Input
                id="confirm-new-password"
                type={reveal ? "text" : "password"}
                autoComplete="new-password"
                aria-invalid={!!errors.confirm_password}
                {...register("confirm_password")}
              />
              <FieldError errors={[errors.confirm_password]} />
            </Field>
          </FieldGroup>

          <div className="mt-5 flex justify-end">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Changing..." : "Change password"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DevicesCard({ sessionCount }: { sessionCount: number }) {
  const [isRevoking, startRevoking] = useTransition();

  // The session running this page is one of them, and it is the one that stays.
  const others = Math.max(0, sessionCount - 1);

  const onRevoke = () => {
    startRevoking(async () => {
      const result = await signOutOtherDevices();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Signed out everywhere else");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Devices</CardTitle>
        <CardDescription>Every browser your account is currently signed in on.</CardDescription>
      </CardHeader>
      <CardContent>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>
              {others === 0
                ? "No other devices"
                : `${formatNumber(others)} other ${others === 1 ? "device" : "devices"}`}
            </FieldTitle>
            <FieldDescription>
              Ends those sessions without changing your password. This tab is unaffected.
            </FieldDescription>
          </FieldContent>
          <Button variant="outline" size="sm" disabled={others === 0 || isRevoking} onClick={onRevoke}>
            <LogOut data-icon="inline-start" />
            {isRevoking ? "Signing out..." : "Sign out"}
          </Button>
        </Field>
      </CardContent>
    </Card>
  );
}
