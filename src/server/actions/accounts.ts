"use server";

import { refresh } from "next/cache";

import { type ActionResult, failed, ok } from "@/lib/action-result";
import {
  type AccountStatus,
  accountCreateSchema,
  accountPasswordSchema,
  accountProfileSchema,
  accountRoleUpdateSchema,
  accountStatusUpdateSchema,
  ownPasswordSchema,
} from "@/lib/schemas/account";
import {
  createAccount,
  getAccountById,
  readPasswordHash,
  setAccountName,
  setAccountPasswordHash,
} from "@/server/auth/accounts";
import { denySelfService, denyUnless } from "@/server/auth/guard";
import { getCurrentAccount, revokeAccountSessions } from "@/server/auth/session";
import { COLLECTIONS, currentTimestampMs, getCollection, toObjectId } from "@/server/db";
import { AppError, describeWriteError, notFound } from "@/server/errors";
import { verifyPassword } from "@/server/password";

/**
 * The access panel. Every action here is admin-only, and most additionally refuse to act on two
 * kinds of account.
 *
 * **The caller's own** is the lockout guard, and it is deliberately blunt rather than clever. An
 * admin cannot demote, revoke, delete, or sign out their own account, so the account performing an
 * action is always still an approved admin when it finishes - no counting, no transaction, and no
 * window where a concurrent second demotion slips between a count and a write.
 *
 * **The built-in admin** is the recovery guarantee. `ADMIN_EMAIL` names an account that a restart
 * re-asserts as an approved admin, so demoting or deleting it here would only produce a change
 * that silently reverts on the next boot - a worse outcome than refusing it with a reason.
 */
type Denial = { ok: false; error: string };

async function denyActingOnSelf(accountId: string, what: string): Promise<Denial | null> {
  const current = await getCurrentAccount();
  if (current && current._id === accountId) {
    return failed(`You cannot ${what} your own account. Another admin has to do it.`);
  }
  return null;
}

async function denyActingOnBootstrap(accountId: string, what: string): Promise<Denial | null> {
  const account = await getAccountById(accountId);
  if (account?.is_bootstrap) {
    return failed(
      `That is the built-in admin named by ADMIN_EMAIL, so it cannot be ${what}. Change ADMIN_EMAIL and restart to move it.`,
    );
  }
  return null;
}

export async function createAdminAccount(input: unknown): Promise<ActionResult> {
  const denied = await denyUnless("access:manage");
  if (denied) return denied;

  const parsed = accountCreateSchema.safeParse(input);
  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? "The submitted values are not valid");
  }

  try {
    // Created approved, not pending: an admin typing someone's password in *is* the approval, and
    // making them then approve the account they just created would be ceremony rather than a check.
    await createAccount({ ...parsed.data, status: "approved" });
  } catch (error) {
    if (error instanceof AppError) {
      return failed(
        error.code === "conflict" ? "An account already uses that email address" : error.message,
      );
    }
    return failed("Could not create this account");
  }

  refresh();
  return ok;
}

/**
 * Approves, rejects, or sends an account back to pending.
 *
 * Anything other than `approved` revokes that account's sessions, because the status is what
 * decides whether they may be signed in at all - leaving a live session behind would mean the
 * revocation took effect on everyone except the person currently using the dashboard.
 * `getCurrentAccount` re-reads the status on every request too, so this is belt and braces.
 */
export async function setAccountStatus(accountId: string, input: unknown): Promise<ActionResult> {
  const denied = await denyUnless("access:manage");
  if (denied) return denied;

  const parsed = accountStatusUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return failed("That is not a status this dashboard has");
  }

  const status: AccountStatus = parsed.data.status;

  if (status !== "approved") {
    const self = await denyActingOnSelf(accountId, "revoke access to");
    if (self) return self;

    const builtIn = await denyActingOnBootstrap(accountId, "revoked");
    if (builtIn) return builtIn;
  }

  try {
    const result = await getCollection(COLLECTIONS.adminAccounts).updateOne(
      { _id: toObjectId(accountId) },
      { $set: { status, updated_at: currentTimestampMs() } },
    );
    if (result.matchedCount === 0) throw notFound("account");

    if (status !== "approved") {
      await revokeAccountSessions(accountId);
    }
  } catch (error) {
    return failed(
      error instanceof AppError ? error.message : "Could not change this account's access",
    );
  }

  refresh();
  return ok;
}

export async function setAccountRole(accountId: string, input: unknown): Promise<ActionResult> {
  const denied = await denyUnless("access:manage");
  if (denied) return denied;

  const self = await denyActingOnSelf(accountId, "change the role of");
  if (self) return self;

  const parsed = accountRoleUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return failed("That is not a role this dashboard has");
  }

  if (parsed.data.role !== "admin") {
    const builtIn = await denyActingOnBootstrap(accountId, "demoted");
    if (builtIn) return builtIn;
  }

  try {
    const result = await getCollection(COLLECTIONS.adminAccounts).updateOne(
      { _id: toObjectId(accountId) },
      { $set: { role: parsed.data.role, updated_at: currentTimestampMs() } },
    );
    if (result.matchedCount === 0) throw notFound("account");
  } catch (error) {
    return failed(
      error instanceof AppError ? error.message : "Could not change this account's role",
    );
  }

  // Live sessions are left alone on purpose. The role is read from the account document on every
  // request rather than carried in the cookie, so a demotion takes effect on the demoted admin's
  // very next navigation without signing them out of a page they are reading.
  refresh();
  return ok;
}

/**
 * An admin setting someone else's password, from the access panel, without knowing the old one.
 *
 * Changing your *own* password goes through `changeOwnPassword` instead, which demands the current
 * one. This is still allowed to target yourself - an admin who wants the no-current-password form
 * can have it - and in that case it keeps the tab it was run from, the one session that has just
 * proved it belongs to the caller.
 */
export async function setAccountPassword(accountId: string, input: unknown): Promise<ActionResult> {
  const denied = await denyUnless("access:manage");
  if (denied) return denied;

  const parsed = accountPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? "The submitted values are not valid");
  }

  try {
    const current = await getCurrentAccount();
    const isSelf = current?._id === accountId;

    await setAccountPasswordHash(accountId, parsed.data.password);
    await revokeAccountSessions(accountId, { keepCurrent: isSelf });
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not set this password");
  }

  refresh();
  return ok;
}

export async function signOutAccountEverywhere(accountId: string): Promise<ActionResult> {
  const denied = await denyUnless("access:manage");
  if (denied) return denied;

  const self = await denyActingOnSelf(accountId, "sign out");
  if (self) return self;

  try {
    await revokeAccountSessions(accountId);
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not sign this account out");
  }

  refresh();
  return ok;
}

export async function deleteAdminAccount(accountId: string): Promise<ActionResult> {
  const denied = await denyUnless("access:manage");
  if (denied) return denied;

  const self = await denyActingOnSelf(accountId, "delete");
  if (self) return self;

  const builtIn = await denyActingOnBootstrap(accountId, "deleted");
  if (builtIn) return builtIn;

  try {
    const result = await getCollection(COLLECTIONS.adminAccounts).deleteOne({
      _id: toObjectId(accountId),
    });
    if (result.deletedCount === 0) throw notFound("account");

    // The sessions would otherwise outlive the account they belong to. `getCurrentAccount`
    // resolves the account on every request and would already refuse them, but a row that grants
    // nothing has no reason to stay in the collection.
    await revokeAccountSessions(accountId);
  } catch (error) {
    return failed(
      error instanceof AppError ? error.message : describeWriteError(error, "account").message,
    );
  }

  refresh();
  return ok;
}

/* -------------------------------------------------------------------------------------------- */
/* Your own account. These are the account page, and they are guarded by `denySelfService`      */
/* rather than a permission: they act only on the caller, so a guest or a reseller changing their */
/* own password is not a write to anything they are forbidden from - it is the one thing every   */
/* signed-in account must be able to do regardless of role.                                       */
/* -------------------------------------------------------------------------------------------- */

export async function changeOwnPassword(input: unknown): Promise<ActionResult> {
  const denied = await denySelfService();
  if (denied) return denied;

  const parsed = ownPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? "The submitted values are not valid");
  }

  try {
    const account = await getCurrentAccount();
    if (!account) throw new AppError("unauthenticated", "Your session has expired");

    // The current password is checked here rather than trusted from the form, and a wrong one is
    // reported as a field error rather than a generic failure: it is the only part of this the
    // person typing can actually fix.
    const hash = await readPasswordHash(account._id);
    if (!(await verifyPassword(parsed.data.current_password, hash))) {
      return failed("That is not your current password");
    }

    await setAccountPasswordHash(account._id, parsed.data.password);

    // Every other device goes; this tab stays. A session outlives the password it was issued
    // against, so the sign-out is the whole point of changing it - but signing the person out of
    // the page they just used to change it would be punishing the one session that is definitely
    // theirs.
    await revokeAccountSessions(account._id, { keepCurrent: true });
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not change your password");
  }

  refresh();
  return ok;
}

export async function updateOwnProfile(input: unknown): Promise<ActionResult> {
  const denied = await denySelfService();
  if (denied) return denied;

  const parsed = accountProfileSchema.safeParse(input);
  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? "The submitted values are not valid");
  }

  try {
    const account = await getCurrentAccount();
    if (!account) throw new AppError("unauthenticated", "Your session has expired");

    await setAccountName(account._id, parsed.data.name);
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not save your name");
  }

  refresh();
  return ok;
}

/** Ends every session except the one this request is holding. */
export async function signOutOtherDevices(): Promise<ActionResult> {
  const denied = await denySelfService();
  if (denied) return denied;

  try {
    const account = await getCurrentAccount();
    if (!account) throw new AppError("unauthenticated", "Your session has expired");

    await revokeAccountSessions(account._id, { keepCurrent: true });
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not sign out your devices");
  }

  refresh();
  return ok;
}
