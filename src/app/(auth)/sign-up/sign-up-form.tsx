"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { LinkPending } from "@/components/navigation-progress";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type SignUpInput, signUpSchema } from "@/lib/schemas/account";
import { signUp } from "@/server/actions/auth";

export function SignUpForm() {
  const [isSubmitting, startSubmitting] = useTransition();
  const [rejection, setRejection] = useState<string | null>(null);

  /**
   * The address that was just registered, which doubles as "we are done here". Sign-up creates no
   * session - a pending account cannot read a single page - so there is nowhere to navigate to and
   * the form is replaced in place by what happens next.
   */
  const [registered, setRegistered] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "", confirm_password: "" },
  });

  const onSubmit = handleSubmit((values) => {
    setRejection(null);
    startSubmitting(async () => {
      const result = await signUp(values);
      if (!result.ok) {
        setRejection(result.error);
        return;
      }
      setRegistered(result.data.email);
    });
  });

  if (registered) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MailCheck className="size-5" />
        </div>
        <p className="font-medium">Account created</p>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{registered}</span> is waiting for an admin
          to approve it. Once they do, you can sign in with the password you just chose.
        </p>
        <Button variant="outline" className="mt-2 w-full" nativeButton={false} render={<Link href="/sign-in" />}>
          Back to sign in
          <LinkPending />
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input
            id="name"
            autoComplete="name"
            autoFocus
            aria-invalid={!!errors.name}
            {...register("name")}
          />
          <FieldError errors={[errors.name]} />
        </Field>

        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            aria-invalid={!!errors.email}
            {...register("email")}
          />
          <FieldError errors={[errors.email]} />
        </Field>

        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          <FieldDescription>At least 8 characters.</FieldDescription>
          <FieldError errors={[errors.password]} />
        </Field>

        <Field data-invalid={!!errors.confirm_password}>
          <FieldLabel htmlFor="confirm_password">Confirm password</FieldLabel>
          <Input
            id="confirm_password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.confirm_password}
            {...register("confirm_password")}
          />
          <FieldError errors={[errors.confirm_password]} />
        </Field>

        {rejection && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {rejection}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Creating account..." : "Request access"}
        </Button>
      </FieldGroup>
    </form>
  );
}
