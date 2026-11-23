import "server-only";

import { type ActionData, failed, succeeded } from "@/lib/action-result";
import {
  type EmailCampaign,
  type EmailCampaignProgress,
  campaignHeartbeatTimeoutMs,
  canRetryCampaign,
  isCampaignInterrupted,
  isCampaignLive,
} from "@/lib/schemas/email";
import { COLLECTIONS, type Document, currentTimestampMs, getCollection, toObjectId } from "@/server/db";
import { startCampaign } from "@/server/email/campaign-runner";
import { type EmailConfig, describeSmtpError, verifyTransport } from "@/server/email/transport";
import { AppError, describeWriteError } from "@/server/errors";
import { getEmailCampaign } from "@/server/queries/email-campaigns";

/**
 * Re-runs every row of a finished or interrupted campaign that was not delivered: failed rows and,
 * for a run that died, rows still `pending`. Rows already sent are never touched, so retrying twice
 * cannot mail anybody twice.
 *
 * The targeted rows are reset to `pending` and `failed_count` drops by the failures being retried
 * before the run starts, so the progress bar and the counters read the retry as the same campaign
 * resuming rather than as a second total stacked on the first.
 *
 * The claim is conditional on `updated_at` still holding the value read here. Every runner write
 * touches it, so two admins pressing Retry at once (or a run that turned out to be alive after
 * all) lose the race cleanly instead of starting a second loop over the same rows.
 *
 * Kept out of the action so it carries no session check and no `refresh()`: those are the action's
 * half, and without them this can be driven against a real database and SMTP server from a script.
 */
export async function retryCampaign(
  campaignId: string,
  config: EmailConfig,
): Promise<ActionData<EmailCampaignProgress>> {
  let found: EmailCampaign | null;
  try {
    found = await getEmailCampaign(campaignId);
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not read this campaign");
  }
  if (!found) return failed("This campaign no longer exists");
  const campaign = found;

  const interrupted = isCampaignInterrupted(campaign, campaignHeartbeatTimeoutMs(config.delayMs));
  if (!canRetryCampaign({ ...campaign, interrupted })) {
    return failed(
      isCampaignLive({ status: campaign.status, interrupted })
        ? "This campaign is still sending"
        : "Every recipient of this campaign was already reached",
    );
  }

  const targets = campaign.recipients.flatMap((recipient, index) =>
    recipient.status === "sent" || !recipient.email
      ? []
      : [{ index, email: recipient.email, name: recipient.name }],
  );
  if (targets.length === 0) {
    return failed("Every recipient of this campaign was already reached");
  }

  const retriedFailures = targets.filter(
    (target) => campaign.recipients[target.index]?.status === "failed",
  ).length;
  const initialFailed = Math.max(0, campaign.failed_count - retriedFailures);

  try {
    await verifyTransport(config);
  } catch (error) {
    return failed(describeSmtpError(error));
  }

  const now = currentTimestampMs();
  const reset: Document = {
    status: "sending",
    error: null,
    finished_at: null,
    failed_count: initialFailed,
    retry_count: campaign.retry_count + 1,
    updated_at: now,
  };
  for (const { index } of targets) {
    reset[`recipients.${index}.status`] = "pending";
    reset[`recipients.${index}.error`] = null;
  }

  try {
    const claim = await getCollection(COLLECTIONS.emailCampaigns).updateOne(
      { _id: toObjectId(campaignId), updated_at: campaign.updated_at },
      { $set: reset },
    );
    if (claim.matchedCount === 0) {
      return failed("This campaign changed while you were looking at it. Reopen it and try again.");
    }
  } catch (error) {
    return failed(describeWriteError(error, "campaign").message);
  }

  startCampaign({
    campaignId,
    message: { subject: campaign.subject, body: campaign.body, template: campaign.template },
    targets,
    config,
    initialSent: campaign.sent_count,
    initialFailed,
  });

  return succeeded({
    id: campaignId,
    status: "sending",
    interrupted: false,
    total: campaign.total,
    sent_count: campaign.sent_count,
    failed_count: initialFailed,
    error: null,
    updated_at: now,
  });
}
