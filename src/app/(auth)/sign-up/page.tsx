import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Request access" };

/**
 * No `connection()` here, unlike the version that read the database to decide whether this would
 * be the first account. Nothing on this page depends on a request or on any stored state now that
 * every sign-up produces the same pending account, so letting Next prerender it is correct.
 */
export default function SignUpPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Request access</CardTitle>
        <CardDescription>
          Creates a dashboard account. An admin has to approve it before you can sign in.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <SignUpForm />

        <p className="text-center text-sm text-muted-foreground">
          Already approved?{" "}
          <Link href="/sign-in" className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
