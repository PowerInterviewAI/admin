"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { type ActionResult, failed, ok } from "@/lib/action-result";
import { type User, userPasswordSchema, userPatchSchema, userSchema } from "@/lib/schemas/user";
import { denyWrite } from "@/server/auth/guard";
import { COLLECTIONS, toObjectId } from "@/server/db";
import { AppError, notFound } from "@/server/errors";
import { deleteById, deleteMany, findOne, insertDocument, updateById } from "@/server/repository";
import { hashPassword } from "@/server/password";

/**
 * Reads only `credits`, deliberately not `userSchema`. `updateUser` needs the balance before its
 * write so it can audit the change, but the full schema throws on any document that has drifted
 * out of it (a role or interview_config shape the model has moved past) - and editing is
 * plausibly how an admin fixes such a row. A read that requires whole-document validity would
 * make exactly that row uneditable. Failing (or finding nothing) here degrades to "write without
 * an audit row", never to a failed save - see `readPreviousCredits`.
 */
const creditsOnlySchema = z.object({ credits: z.number().int() });

async function readPreviousCredits(userId: string): Promise<number | null> {
  try {
    const doc = await findOne({
      collection: COLLECTIONS.users,
      schema: creditsOnlySchema,
      filter: { _id: toObjectId(userId) },
    });
    return doc?.credits ?? null;
  } catch {
    return null;
  }
}

export async function updateUser(userId: string, input: unknown): Promise<ActionResult> {
  const denied = await denyWrite();
  if (denied) return denied;

  const parsed = userPatchSchema.safeParse(input);
  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? "The submitted values are not valid");
  }

  try {
    const previousBalance = await readPreviousCredits(userId);

    // `$set` replaces `interview_config` wholesale rather than merging into it, which is why the
    // edit sheet always submits all three inner fields.
    await updateById(COLLECTIONS.users, userId, parsed.data, "user");

    if (previousBalance !== null && previousBalance !== parsed.data.credits) {
      await recordCreditsAdjusted(userId, parsed.data.email, previousBalance, parsed.data.credits);
    }
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not update this user");
  }

  refresh();
  return ok;
}

/**
 * Backend keeps a two-sided credit ledger - `credits_applied` for purchases, and the spend on each
 * `asr_stop` row (`credits_amount`, with `live_minutes` or `mock_minutes`; older rows are
 * `credits_consumed`) - so an admin balance edit is a third mutation source, and one that wrote no
 * trail at all until this existed. Mirrors `recordPasswordChange` below: `source` marks which side wrote
 * it, and a failure here must never fail the action, since the balance is already changed by the
 * time this runs.
 */
async function recordCreditsAdjusted(
  userId: string,
  email: string,
  previousBalance: number,
  newBalance: number,
): Promise<void> {
  try {
    await insertDocument(
      COLLECTIONS.auditLogs,
      {
        event_type: "credits_adjusted",
        user_id: toObjectId(userId),
        email,
        status: "success",
        ip_address: null,
        user_agent: null,
        metadata: {
          source: "admin_dashboard",
          previous_balance: previousBalance,
          new_balance: newBalance,
          credits_amount: newBalance - previousBalance,
        },
      },
      "audit log",
    );
  } catch (error) {
    console.error("Credits were adjusted, but the audit log entry could not be written", error);
  }
}

/**
 * Overwrites a user's password without knowing the old one.
 *
 * `password_hash` has no field in `userSchema` on purpose (it is stripped on read so it cannot
 * reach a client), and this is the one place that writes it. The value stored is a bcrypt hash in
 * backend's own format, so the user signs in through the normal login endpoint afterwards with no
 * migration or rehash step anywhere.
 */
export async function setUserPassword(userId: string, input: unknown): Promise<ActionResult> {
  const denied = await denyWrite();
  if (denied) return denied;

  const parsed = userPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? "The submitted values are not valid");
  }

  try {
    const user = await findOne({
      collection: COLLECTIONS.users,
      schema: userSchema,
      filter: { _id: toObjectId(userId) },
    });
    if (!user) throw notFound("user");

    // Hashing costs a few hundred milliseconds of CPU, so it happens after the lookup rather than
    // before it: no reason to spend that on a user another tab already deleted.
    const password_hash = await hashPassword(parsed.data.password);
    await updateById(COLLECTIONS.users, userId, { password_hash }, "user");

    // Session tokens outlive the password they were issued against, so leaving them alive would
    // make the overwrite cosmetic on every device already signed in - including whoever the
    // password is being taken away from.
    const revoked = await deleteMany(
      COLLECTIONS.sessions,
      { user_id: toObjectId(userId) },
      "session",
    );

    await recordPasswordChange(user, revoked);
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not set this password");
  }

  refresh();
  return ok;
}

/**
 * Backend writes a `password_change` entry whenever a user changes their own password, so an
 * overwrite done here has to leave the same trail or the audit log reads as if the password never
 * moved. `source` marks which of the two wrote it; backend's own entries carry a `device_info`
 * instead, since they have a request to read one from and this has no client to attribute.
 *
 * Never allowed to fail the action: the password is already changed by the time this runs, and
 * reporting a failure would tell the admin the opposite of what happened.
 */
async function recordPasswordChange(user: User, revokedSessions: number): Promise<void> {
  try {
    await insertDocument(
      COLLECTIONS.auditLogs,
      {
        event_type: "password_change",
        user_id: toObjectId(user._id),
        email: user.email,
        status: "success",
        ip_address: null,
        user_agent: null,
        metadata: { source: "admin_dashboard", revoked_sessions: revokedSessions },
      },
      "audit log",
    );
  } catch (error) {
    console.error("Password was set, but its audit log entry could not be written", error);
  }
}

export async function deleteUser(userId: string): Promise<ActionResult> {
  const denied = await denyWrite();
  if (denied) return denied;

  try {
    await deleteById(COLLECTIONS.users, userId, "user");
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not delete this user");
  }

  refresh();
  return ok;
}
