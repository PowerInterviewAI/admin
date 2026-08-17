"use server";

import { refresh } from "next/cache";

import { type ActionData, type ActionResult, failed, ok, succeeded } from "@/lib/action-result";
import { greetingName, renderEmailHtml } from "@/lib/email/template";
import {
  type EmailCampaign,
  type EmailCampaignProgress,
  type RecipientOption,
  emailCampaignInputSchema,
  emailTestSchema,
  isCampaignInterrupted,
} from "@/lib/schemas/email";
import { COLLECTIONS, currentTimestampMs, getCollection, toObjectId } from "@/server/db";
import { startCampaign } from "@/server/email/campaign-runner";
import {
  type EmailConfig,
  describeSmtpError,
  heartbeatTimeoutMs,
  readEmailConfig,
  sendEmail,
  verifyTransport,
} from "@/server/email/transport";
import { AppError, describeWriteError, notFound } from "@/server/errors";
import { getEmailCampaign } from "@/server/queries/email-campaigns";
import {
  type EmailRecipient,
  dedupeByEmail,
  getAllMailableUsers,
  getMailableUsersByIds,
  searchMailableUsers,
} from "@/server/queries/email-recipients";

/** Backs the recipient picker's search box. Reads only, so it needs no confirmation or refresh. */
export async function findRecipients(query: string): Promise<ActionData<RecipientOption[]>> {
  try {
    return succeeded(await searchMailableUsers(query));
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not search users");
  }
}

/**
 * Sends the composed message to one typed address and reports the outcome synchronously.
 *
 * Kept out of `email_campaigns` on purpose: a test send is part of writing the campaign, not a
 * campaign, and recording every draft iteration would bury the real sends in the history table.
 */
export async function sendTestEmail(input: unknown): Promise<ActionResult> {
  const parsed = emailTestSchema.safeParse(input);
  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? "The submitted values are not valid");
  }

  const configResult = readEmailConfig();
  if (!configResult.ok) return failed(configResult.error);
  const { config } = configResult;

  const { to, subject, body, template } = parsed.data;
  const name = greetingName(to.split("@")[0] ?? "there");

  try {
    await sendEmail({
      config,
      toEmail: to,
      toName: name,
      subject,
      html: renderEmailHtml({
        appName: config.appName,
        name,
        subject,
        body,
        template,
        year: new Date().getFullYear(),
      }),
    });
  } catch (error) {
    return failed(describeSmtpError(error));
  }

  return ok;
}

async function resolveRecipients(
  audience: "one" | "selected" | "all",
  userIds: string[],
): Promise<EmailRecipient[]> {
  if (audience === "all") {
    return dedupeByEmail(await getAllMailableUsers());
  }
  return dedupeByEmail(await getMailableUsersByIds(userIds));
}

function describeEmptyAudience(audience: "one" | "selected" | "all"): string {
  if (audience === "all") {
    return "There are no active users with an email address to send to";
  }
  return "The chosen recipients are no longer active users. Pick them again.";
}

/**
 * Starts a campaign and hands back its id.
 *
 * The transport is verified before the campaign document is written, so a wrong API key fails as
 * a message on the compose screen rather than as a history entry with every recipient marked
 * failed. Once the document exists, sending continues in the background and the composer polls
 * `getCampaignProgress` - see `campaign-runner.ts` for why that boundary sits where it does.
 */
export async function startEmailCampaign(
  input: unknown,
): Promise<ActionData<EmailCampaignProgress>> {
  const parsed = emailCampaignInputSchema.safeParse(input);
  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? "The submitted values are not valid");
  }

  const { audience, user_ids, subject, body, template } = parsed.data;

  if (audience !== "all" && user_ids.length === 0) {
    return failed("Pick at least one recipient");
  }
  if (audience === "one" && user_ids.length !== 1) {
    return failed("The one-user audience takes exactly one recipient");
  }

  const configResult = readEmailConfig();
  if (!configResult.ok) return failed(configResult.error);
  const { config } = configResult;

  let recipients: EmailRecipient[];
  try {
    recipients = await resolveRecipients(audience, user_ids);
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not resolve the recipients");
  }

  if (recipients.length === 0) {
    return failed(describeEmptyAudience(audience));
  }

  try {
    await verifyTransport(config);
  } catch (error) {
    return failed(describeSmtpError(error));
  }

  let campaignId: string;
  try {
    campaignId = await createCampaign({ audience, subject, body, template }, recipients, config);
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not record this campaign");
  }

  startCampaign({
    campaignId,
    message: { subject, body, template },
    recipients,
    config,
  });

  refresh();
  return succeeded({
    id: campaignId,
    status: "sending",
    interrupted: false,
    total: recipients.length,
    sent_count: 0,
    failed_count: 0,
    error: null,
  });
}

/**
 * Writes the campaign with every recipient already listed as `pending`, which is what lets an
 * interrupted run still name who was reached and who was not. `insertDocument` is not reused here
 * because the id has to come back out for the runner and the poller.
 */
async function createCampaign(
  campaign: { audience: string; subject: string; body: string; template: string },
  recipients: EmailRecipient[],
  config: EmailConfig,
): Promise<string> {
  try {
    const result = await getCollection(COLLECTIONS.emailCampaigns).insertOne({
      ...campaign,
      status: "sending",
      total: recipients.length,
      sent_count: 0,
      failed_count: 0,
      from_email: config.fromAddress,
      from_name: config.fromName,
      finished_at: null,
      error: null,
      recipients: recipients.map((recipient) => ({
        email: recipient.email,
        name: greetingName(recipient.username),
        user_id: recipient.user_id ? toObjectId(recipient.user_id) : null,
        status: "pending",
        error: null,
        sent_at: null,
      })),
      created_at: currentTimestampMs(),
      // Doubles as the run's heartbeat: the runner touches it on every recipient, and a stale
      // value on a campaign still marked `sending` is how the UI spots an interrupted run.
      updated_at: currentTimestampMs(),
    });
    return result.insertedId.toHexString();
  } catch (error) {
    throw describeWriteError(error, "campaign");
  }
}

/** Polled by the composer while a run is in flight. Cheap: counters only, never the delivery log. */
export async function getCampaignProgress(
  campaignId: string,
): Promise<ActionData<EmailCampaignProgress>> {
  try {
    const doc = await getCollection(COLLECTIONS.emailCampaigns).findOne(
      { _id: toObjectId(campaignId) },
      {
        projection: {
          status: 1,
          total: 1,
          sent_count: 1,
          failed_count: 1,
          error: 1,
          updated_at: 1,
        },
      },
    );
    if (!doc) throw notFound("campaign");

    const status =
      doc.status === "sending" || doc.status === "failed" ? doc.status : "completed";

    return succeeded({
      id: campaignId,
      status,
      // Reported so the poller has something terminal to stop on. A run whose process died stays
      // `sending` in the database for good, so status alone would keep the composer asking every
      // 1.5s for the entire life of the tab.
      interrupted: isCampaignInterrupted(
        { status, updated_at: typeof doc.updated_at === "number" ? doc.updated_at : null },
        heartbeatTimeoutMs(),
      ),
      total: Number(doc.total ?? 0),
      sent_count: Number(doc.sent_count ?? 0),
      failed_count: Number(doc.failed_count ?? 0),
      error: typeof doc.error === "string" ? doc.error : null,
    });
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not read this campaign");
  }
}

/** Loads one campaign with its full delivery log, for the history table's detail dialog. */
export async function loadEmailCampaign(
  campaignId: string,
): Promise<ActionData<EmailCampaign>> {
  try {
    const campaign = await getEmailCampaign(campaignId);
    if (!campaign) throw notFound("campaign");
    return succeeded(campaign);
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not read this campaign");
  }
}
