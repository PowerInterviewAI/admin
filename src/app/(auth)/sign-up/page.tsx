import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isFirstAccount } from "@/server/actions/auth";

import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage() {
  // This route reads no search params, so without an explicit request dependency Next prerenders
  // it at build time - against a database that is not running then, and baking the answer below
  // into the page for good. The dashboard routes are dynamic for their own reasons; this one and
  // `/emails` are the two that have to say so. See "Prerendering against a database that is not
  // running" in CLAUDE.md.
  await connection();

  // Whether this sign-up is the one that bootstraps the admin. Said before anyone types, because
  // "you will get read-only access" is the kind of thing people would rather know in advance than
  // discover after being handed a dashboard with every button disabled.
  const first = await isFirstAccount();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>
          {first
            ? "This is the first account on this dashboard, so it will be the admin."
            : "New accounts get read-only access. An admin can grant you more from the access panel."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <SignUpForm isFirstAccount={first} />

        <p className="text-center text-sm text-muted-foreground">
          Already have one?{" "}
          <Link href="/sign-in" className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
