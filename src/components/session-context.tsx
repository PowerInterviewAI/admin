"use client";

import { createContext, useContext } from "react";

import { canAccessPath, hasPermission, type Permission } from "@/lib/rbac";
import type { AccountSummary } from "@/lib/schemas/account";

const SessionContext = createContext<AccountSummary | null>(null);

/**
 * Carries the signed-in identity to the client components that have to render differently for a
 * guest. The value is a DTO the dashboard layout resolved on the server - an id, an email, a name
 * and a role, never the document.
 *
 * Nothing this provides is a permission. A guest who edits the role in memory gets the buttons
 * back and every one of them fails in the action, which is where the actual check lives
 * (`denyUnless` in `src/server/auth/guard.ts`). This exists so the interface tells the truth about
 * what will work, not so the interface enforces it.
 */
export function SessionProvider({
  account,
  children,
}: {
  account: AccountSummary;
  children: React.ReactNode;
}) {
  return <SessionContext.Provider value={account}>{children}</SessionContext.Provider>;
}

export function useSession(): AccountSummary {
  const account = useContext(SessionContext);
  if (!account) {
    throw new Error("useSession was called outside the dashboard layout's SessionProvider");
  }
  return account;
}

/**
 * Whether the signed-in role holds `permission`. The question every button and notice asks, so the
 * interface and `denyUnless` read the same table and cannot disagree about what will work.
 */
export function useCan(permission: Permission): boolean {
  return hasPermission(useSession().role, permission);
}

/**
 * Whether this account may open `href` at all. Used to drop links to pages the role cannot open
 * rather than leave them pointing at the gate's refusal.
 *
 * Like `useCan`, it gates the interface and gates nothing else: `PermissionGate` is what actually
 * refuses the page, and `denyUnless` what refuses the actions behind it.
 */
export function useCanAccess(href: string): boolean {
  return canAccessPath(useSession().role, href);
}
