"use client";

import { KeyRound, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { AccountPasswordDialog } from "@/components/account-password-dialog";
import { RoleBadge } from "@/components/role-badge";
import { useSession } from "@/components/session-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ACCOUNT_ROLE_DESCRIPTIONS, type AccountRole } from "@/lib/schemas/account";
import { SIGN_IN_PATH } from "@/lib/auth-routes";
import { signOut } from "@/server/actions/auth";

/** First letter of the name, falling back to the email - an avatar without an image to load. */
function initial(name: string, email: string): string {
  return (name.trim() || email).charAt(0).toUpperCase();
}

export function AccountMenu() {
  const account = useSession();
  const router = useRouter();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [isSigningOut, startSigningOut] = useTransition();

  const onSignOut = () => {
    startSigningOut(async () => {
      const result = await signOut();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // `replace`, not `push`: the dashboard behind you now needs a session you no longer have, so
      // leaving it on the back stack only offers a page that will bounce.
      router.replace(SIGN_IN_PATH);
      router.refresh();
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" aria-label="Your account" />}
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initial(account.name, account.email)}
          </span>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{account.name || "Your account"}</span>
                <span className="truncate text-xs text-muted-foreground">{account.email}</span>
                <span className="flex items-center gap-2 pt-1">
                  <RoleBadge role={account.role} />
                  <span className="text-xs text-muted-foreground">
                    {describeAccess(account.role)}
                  </span>
                </span>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={() => setPasswordOpen(true)}>
              <KeyRound />
              Change password
            </DropdownMenuItem>

            <DropdownMenuItem
              onClick={() => router.push("/access")}
              // Guests can read the panel like they read every other page; only its controls are
              // theirs to look at rather than use.
            >
              {account.role === "admin" ? <ShieldCheck /> : <UserRound />}
              Dashboard access
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={onSignOut} disabled={isSigningOut}>
              <LogOut />
              {isSigningOut ? "Signing out..." : "Sign out"}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <AccountPasswordDialog
        accountId={account.id}
        email={account.email}
        isSelf
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />
    </>
  );
}

function describeAccess(role: AccountRole): string {
  return role === "admin" ? "Full access" : ACCOUNT_ROLE_DESCRIPTIONS.guest.split(".")[0] ?? "";
}
