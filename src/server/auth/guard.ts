import "server-only";

import { redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/lib/auth-routes";
import { failed } from "@/lib/action-result";
import type { Account } from "@/lib/schemas/account";
import { getCurrentAccount } from "@/server/auth/session";

/**
 * Server actions are reachable by direct POST, not only through the UI, so hiding a button is a
 * courtesy and never a control. Every action in `src/server/actions/` therefore starts with one of
 * the two guards below, before it validates its input or touches the database.
 *
 * They return the failure rather than throwing it, because `{ ok: false, error }` is the shape
 * every action already returns and every caller already toasts - a throw would reach the client as
 * an opaque digest instead. The arm is identical for `ActionResult` and `ActionData<T>`, so one
 * helper covers both.
 */
type Denial = { ok: false; error: string };

/**
 * For mutations: admins only.
 *
 * Returns `null` when the caller may proceed. A guest is refused here rather than being allowed a
 * write that a later check might catch, which is what makes "read-only" a property of the server
 * instead of a property of the interface.
 */
export async function denyWrite(): Promise<Denial | null> {
  const account = await getCurrentAccount();
  if (!account) {
    return failed("Your session has expired. Sign in again to continue.");
  }
  if (account.role !== "admin") {
    return failed("Your account has read-only access, so this change was not saved.");
  }
  return null;
}

/**
 * For actions that only read - the CSV exports, the recipient search, the campaign pollers. A
 * guest may run them: they return what that guest can already see on the page that calls them, and
 * refusing would make read-only mean something narrower than it says.
 */
export async function denyRead(): Promise<Denial | null> {
  const account = await getCurrentAccount();
  if (!account) {
    return failed("Your session has expired. Sign in again to continue.");
  }
  return null;
}

/**
 * For pages and layouts: the real check behind the proxy's optimistic one.
 *
 * The proxy only knows whether a cookie is present, which a forged or revoked cookie satisfies
 * too. This is what actually resolves it against the database, and it runs in the dashboard layout
 * so no route underneath can forget to.
 */
export async function requireAccount(): Promise<Account> {
  const account = await getCurrentAccount();
  if (!account) {
    redirect(SIGN_IN_PATH);
  }
  return account;
}
