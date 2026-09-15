import type { Metadata } from "next";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNextPath } from "@/lib/auth-routes";
import { readBootstrapConfig } from "@/server/auth/bootstrap";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = Array.isArray(params.next) ? params.next[0] : params.next;

  // Reading the environment, not the database. Without a built-in admin nobody can sign in and
  // nobody can approve anybody, so the page says which variables are missing rather than
  // presenting a form that cannot succeed no matter what is typed into it.
  const bootstrap = readBootstrapConfig();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Use your dashboard account - not a Power Interview login.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {!bootstrap.ok && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="text-sm text-muted-foreground">{bootstrap.error}</p>
          </div>
        )}

        {/* Resolved on the server so a crafted `?next=//evil.example` never reaches the router. */}
        <SignInForm next={safeNextPath(next)} />

        <p className="text-center text-sm text-muted-foreground">
          No account yet?{" "}
          <Link href="/sign-up" className="font-medium text-foreground underline underline-offset-4">
            Request access
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
