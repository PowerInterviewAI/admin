"use client";

import { LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { usePendingNavigation } from "@/components/navigation-progress";
import { RoleBadge } from "@/components/role-badge";
import { useCanAccess, useSession } from "@/components/session-context";
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
import { SIGN_IN_PATH } from "@/lib/auth-routes";
import { ACCOUNT_ROLE_SUMMARIES } from "@/lib/schemas/account";
import { signOut } from "@/server/actions/auth";

/** First letter of the name, falling back to the email - an avatar without an image to load. */
function initial(name: string, email: string): string {
  return (name.trim() || email).charAt(0).toUpperCase();
}

export function AccountMenu() {
  const account = useSession();
  const canAccessAccess = useCanAccess("/access");
  const router = useRouter();
  const [isSigningOut, startSigningOut] = useTransition();
  const [isNavigating, startNavigating] = useTransition();
  usePendingNavigation(isNavigating);

  // A menu item is not a `<Link>`, so nothing prefetches these and the click would otherwise sit
  // on the old page with no sign it was taken.
  const go = (href: string) => startNavigating(() => router.push(href));

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
                <span className="text-xs text-muted-foreground">{ACCOUNT_ROLE_SUMMARIES[account.role]}</span>
              </span>
            </div>
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          {/* The password form moved out of this menu and onto its own page when the account page
              arrived: it sits beside the name and the device list, which are the same kind of
              thing, rather than being a dialog reachable only from a dropdown. */}
          <DropdownMenuItem onClick={() => go("/account")}>
            <UserRound />
            Your account
          </DropdownMenuItem>

          {canAccessAccess && (
            <DropdownMenuItem onClick={() => go("/access")}>
              <ShieldCheck />
              Dashboard access
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={onSignOut} disabled={isSigningOut}>
            <LogOut />
            {isSigningOut ? "Signing out..." : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

