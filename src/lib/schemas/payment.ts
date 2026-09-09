import { z } from "zod";

import { objectIdSchema, timestampsSchema, userLabelSchema } from "@/lib/schemas/common";

export const paymentPlanSchema = z.enum(["starter", "pro", "enterprise"]);

/** Mirrors NOWPayments' lifecycle, as stored by backend's webhook handler. */
export const paymentStatusSchema = z.enum([
  "pending",
  "waiting",
  "confirming",
  "confirmed",
  "sending",
  "partially_paid",
  "finished",
  "failed",
  "refunded",
  "expired",
]);

export type PaymentPlan = z.infer<typeof paymentPlanSchema>;
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const PAYMENT_PLANS = paymentPlanSchema.options;
export const PAYMENT_STATUSES = paymentStatusSchema.options;

/**
 * The coarse question an admin actually asks of this list: did the money land, is it still moving,
 * or did it go away. `unapplied` is the odd one out and is not a status set at all - it is a
 * finished *order* whose credits were never granted, which is a job rather than a state. An order
 * rather than a payment document, because a follow-up leg is credited against its root and never
 * carries `credits_applied` itself; see `bucketClause` in `server/queries/payments.ts`.
 */
export const paymentBucketSchema = z.enum(["in_flight", "finished", "failed", "unapplied"]);
export type PaymentBucket = z.infer<typeof paymentBucketSchema>;

const FINISHED_STATUSES = ["finished"] as const;
const FAILED_STATUSES = ["failed", "refunded", "expired"] as const;

/**
 * `finished` and `failed` are named explicitly and `in_flight` is whatever is left, deliberately in
 * that direction: a status NOWPayments adds later is far more likely to be another transitional one
 * than a terminal one, and the cost of guessing wrong is a payment reported as money that failed.
 */
export const PAYMENT_STATUS_BUCKETS: Record<
  Exclude<PaymentBucket, "unapplied">,
  readonly PaymentStatus[]
> = {
  in_flight: PAYMENT_STATUSES.filter(
    (status) =>
      !(FINISHED_STATUSES as readonly PaymentStatus[]).includes(status) &&
      !(FAILED_STATUSES as readonly PaymentStatus[]).includes(status),
  ),
  finished: FINISHED_STATUSES,
  failed: FAILED_STATUSES,
};

export const paymentSchema = timestampsSchema.extend({
  _id: objectIdSchema,
  user_id: objectIdSchema,
  plan: paymentPlanSchema.catch("starter"),
  payment_id: z.string().nullish().default(null),
  order_id: z.string().default(""),
  status: paymentStatusSchema.catch("pending"),
  pay_address: z.string().nullish().default(null),
  pay_amount: z.number().nullish().default(null),
  pay_currency: z.string().nullish().default(null),
  price_amount: z.number().default(0),
  credits_amount: z.number().int().default(0),
  credits_applied: z.boolean().default(false),
  purchase_id: z.string().nullish().default(null),
  root_payment_id: objectIdSchema.nullish().default(null),
});

export type Payment = z.infer<typeof paymentSchema>;

export const paymentRowSchema = paymentSchema.extend({
  user: userLabelSchema.nullish().default(null),
});

export type PaymentRow = z.infer<typeof paymentRowSchema>;

/** Manual support override. Never calls NOWPayments and never replays webhook logic. */
export const paymentPatchSchema = z.object({
  status: paymentStatusSchema,
  credits_applied: z.boolean(),
});

export type PaymentPatch = z.infer<typeof paymentPatchSchema>;
