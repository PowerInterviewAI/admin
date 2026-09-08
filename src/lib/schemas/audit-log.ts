import { z } from "zod";

import { objectIdSchema, timestampsSchema } from "@/lib/schemas/common";

/**
 * Every event type backend's `AuditLog.EventType` enum declares. Kept in sync by hand - there is
 * no migration tool enforcing it, which is exactly why every document is validated on read (see
 * `parseDocument` in `repository.ts`).
 */
const KNOWN_EVENT_TYPES = [
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
  "credits_consumed",
  // The two later movements on the same balance, neither a purchase nor a spend: a refund
  // clawing a grant back, and an admin dashboard edit. Added together with backend's enum in the
  // same change - see the note on `auditEventTypeSchema` below for why that pairing matters.
  "credits_reversed",
  "credits_adjusted",
  "asr_start",
  "asr_stop",
] as const;

/**
 * Fallback for an `event_type` value only backend knows about. Real rows never carry it -
 * `KNOWN_EVENT_TYPES` above is kept in sync with backend's enum by hand - it exists purely as
 * `event_type`'s `.catch()` target, so a value backend adds before this file catches up renders
 * as an unlabelled row instead of throwing on every page that reads this collection
 * (`parseDocument` throws on any other schema mismatch, by design). Deliberately excluded from
 * `AUDIT_EVENT_TYPES` and every group below: it must never appear as a filter option or match a
 * group's `$in`, or it would look like a real, selectable kind of event.
 *
 * This converts a thrown page into a visible-but-unlabelled row; it does not fix grouping - an
 * event type missing from `KNOWN_EVENT_TYPES` still won't appear in any of `AUDIT_EVENT_GROUPS`,
 * only in the unfiltered view. Adding a new backend event type here (and to `PAYMENT_EVENTS` or
 * `ASR_EVENTS` if it belongs to one) in the same change as the backend enum is still required -
 * this sentinel is a safety net under that, not a substitute for it.
 */
const UNKNOWN_EVENT_TYPE = "unknown";

export const auditEventTypeSchema = z.enum([...KNOWN_EVENT_TYPES, UNKNOWN_EVENT_TYPE]);

export const auditStatusSchema = z.enum(["success", "failure"]);

export type AuditEventType = z.infer<typeof auditEventTypeSchema>;
export type AuditStatus = z.infer<typeof auditStatusSchema>;

/** Excludes the `unknown` sentinel - see its docstring for why the filter dropdown must never offer it. */
export const AUDIT_EVENT_TYPES: readonly AuditEventType[] = KNOWN_EVENT_TYPES;
export const AUDIT_STATUSES = auditStatusSchema.options;

/** Twenty-three event types is too many to scan; three groups is what an admin filters by in practice. */
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
  // The other half of the credit record: `credits_applied` is what was bought, this is what was
  // spent. Grouped with payments rather than under `auth`, because the question an admin opens
  // this tab to answer - where did this account's credits go - is answered by the two together.
  "credits_consumed",
  // The other two movements on the same balance: a refund reversing a grant, and an admin
  // dashboard edit. Both belong on the same "where did this account's credits go" question.
  "credits_reversed",
  "credits_adjusted",
] as const;

const ASR_EVENTS = ["asr_start", "asr_stop"] as const;

/**
 * Payments and ASR are named explicitly and `auth` is everything else, so an event type backend
 * adds later lands under a group rather than disappearing from all of them - a tab that silently
 * hides events is worse than one whose name fits its contents loosely. That guarantee only holds
 * for a type already present in `KNOWN_EVENT_TYPES`, though: an event this file has not learned
 * about yet is caught by `UNKNOWN_EVENT_TYPE` above, not grouped here, and shows only in the
 * unfiltered view until it is added to both places.
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
  // `.catch()`, unlike every other enum in this app's schemas that isn't this one - see
  // UNKNOWN_EVENT_TYPE's docstring for why this field in particular needed the safety net rather
  // than a thrown parse failure.
  event_type: auditEventTypeSchema.catch(UNKNOWN_EVENT_TYPE),
  user_id: objectIdSchema.nullish().default(null),
  email: z.string().nullish().default(null),
  status: auditStatusSchema.catch("success"),
  ip_address: z.string().nullish().default(null),
  user_agent: z.string().nullish().default(null),
  metadata: z.record(z.string(), z.unknown()).nullish().default(null),
});

export type AuditLog = z.infer<typeof auditLogSchema>;
