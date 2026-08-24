import { z } from "zod";

import { objectIdSchema, timestampsSchema } from "@/lib/schemas/common";

export const auditEventTypeSchema = z.enum([
  "login",
  "logout",
  "signup",
  "password_change",
  "profile_update",
  "session_expire",
  "email_verification_requested",
  "email_verification_confirmed",
  "password_reset_requested",
  "password_reset_code_verified",
  "password_reset_completed",
  "payment_created",
  "payment_webhook_received",
  "payment_completed",
  "payment_partially_paid",
  "payment_failed",
  "payment_error",
  "credits_applied",
  "asr_start",
  "asr_stop",
]);

export const auditStatusSchema = z.enum(["success", "failure"]);

export type AuditEventType = z.infer<typeof auditEventTypeSchema>;
export type AuditStatus = z.infer<typeof auditStatusSchema>;

export const AUDIT_EVENT_TYPES = auditEventTypeSchema.options;
export const AUDIT_STATUSES = auditStatusSchema.options;

/** Twenty event types is too many to scan; three groups is what an admin filters by in practice. */
export const auditEventGroupSchema = z.enum(["auth", "payments", "asr"]);
export type AuditEventGroup = z.infer<typeof auditEventGroupSchema>;

const PAYMENT_EVENTS = [
  "payment_created",
  "payment_webhook_received",
  "payment_completed",
  "payment_partially_paid",
  "payment_failed",
  "payment_error",
  "credits_applied",
] as const;

const ASR_EVENTS = ["asr_start", "asr_stop"] as const;

/**
 * Payments and ASR are named explicitly and `auth` is everything else, so an event type backend
 * adds later lands under a group rather than disappearing from all of them - a tab that silently
 * hides events is worse than one whose name fits its contents loosely.
 */
export const AUDIT_EVENT_GROUPS: Record<AuditEventGroup, readonly AuditEventType[]> = {
  auth: AUDIT_EVENT_TYPES.filter(
    (event) =>
      !(PAYMENT_EVENTS as readonly AuditEventType[]).includes(event) &&
      !(ASR_EVENTS as readonly AuditEventType[]).includes(event),
  ),
  payments: PAYMENT_EVENTS,
  asr: ASR_EVENTS,
};

export const auditLogSchema = timestampsSchema.extend({
  _id: objectIdSchema,
  event_type: auditEventTypeSchema,
  user_id: objectIdSchema.nullish().default(null),
  email: z.string().nullish().default(null),
  status: auditStatusSchema.catch("success"),
  ip_address: z.string().nullish().default(null),
  user_agent: z.string().nullish().default(null),
  metadata: z.record(z.string(), z.unknown()).nullish().default(null),
});

export type AuditLog = z.infer<typeof auditLogSchema>;
