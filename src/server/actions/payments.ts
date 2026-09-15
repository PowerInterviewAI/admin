"use server";

import { refresh } from "next/cache";

import { type ActionResult, failed, ok } from "@/lib/action-result";
import { paymentPatchSchema } from "@/lib/schemas/payment";
import { denyWrite } from "@/server/auth/guard";
import { COLLECTIONS } from "@/server/db";
import { AppError } from "@/server/errors";
import { updateById } from "@/server/repository";

/**
 * A support-desk override of a stored payment record. It does not call NOWPayments, does not
 * replay webhook logic, and does not credit or debit the user - flipping `credits_applied` only
 * records whether that already happened.
 */
export async function updatePayment(paymentId: string, input: unknown): Promise<ActionResult> {
  const denied = await denyWrite();
  if (denied) return denied;

  const parsed = paymentPatchSchema.safeParse(input);
  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? "The submitted values are not valid");
  }

  try {
    await updateById(COLLECTIONS.payments, paymentId, parsed.data, "payment");
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not update this payment");
  }

  refresh();
  return ok;
}
