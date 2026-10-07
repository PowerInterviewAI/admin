"use server";

import { refresh } from "next/cache";

import { type ActionData, type ActionResult, failed, ok, succeeded } from "@/lib/action-result";
import { resellerRateSchema, settlementStatusUpdateSchema } from "@/lib/schemas/reseller";
import { issueApiKey, revokeApiKey, setCreditRate } from "@/server/auth/api-keys";
import { denyUnless } from "@/server/auth/guard";
import { getCurrentAccount } from "@/server/auth/session";
import { COLLECTIONS, currentTimestampMs, getCollection, toObjectId } from "@/server/db";
import { AppError, notFound } from "@/server/errors";

function describe(error: unknown, fallback: string): { ok: false; error: string } {
  return failed(error instanceof AppError ? error.message : fallback);
}

/* -------------------------------------------------------------------------------------------- */
/* A reseller's own key. Scoped to the session's account, never to an id from the caller, so the  */
/* only key a reseller can mint or revoke is their own.                                            */
/* -------------------------------------------------------------------------------------------- */

/**
 * Issues a new key, replacing any existing one, and returns it in plaintext. This response is the
 * only time the key exists anywhere but the reseller's own records: only its digest is stored.
 */
export async function rotateOwnApiKey(): Promise<ActionData<{ key: string }>> {
  const denied = await denyUnless("reseller:portal");
  if (denied) return denied;

  try {
    const account = await getCurrentAccount();
    if (!account) throw new AppError("unauthenticated", "Your session has expired");
    const key = await issueApiKey(account._id);
    refresh();
    return succeeded({ key });
  } catch (error) {
    return describe(error, "Could not issue a key");
  }
}

export async function revokeOwnApiKey(): Promise<ActionResult> {
  const denied = await denyUnless("reseller:portal");
  if (denied) return denied;

  try {
    const account = await getCurrentAccount();
    if (!account) throw new AppError("unauthenticated", "Your session has expired");
    await revokeApiKey(account._id);
  } catch (error) {
    return describe(error, "Could not revoke your key");
  }

  refresh();
  return ok;
}

/* -------------------------------------------------------------------------------------------- */
/* Admin controls over resellers.                                                                 */
/* -------------------------------------------------------------------------------------------- */

/** Stops a reseller's integration at once, without touching their dashboard sign-in. */
export async function revokeResellerApiKey(accountId: string): Promise<ActionResult> {
  const denied = await denyUnless("resellers:manage");
  if (denied) return denied;

  try {
    await revokeApiKey(accountId);
  } catch (error) {
    return describe(error, "Could not revoke this key");
  }

  refresh();
  return ok;
}

/**
 * Sets what a reseller owes per interview hour. Backend snapshots the rate onto each sale as it
 * commits, so a change prices what they sell from now on and never re-prices what they already
 * sold - or a day already settled.
 */
export async function setResellerRate(accountId: string, input: unknown): Promise<ActionResult> {
  const denied = await denyUnless("resellers:manage");
  if (denied) return denied;

  const parsed = resellerRateSchema.safeParse(input);
  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? "That is not a valid rate");
  }

  const { usd_per_hour: usd } = parsed.data;
  try {
    await setCreditRate(accountId, usd === null ? null : Math.round(usd * 100));
  } catch (error) {
    return describe(error, "Could not save this rate");
  }

  refresh();
  return ok;
}

/**
 * Marks a day paid, or back to open. The only write this app makes into a collection backend owns
 * the rest of: the settlement worker inserts rows and never updates them, so `status` and `paid_*`
 * are free for this. `paid_by` records which dashboard account did it.
 */
export async function setSettlementStatus(settlementId: string, input: unknown): Promise<ActionResult> {
  const denied = await denyUnless("resellers:manage");
  if (denied) return denied;

  const parsed = settlementStatusUpdateSchema.safeParse(input);
  if (!parsed.success) return failed("That is not a settlement status");

  try {
    const account = await getCurrentAccount();
    const paid = parsed.data.status === "paid";
    const result = await getCollection(COLLECTIONS.resellerSettlements).updateOne(
      { _id: toObjectId(settlementId) },
      {
        $set: {
          status: parsed.data.status,
          paid_at: paid ? currentTimestampMs() : null,
          paid_by: paid ? (account?.email ?? null) : null,
        },
      },
    );
    if (result.matchedCount === 0) throw notFound("settlement");
  } catch (error) {
    return describe(error, "Could not update this settlement");
  }

  refresh();
  return ok;
}
