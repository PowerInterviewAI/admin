import "server-only";

import type { EmailMessage } from "@/lib/schemas/email";
import { greetingName, renderEmailHtml } from "@/lib/email/template";
import { COLLECTIONS, type Document, currentTimestampMs, getCollection, toObjectId } from "@/server/db";
import { type EmailConfig, describeSmtpError, sendEmail } from "@/server/email/transport";
import type { EmailRecipient } from "@/server/queries/email-recipients";

/**
 * Walks a campaign's recipient list in the background.
 *
 * The action that starts a run returns as soon as the campaign document exists, and this keeps
 * going in the same Node process afterwards. A server action cannot hold a request open for the
 * minutes a few hundred recipients take at one per second, and a progress bar an admin can watch
 * beats a spinner that eventually times out.
 *
 * The cost of that choice is honest and visible: if the process restarts mid-run, nothing resumes.
 * Every recipient is written to the document before the first send and flipped in place as the run
 * proceeds, so an interrupted campaign still says exactly who was reached, and the stale heartbeat
 * on `updated_at` is what the UI reads to call it interrupted rather than still sending.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RunCampaignArgs {
  campaignId: string;
  message: EmailMessage;
  recipients: EmailRecipient[];
  config: EmailConfig;
}

export function startCampaign(args: RunCampaignArgs): void {
  // Nothing awaits this, so an unhandled rejection here would take down the process rather than
  // fail the campaign. `runCampaign` already catches per recipient; this is the last resort.
  void runCampaign(args).catch((error: unknown) => {
    console.error(`Campaign ${args.campaignId} stopped unexpectedly`, error);
    void finish(args.campaignId, "failed", describeSmtpError(error));
  });
}

async function runCampaign({
  campaignId,
  message,
  recipients,
  config,
}: RunCampaignArgs): Promise<void> {
  const collection = getCollection(COLLECTIONS.emailCampaigns);
  const _id = toObjectId(campaignId);
  const year = new Date().getFullYear();

  // Counted here and written as absolute values rather than `$inc`ed. This loop is the only writer
  // of the document, so there is nothing to race with, and it keeps the counters consistent with
  // the per-recipient rows even if one update is retried.
  let sent = 0;
  let failed = 0;

  for (const [index, recipient] of recipients.entries()) {
    const name = greetingName(recipient.username);

    // Rendered per recipient because the greeting is baked into the body; everything else about
    // the document is identical between them.
    const html = renderEmailHtml({
      appName: config.appName,
      name,
      subject: message.subject,
      body: message.body,
      template: message.template,
      year,
    });

    try {
      await sendEmail({
        config,
        toEmail: recipient.email,
        toName: name,
        subject: message.subject,
        html,
      });
      sent += 1;

      // Typed as `Document` so the driver's `MatchKeysAndValues` sees an index signature: a
      // literal mixing dotted recipient paths with plain fields does not satisfy it.
      const update: Document = {
        [`recipients.${index}.status`]: "sent",
        [`recipients.${index}.sent_at`]: currentTimestampMs(),
        sent_count: sent,
        updated_at: currentTimestampMs(),
      };
      await collection.updateOne({ _id }, { $set: update });
    } catch (error) {
      failed += 1;

      const update: Document = {
        [`recipients.${index}.status`]: "failed",
        [`recipients.${index}.error`]: describeSmtpError(error),
        failed_count: failed,
        updated_at: currentTimestampMs(),
      };
      await collection.updateOne({ _id }, { $set: update });
    }

    // Paces the run under the provider's rate limit, the same way the Python sender's `sleep(1)`
    // does. Skipped after the last recipient so a one-off send does not sit idle for a second.
    if (index < recipients.length - 1) {
      await sleep(config.delayMs);
    }
  }

  // A run where every single recipient failed is a configuration problem, not a campaign that went
  // out with some bounces, and the history table should not show it as completed.
  await finish(campaignId, sent === 0 ? "failed" : "completed", null);
}

async function finish(
  campaignId: string,
  status: "completed" | "failed",
  error: string | null,
): Promise<void> {
  try {
    await getCollection(COLLECTIONS.emailCampaigns).updateOne(
      { _id: toObjectId(campaignId) },
      {
        $set: {
          status,
          error,
          finished_at: currentTimestampMs(),
          updated_at: currentTimestampMs(),
        },
      },
    );
  } catch (writeError) {
    console.error(`Could not close out campaign ${campaignId}`, writeError);
  }
}
