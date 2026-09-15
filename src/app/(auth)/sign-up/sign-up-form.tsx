"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AFTER_SIGN_IN_PATH } from "@/lib/auth-routes";
import { type SignUpInput, signUpSchema } from "@/lib/schemas/account";
import { signUp } from "@/server/actions/auth";

export function SignUpForm({ isFirstAccount }: { isFirstAccount: boolean }) {
  const router = useRouter();
  const [isSubmitting, startSubmitting] = useTransition();
  const [rejection, setRejection] = useState<string | null>(null);

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

      // Signing up signs you in, so this goes to the dashboard rather than back to a login form.
      toast.success(
        result.data.role === "admin"
          ? "Account created. You are this dashboard's admin."
          : "Account created with read-only access.",
      );
      router.replace(AFTER_SIGN_IN_PATH);
      router.refresh();
    });
  });

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
          {isSubmitting
            ? "Creating account..."
            : isFirstAccount
              ? "Create admin account"
              : "Create account"}
        </Button>
      </FieldGroup>
    </form>
  );
}
