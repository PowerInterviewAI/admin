import "server-only";

import type { EmailMessage } from "@/lib/schemas/email";
import { renderEmailHtml } from "@/lib/email/template";
import { COLLECTIONS, type Document, currentTimestampMs, getCollection, toObjectId } from "@/server/db";
import {
  type EmailConfig,
  describeSmtpError,
  isTransientSmtpError,
  sendEmail,
} from "@/server/email/transport";

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
 * on `updated_at` is what the UI reads to call it interrupted rather than still sending. Retrying
 * the unsent rows afterwards is a second run over the same document (`retryEmailCampaign`).
 */

/** Attempts per recipient, the first included. */
export const SEND_MAX_ATTEMPTS = 3;

/**
 * Waits before the second and third attempt. Long enough for a greylisting or rate-limit window to
 * pass, short enough that one bad recipient does not stall the run for a minute.
 */
const RETRY_BACKOFF_MS = [2_000, 8_000] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One row to send, addressed by its position in the document's `recipients` array. */
export interface CampaignTarget {
  index: number;
  email: string;
  /** Already passed through `greetingName`; it is what the row stores. */
  name: string;
}

export interface RunCampaignArgs {
  campaignId: string;
  message: EmailMessage;
  targets: CampaignTarget[];
  config: EmailConfig;
  /** Counters as the document holds them when the run starts: zero for a new campaign, not for a retry. */
  initialSent: number;
  initialFailed: number;
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
  targets,
  config,
  initialSent,
  initialFailed,
}: RunCampaignArgs): Promise<void> {
  const collection = getCollection(COLLECTIONS.emailCampaigns);
  const _id = toObjectId(campaignId);
  const year = new Date().getFullYear();

  // Counted here and written as absolute values rather than `$inc`ed. This loop is the only writer
  // of the document while it runs, so there is nothing to race with, and it keeps the counters
  // consistent with the per-recipient rows even if one update is retried.
  let sent = initialSent;
  let failed = initialFailed;

  for (const [position, target] of targets.entries()) {
    const { index } = target;

    // Rendered per recipient because the greeting is baked into the body; everything else about
    // the document is identical between them.
    const html = renderEmailHtml({
      appName: config.appName,
      name: target.name,
      subject: message.subject,
      body: message.body,
      template: message.template,
      year,
    });

    const outcome = await sendWithRetry(
      () =>
        sendEmail({
          config,
          toEmail: target.email,
          toName: target.name,
          subject: message.subject,
          html,
        }),
      // A backoff plus up to three 30s socket timeouts would outlast the heartbeat threshold, and
      // a healthy run would read as interrupted while it waits out a flaky provider.
      () => collection.updateOne({ _id }, { $set: { updated_at: currentTimestampMs() } }),
    );

    if (outcome.ok) {
      sent += 1;

      // Typed as `Document` so the driver's `MatchKeysAndValues` sees an index signature: a
      // literal mixing dotted recipient paths with plain fields does not satisfy it.
      const update: Document = {
        [`recipients.${index}.status`]: "sent",
        [`recipients.${index}.error`]: null,
        [`recipients.${index}.sent_at`]: currentTimestampMs(),
        [`recipients.${index}.attempts`]: outcome.attempts,
        sent_count: sent,
        updated_at: currentTimestampMs(),
      };
      await collection.updateOne({ _id }, { $set: update });
    } else {
      failed += 1;

      const update: Document = {
        [`recipients.${index}.status`]: "failed",
        [`recipients.${index}.error`]: describeSmtpError(outcome.error),
        [`recipients.${index}.attempts`]: outcome.attempts,
        failed_count: failed,
        updated_at: currentTimestampMs(),
      };
      await collection.updateOne({ _id }, { $set: update });
    }

    // Paces the run under the provider's rate limit, the same way the Python sender's `sleep(1)`
    // does. Skipped after the last recipient so a one-off send does not sit idle for a second.
    if (position < targets.length - 1) {
      await sleep(config.delayMs);
    }
  }

  // A run where every single recipient failed is a configuration problem, not a campaign that went
  // out with some bounces, and the history table should not show it as completed.
  await finish(campaignId, sent === 0 ? "failed" : "completed", null);
}

type SendOutcome = { ok: true; attempts: number } | { ok: false; attempts: number; error: unknown };

/**
 * Retries only what `isTransientSmtpError` says could succeed on a second try. A 5xx rejection or
 * a bad credential is recorded on the first attempt: repeating it would only slow the run down and
 * hit the provider with the same refused message.
 */
async function sendWithRetry(
  send: () => Promise<void>,
  heartbeat: () => Promise<unknown>,
): Promise<SendOutcome> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await send();
      return { ok: true, attempts: attempt };
    } catch (error) {
      if (attempt >= SEND_MAX_ATTEMPTS || !isTransientSmtpError(error)) {
        return { ok: false, attempts: attempt, error };
      }
      await heartbeat().catch(() => undefined);
      await sleep(RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
    }
  }
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
