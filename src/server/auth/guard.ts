import "server-only";

import { redirect } from "next/navigation";

import { SIGN_IN_PATH } from "@/lib/auth-routes";
import { failed } from "@/lib/action-result";
import { hasPermission, type Permission } from "@/lib/rbac";
import type { Account } from "@/lib/schemas/account";
import { getCurrentAccount } from "@/server/auth/session";

/**
 * Server actions are reachable by direct POST, not only through the UI, so hiding a button is a
 * courtesy and never a control. Every action in `src/server/actions/` therefore starts with
 * `denyUnless` or `denySelfService`, before it validates its input or touches the database.
 *
 * They return the failure rather than throwing it, because `{ ok: false, error }` is the shape
 * every action already returns and every caller already toasts - a throw would reach the client as
 * an opaque digest instead. The arm is identical for `ActionResult` and `ActionData<T>`, so one
 * helper covers both.
 */
type Denial = { ok: false; error: string };

const SESSION_EXPIRED = "Your session has expired. Sign in again to continue.";

/**
 * Which permission an action needs follows the page it belongs to, not what it does to the
 * database: an export only reads, but it reads the rows of one list, so it asks for that list's
 * `:read`. A guest's users export works for the same reason the users page does; a reseller's does
 * not, for the same reason they cannot open `/users`.
 */
export async function denyUnless(permission: Permission): Promise<Denial | null> {
  const account = await getCurrentAccount();
  if (!account) return failed(SESSION_EXPIRED);
  if (hasPermission(account.role, permission)) return null;

  const isWrite = !permission.endsWith(":read");
  return failed(
    isWrite
      ? "Your account cannot make this change, so it was not saved."
      : "This part of the dashboard is not available to your account.",
  );
}

/**
 * For the account page's actions, which act only on the caller: renaming yourself, changing your
 * own password, signing out your other devices. Every signed-in account may do these whatever its
 * role, so there is no permission to ask for - only a session.
 */
export async function denySelfService(): Promise<Denial | null> {
  const account = await getCurrentAccount();
  return account ? null : failed(SESSION_EXPIRED);
}

/** For server components that render part of a page only for some roles. */
export async function can(permission: Permission): Promise<boolean> {
  const account = await getCurrentAccount();
  return account !== null && hasPermission(account.role, permission);
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
