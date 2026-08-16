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
