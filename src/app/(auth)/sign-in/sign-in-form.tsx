"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type SignInInput, signInSchema } from "@/lib/schemas/account";
import { signIn } from "@/server/actions/auth";

export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [isSubmitting, startSubmitting] = useTransition();

  /**
   * Rendered in the form rather than only toasted. A rejected sign-in is the whole result of the
   * page, and a toast that has faded by the time someone finishes re-reading what they typed
   * leaves them looking at a form with no explanation on it.
   */
  const [rejection, setRejection] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit((values) => {
    setRejection(null);
    startSubmitting(async () => {
      const result = await signIn(values);
      if (!result.ok) {
        setRejection(result.error);
        return;
      }

      // The session cookie arrived on this action's response, so the navigation that follows
      // carries it. `replace` keeps the sign-in page off the back stack, and `refresh` re-runs the
      // dashboard layout's own session read rather than trusting anything cached from before.
      router.replace(next);
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
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
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          <FieldError errors={[errors.password]} />
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
          {isSubmitting ? "Signing in..." : "Sign in"}
        </Button>
      </FieldGroup>
    </form>
  );
}
