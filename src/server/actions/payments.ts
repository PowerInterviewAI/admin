"use server";

import { refresh } from "next/cache";

import { type ActionResult, failed, ok } from "@/lib/action-result";
import { z } from "zod";

import { paymentSaveSchema } from "@/lib/schemas/payment";
import { denyUnless } from "@/server/auth/guard";
import { COLLECTIONS, toObjectId } from "@/server/db";
import { AppError } from "@/server/errors";
import { findOne, updateById, updateByIdIf } from "@/server/repository";

const reviewReasonSchema = z.object({ review_reason: z.string().nullish().default(null) });

/** The order's review note as stored now; null when nothing is pending or it cannot be read. */
async function currentReviewReason(paymentId: string): Promise<string | null> {
  try {
    const doc = await findOne({
      collection: COLLECTIONS.payments,
      schema: reviewReasonSchema,
      filter: { _id: toObjectId(paymentId) },
    });
    return doc?.review_reason ?? null;
  } catch {
    return null;
  }
}

/**
 * A support-desk override of a stored payment record. It does not call NOWPayments, does not
 * replay webhook logic, and does not credit or debit the user - flipping `credits_applied` only
 * records whether that already happened.
 *
 * `resolvedReason` is the review reason the admin marked as handled. It clears only while that is
 * still the reason on the order, so a newer flag is not dismissed unread.
 */
export async function updatePayment(
  paymentId: string,
  input: unknown,
  resolvedReason?: unknown,
): Promise<ActionResult> {
  const denied = await denyUnless("payments:write");
  if (denied) return denied;

  const parsed = paymentSaveSchema.safeParse(input);
  const resolved = z.string().nullish().safeParse(resolvedReason);
  if (!parsed.success || !resolved.success) {
    return failed("The submitted values are not valid");
  }

  let cleared = true;
  try {
    if (Object.keys(parsed.data).length > 0) {
      await updateById(COLLECTIONS.payments, paymentId, parsed.data, "payment");
    }
    if (resolved.data) {
      cleared = await updateByIdIf(
        COLLECTIONS.payments,
        paymentId,
        { review_reason: resolved.data },
        { review_reason: null },
        "payment",
      );
    }
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not update this payment");
  }

  refresh();
  if (!cleared && (await currentReviewReason(paymentId))) {
    return failed(
      "Backend flagged this order again while the sheet was open, so it still needs review. Any other changes were saved: reopen the order to read the new note.",
    );
  }
  return ok;
}
