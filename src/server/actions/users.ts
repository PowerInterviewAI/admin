"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { type ActionResult, failed, ok } from "@/lib/action-result";
import { type User, userPasswordSchema, userPatchSchema, userSchema } from "@/lib/schemas/user";
import { denyUnless } from "@/server/auth/guard";
import { COLLECTIONS, toObjectId } from "@/server/db";
import { AppError, notFound } from "@/server/errors";
import { deleteById, deleteMany, findOne, insertDocument, updateById } from "@/server/repository";
import { hashPassword } from "@/server/password";

/**
 * Reads only the balance and the subscription, deliberately not `userSchema`. `updateUser` needs
 * both before its write so it can audit the change, but the full schema throws on any document
 * that has drifted out of it (a role or interview_config shape the model has moved past) - and
 * editing is plausibly how an admin fixes such a row. A read that requires whole-document validity
 * would make exactly that row uneditable. Failing (or finding nothing) here degrades to "write
 * without an audit row", never to a failed save - see `readPrevious`.
 */
const auditedFieldsSchema = z.object({
  credits: z.number().int(),
  subscription_expires_at: z.number().int().nullish().default(null),
});

type AuditedFields = z.infer<typeof auditedFieldsSchema>;

async function readPrevious(userId: string): Promise<AuditedFields | null> {
  try {
    return await findOne({
      collection: COLLECTIONS.users,
      schema: auditedFieldsSchema,
      filter: { _id: toObjectId(userId) },
    });
  } catch {
    return null;
  }
}

export async function updateUser(userId: string, input: unknown): Promise<ActionResult> {
  const denied = await denyUnless("users:write");
  if (denied) return denied;

  const parsed = userPatchSchema.safeParse(input);
  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? "The submitted values are not valid");
  }

  try {
    const previous = await readPrevious(userId);

    // `$set` replaces `interview_config` wholesale rather than merging into it, which is why the
    // edit sheet always submits all three inner fields.
    //
    // `subscription_expires_at` is written only when the sheet sent it, which it does only when the
    // admin changed it. Backend moves that field itself, so a save that changed a name must not put
    // back the end date the sheet happened to open with. Dropped rather than left `undefined`,
    // which the driver would store as null.
    const { subscription_expires_at: nextExpiresAt, ...fields } = parsed.data;
    const patch = nextExpiresAt === undefined ? fields : { ...fields, subscription_expires_at: nextExpiresAt };
    await updateById(COLLECTIONS.users, userId, patch, "user");

    if (previous && previous.credits !== parsed.data.credits) {
      await recordCreditsAdjusted(userId, parsed.data.email, previous.credits, parsed.data.credits);
    }
    if (previous && nextExpiresAt !== undefined && previous.subscription_expires_at !== nextExpiresAt) {
      await recordSubscriptionAdjusted(userId, parsed.data.email, previous.subscription_expires_at, nextExpiresAt);
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
 * trail at all until this existed. Mirrors `recordPasswordChange` below: `source` marks which side
 * wrote it, and a failure here must never fail the action, since the balance is already changed by
 * the time this runs.
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
 * The same trail for a hand-set subscription. Still `credits_adjusted` rather than an event type of
 * its own: backend declares the event types, and a value it does not know is the strict-enum break
 * this app guards against when reading. `credits_amount` is 0 so a sum of credit adjustments is
 * not thrown off by it.
 */
async function recordSubscriptionAdjusted(
  userId: string,
  email: string,
  previousExpiresAt: number | null,
  newExpiresAt: number | null,
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
          credits_amount: 0,
          previous_subscription_expires_at: previousExpiresAt,
          subscription_expires_at: newExpiresAt,
        },
      },
      "audit log",
    );
  } catch (error) {
    console.error("The subscription was adjusted, but the audit log entry could not be written", error);
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
  const denied = await denyUnless("users:write");
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
  const denied = await denyUnless("users:write");
  if (denied) return denied;

  try {
    await deleteById(COLLECTIONS.users, userId, "user");
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not delete this user");
  }

  refresh();
  return ok;
}
