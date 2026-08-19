import { z } from "zod";

import { objectIdSchema, timestampsSchema } from "@/lib/schemas/common";

/**
 * Severity of the message, selecting the accent colour of the shared layout. Same four names the
 * backend's `EmailType` enum uses, so the template a campaign picks here is the template a
 * transactional mail of that kind would have used.
 */
export const emailTemplateSchema = z.enum(["info", "success", "warning", "error"]);
export type EmailTemplate = z.infer<typeof emailTemplateSchema>;
export const EMAIL_TEMPLATES = emailTemplateSchema.options;

/**
 * Who a campaign goes to. `one` and `selected` both carry explicit ids; `all` resolves at send
 * time, so a user who signs up between composing and sending is included.
 */
export const emailAudienceSchema = z.enum(["one", "selected", "all"]);
export type EmailAudience = z.infer<typeof emailAudienceSchema>;

export const EMAIL_AUDIENCE_LABELS: Record<EmailAudience, string> = {
  one: "One user",
  selected: "Selected users",
  all: "All active users",
};

const SUBJECT_MAX_LENGTH = 200;

/**
 * What the composer form submits. No `.default()` anywhere: `zodResolver` needs a schema whose
 * input and output types are identical, which is the same constraint `userPatchSchema` works
 * under.
 */
export const emailMessageSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(1, "Write a subject line")
    .max(SUBJECT_MAX_LENGTH, `Keep the subject under ${SUBJECT_MAX_LENGTH} characters`),
  template: emailTemplateSchema,
  body: z.string().trim().min(1, "Write the email body"),
});

export type EmailMessage = z.infer<typeof emailMessageSchema>;

/** A test send goes to one typed address and is never recorded as a campaign. */
export const emailTestSchema = emailMessageSchema.extend({
  to: z.email("Enter a valid email address"),
});

export type EmailTest = z.infer<typeof emailTestSchema>;

/**
 * What starting a campaign submits. `user_ids` is ignored for the `all` audience and required for
 * the other two; the action enforces that rather than the schema, so the error names the audience
 * the admin actually picked.
 */
export const emailCampaignInputSchema = emailMessageSchema.extend({
  audience: emailAudienceSchema,
  user_ids: z.array(objectIdSchema),
});

export type EmailCampaignInput = z.infer<typeof emailCampaignInputSchema>;

export const emailDeliveryStatusSchema = z.enum(["pending", "sent", "failed"]);
export type EmailDeliveryStatus = z.infer<typeof emailDeliveryStatusSchema>;

/**
 * One row of the send log. Every recipient is written up front as `pending` and flipped in place
 * as the run walks the list, so an interrupted campaign still says exactly who was reached.
 */
export const emailDeliverySchema = z.object({
  email: z.string().default(""),
  name: z.string().default(""),
  user_id: objectIdSchema.nullish().default(null),
  status: emailDeliveryStatusSchema.catch("pending"),
  error: z.string().nullish().default(null),
  sent_at: z.number().int().nullish().default(null),
});

export type EmailDelivery = z.infer<typeof emailDeliverySchema>;

export const emailCampaignStatusSchema = z.enum(["sending", "completed", "failed"]);
export type EmailCampaignStatus = z.infer<typeof emailCampaignStatusSchema>;

/**
 * A campaign document in `email_campaigns`.
 *
 * `recipients` defaults to an empty array so this one schema also validates the list view's
 * projection, which drops the field: twenty campaigns' worth of delivery logs is a lot of BSON to
 * read for a table that only shows the counts.
 */
export const emailCampaignSchema = timestampsSchema.extend({
  _id: objectIdSchema,
  subject: z.string().default(""),
  template: emailTemplateSchema.catch("info"),
  body: z.string().default(""),
  audience: emailAudienceSchema.catch("selected"),
  status: emailCampaignStatusSchema.catch("completed"),
  total: z.number().int().default(0),
  sent_count: z.number().int().default(0),
  failed_count: z.number().int().default(0),
  from_email: z.string().default(""),
  from_name: z.string().default(""),
  finished_at: z.number().int().nullish().default(null),
  error: z.string().nullish().default(null),
  recipients: z.array(emailDeliverySchema).default([]),
});

export type EmailCampaign = z.infer<typeof emailCampaignSchema>;

/**
 * What the composer polls while a run is in flight.
 *
 * `interrupted` travels in the payload rather than being inferred by the poller, because it is the
 * only thing that can end the loop: a dead run stays `sending` in the database forever, so a
 * poller watching `status` alone would keep asking every 1.5s for as long as the tab stays open.
 */
export interface EmailCampaignProgress {
  id: string;
  status: EmailCampaignStatus;
  interrupted: boolean;
  total: number;
  sent_count: number;
  failed_count: number;
  error: string | null;
}

/** A user the recipient picker can offer. Kept minimal - it crosses to the client on every search. */
export const recipientOptionSchema = z.object({
  id: objectIdSchema,
  username: z.string(),
  email: z.string(),
});

export type RecipientOption = z.infer<typeof recipientOptionSchema>;

/**
 * A run is only treated as live while its heartbeat is recent. The runner touches `updated_at` on
 * every recipient, so a campaign still marked `sending` with a stale heartbeat is one whose Node
 * process went away mid-run - a state no amount of polling will ever resolve, and one an admin
 * needs to see as interrupted rather than as still working.
 */
export const CAMPAIGN_HEARTBEAT_TIMEOUT_MS = 60_000;

/**
 * The heartbeat only ticks once per recipient, so the threshold has to clear the configured pace
 * or a healthy run looks dead between two sends. `EMAIL_SEND_DELAY_MS` has no upper bound - anyone
 * throttling hard for a provider limit would otherwise watch every live campaign report itself as
 * interrupted. Three intervals of slack absorbs an unusually slow SMTP round trip on top.
 */
export function campaignHeartbeatTimeoutMs(delayMs: number): number {
  return Math.max(CAMPAIGN_HEARTBEAT_TIMEOUT_MS, delayMs * 3);
}

export function isCampaignInterrupted(
  campaign: { status: EmailCampaignStatus; updated_at: number | null },
  timeoutMs: number = CAMPAIGN_HEARTBEAT_TIMEOUT_MS,
): boolean {
  if (campaign.status !== "sending") return false;
  if (campaign.updated_at === null) return false;
  return Date.now() - campaign.updated_at > timeoutMs;
}

/**
 * Whether a campaign's counters can still move, which is what every poller in the UI starts and
 * stops on. An interrupted run is deliberately not live: its process is gone, so no amount of
 * asking will ever change what it reports.
 */
export function isCampaignLive(campaign: {
  status: EmailCampaignStatus;
  interrupted: boolean;
}): boolean {
  return campaign.status === "sending" && !campaign.interrupted;
}

/**
 * A campaign as the tables receive it. `interrupted` is decided on the server rather than during
 * render, because it is a comparison against the current clock and a client re-deciding it during
 * hydration would be free to disagree with the markup it is hydrating.
 */
export interface EmailCampaignRow extends EmailCampaign {
  interrupted: boolean;
}
