"use client";

import { createContext, useContext } from "react";

import type { AccountSummary } from "@/lib/schemas/account";

const SessionContext = createContext<AccountSummary | null>(null);

/**
 * Carries the signed-in identity to the client components that have to render differently for a
 * guest. The value is a DTO the dashboard layout resolved on the server - an id, an email, a name
 * and a role, never the document.
 *
 * Nothing this provides is a permission. A guest who edits the role in memory gets the buttons
 * back and every one of them fails in the action, which is where the actual check lives
 * (`denyWrite` in `src/server/auth/guard.ts`). This exists so the interface tells the truth about
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

/** True for an admin. The one question the UI asks about a role, so it gets its own hook. */
export function useCanWrite(): boolean {
  return useSession().role === "admin";
}
