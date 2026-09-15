import "server-only";

import { redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/lib/auth-routes";
import { failed } from "@/lib/action-result";
import type { Account } from "@/lib/schemas/account";
import { getCurrentAccount } from "@/server/auth/session";

/**
 * Server actions are reachable by direct POST, not only through the UI, so hiding a button is a
 * courtesy and never a control. Every action in `src/server/actions/` therefore starts with one of
 * the three guards below, before it validates its input or touches the database.
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
 * For actions that only read a page every signed-in account can open - the users and payments
 * exports. A guest may run them: they return what that guest can already see on the page
 * that calls them, and refusing would make read-only mean something narrower than it says.
 */
export async function denyRead(): Promise<Denial | null> {
  const account = await getCurrentAccount();
  if (!account) {
    return failed("Your session has expired. Sign in again to continue.");
  }
  return null;
}

/**
 * For actions that only read, but read a page a guest cannot open (`ADMIN_ONLY_PATHS`): the
 * recipient search, the campaign pollers, the sessions and audit-log exports.
 *
 * `denyRead` would let a guest fetch by direct POST exactly the rows the gate on those pages
 * exists to withhold, and `denyWrite` would refuse them with a message about a change
 * that was never attempted. The rule these enforce is which page the action belongs to, not what
 * it does to the database.
 */
export async function denyAdminArea(): Promise<Denial | null> {
  const account = await getCurrentAccount();
  if (!account) {
    return failed("Your session has expired. Sign in again to continue.");
  }
  if (account.role !== "admin") {
    return failed("This part of the dashboard is limited to admins.");
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

/**
 * For the layouts over `ADMIN_ONLY_PATHS`: the same question `requireAccount` answers, plus the
 * role.
 *
 * It reports rather than redirects, because the caller (`AdminGate`) renders an explanation in
 * place of the page. A bounce to the dashboard would leave a guest who followed a stale link
 * staring at a route they did not ask for, with nothing saying why.
 */
export async function isAdminRequest(): Promise<boolean> {
  const account = await getCurrentAccount();
  return account?.role === "admin";
}
