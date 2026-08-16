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
