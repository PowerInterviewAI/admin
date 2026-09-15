"use server";

import { refresh } from "next/cache";

import { type ActionResult, failed, ok } from "@/lib/action-result";
import {
  accountCreateSchema,
  accountPasswordSchema,
  accountRoleUpdateSchema,
} from "@/lib/schemas/account";
import { createAccount, setAccountPasswordHash } from "@/server/auth/accounts";
import { denyWrite } from "@/server/auth/guard";
import { getCurrentAccount, revokeAccountSessions } from "@/server/auth/session";
import { COLLECTIONS, currentTimestampMs, getCollection, toObjectId } from "@/server/db";
import { AppError, describeWriteError, notFound } from "@/server/errors";

/**
 * The access panel. Every action here is admin-only, and three of them additionally refuse to act
 * on the caller's own account.
 *
 * That self-exclusion is the lockout guard, and it is deliberately blunt rather than clever. An
 * admin cannot demote or delete themselves, so the account performing an action is always still an
 * admin when it finishes, so the last admin can never be removed - no counting, no transaction,
 * and no window where a concurrent second demotion slips between a count and a write. The cost is
 * that stepping down needs another admin to do it, which is also how it should read.
 */
async function denyActingOnSelf(accountId: string, what: string): Promise<{ ok: false; error: string } | null> {
  const current = await getCurrentAccount();
  if (current && current._id === accountId) {
    return failed(`You cannot ${what} your own account. Another admin has to do it.`);
  }
  return null;
}

export async function createAdminAccount(input: unknown): Promise<ActionResult> {
  const denied = await denyWrite();
  if (denied) return denied;

  const parsed = accountCreateSchema.safeParse(input);
  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? "The submitted values are not valid");
  }

  try {
    await createAccount(parsed.data);
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

export async function setAccountRole(accountId: string, input: unknown): Promise<ActionResult> {
  const denied = await denyWrite();
  if (denied) return denied;

  const self = await denyActingOnSelf(accountId, "change the role of");
  if (self) return self;

  const parsed = accountRoleUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return failed("That is not a role this dashboard has");
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
 * Sets an account's password, and signs it out everywhere.
 *
 * Same reasoning as overwriting a product user's password: a session outlives the password it was
 * issued against, so leaving the sessions alive would make the change cosmetic on any device
 * already signed in. Changing your *own* password keeps the tab you changed it in, which is the
 * one session that has just proved it belongs to you.
 */
export async function setAccountPassword(accountId: string, input: unknown): Promise<ActionResult> {
  const denied = await denyWrite();
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
  const denied = await denyWrite();
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
  const denied = await denyWrite();
  if (denied) return denied;

  const self = await denyActingOnSelf(accountId, "delete");
  if (self) return self;

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
      error instanceof AppError
        ? error.message
        : describeWriteError(error, "account").message,
    );
  }

  refresh();
  return ok;
}
