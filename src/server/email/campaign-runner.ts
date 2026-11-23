import "server-only";

import { randomUUID } from "node:crypto";

import type { EmailCampaignControl, EmailMessage } from "@/lib/schemas/email";
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
 * the unsent rows afterwards, or resuming a paused campaign, is a second run over the same
 * document (`campaign-control.ts`).
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
  /**
   * The `run_id` this run was started under. Every write is conditional on the document still
   * holding it, so a run that a retry has superseded stops at its next write instead of carrying on
   * beside the new one.
   */
  runId: string;
}

/** A fresh `run_id` for a campaign about to be (re)started. */
export function newRunId(): string {
  return randomUUID();
}

/**
 * Thrown when the document no longer carries this run's id. A retry only claims a campaign whose
 * heartbeat looked stale, and a run stuck in one long SMTP call looks exactly like that while still
 * being alive - without this it would wake up and keep sending, mailing the rows the retry is also
 * walking and overwriting its counters.
 */
class SupersededRun extends Error {}

/** An admin asked this run to pause or stop; seen at the check-in before the next send attempt. */
class ControlRequested extends Error {
  constructor(readonly control: EmailCampaignControl) {
    super(`Campaign ${control} requested`);
  }
}

export function startCampaign(args: RunCampaignArgs): void {
  // Nothing awaits this, so an unhandled rejection here would take down the process rather than
  // fail the campaign. `runCampaign` already catches per recipient; this is the last resort.
  void runCampaign(args).catch((error: unknown) => {
    if (error instanceof SupersededRun) {
      console.warn(`Campaign ${args.campaignId}: run ${args.runId} was superseded by a retry`);
      return;
    }
    console.error(`Campaign ${args.campaignId} stopped unexpectedly`, error);
    void finish(args.campaignId, args.runId, "failed", describeSmtpError(error));
  });
}

async function runCampaign({
  campaignId,
  message,
  targets,
  config,
  initialSent,
  initialFailed,
  runId,
}: RunCampaignArgs): Promise<void> {
  const collection = getCollection(COLLECTIONS.emailCampaigns);
  const owned = { _id: toObjectId(campaignId), run_id: runId };

  const write = async (update: Document) => {
    const result = await collection.updateOne(owned, { $set: update });
    if (result.matchedCount === 0) throw new SupersededRun();
  };

  // Runs before every send attempt: the heartbeat, the ownership check, and the one place a pause
  // or stop is picked up. Checking here rather than mid-send is what lets the message in flight
  // finish and be recorded, so nothing is left `pending` that was actually delivered.
  const checkIn = async () => {
    const doc = await collection.findOneAndUpdate(
      owned,
      { $set: { updated_at: currentTimestampMs() } },
      { projection: { control: 1 } },
    );
    if (!doc) throw new SupersededRun();
    if (doc.control === "pause" || doc.control === "stop") {
      throw new ControlRequested(doc.control);
    }
  };
  const year = new Date().getFullYear();

  // Counted here and written as absolute values rather than `$inc`ed. This loop is the only writer
  // of the document while it runs, so there is nothing to race with, and it keeps the counters
  // consistent with the per-recipient rows even if one update is retried.
  let sent = initialSent;
  let failed = initialFailed;

  try {
    await sendAll();
  } catch (error) {
    if (!(error instanceof ControlRequested)) throw error;
    // Rows not reached stay `pending`: Resume sends exactly those, and for a stopped campaign they
    // are what Retry would offer.
    const now = currentTimestampMs();
    await write({
      status: error.control === "pause" ? "paused" : "stopped",
      control: null,
      finished_at: error.control === "stop" ? now : null,
      updated_at: now,
    });
    return;
  }

  // A run where every single recipient failed is a configuration problem, not a campaign that went
  // out with some bounces, and the history table should not show it as completed.
  await finish(campaignId, runId, sent === 0 ? "failed" : "completed", null);

  async function sendAll() {
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
        checkIn,
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
        await write(update);
      } else {
        failed += 1;

        const update: Document = {
          [`recipients.${index}.status`]: "failed",
          [`recipients.${index}.error`]: describeSmtpError(outcome.error),
          [`recipients.${index}.attempts`]: outcome.attempts,
          failed_count: failed,
          updated_at: currentTimestampMs(),
        };
        await write(update);
      }

      // Paces the run under the provider's rate limit, the same way the Python sender's `sleep(1)`
      // does. Skipped after the last recipient so a one-off send does not sit idle for a second.
      if (position < targets.length - 1) {
        await sleep(config.delayMs);
      }
    }
  }
}

type SendOutcome = { ok: true; attempts: number } | { ok: false; attempts: number; error: unknown };

/**
 * Retries only what `isTransientSmtpError` says could succeed on a second try. A 5xx rejection or
 * a bad credential is recorded on the first attempt: repeating it would only slow the run down and
 * hit the provider with the same refused message.
 *
 * `heartbeat` runs before every attempt, the first included, and doubles as the ownership check.
 * Checking only when a result is written would let a superseded run send its next recipient first -
 * a recipient the retry that superseded it is about to send to as well. It also keeps the heartbeat
 * fresh across backoffs and up to three 30s socket timeouts, which would otherwise outlast the
 * interrupted threshold and make a healthy run look dead.
 */
async function sendWithRetry(
  send: () => Promise<void>,
  heartbeat: () => Promise<unknown>,
): Promise<SendOutcome> {
  for (let attempt = 1; ; attempt += 1) {
    if (attempt > 1) {
      await sleep(RETRY_BACKOFF_MS[attempt - 2] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
    }
    // A failed heartbeat write is not worth failing the recipient over. Being superseded, or asked
    // to pause or stop, must end the run before it sends again.
    await heartbeat().catch((heartbeatError: unknown) => {
      if (heartbeatError instanceof SupersededRun || heartbeatError instanceof ControlRequested) {
        throw heartbeatError;
      }
    });
    try {
      await send();
      return { ok: true, attempts: attempt };
    } catch (error) {
      if (attempt >= SEND_MAX_ATTEMPTS || !isTransientSmtpError(error)) {
        return { ok: false, attempts: attempt, error };
      }
    }
  }
}

async function finish(
  campaignId: string,
  runId: string,
  status: "completed" | "failed",
  error: string | null,
): Promise<void> {
  try {
    await getCollection(COLLECTIONS.emailCampaigns).updateOne(
      { _id: toObjectId(campaignId), run_id: runId },
      {
        $set: {
          status,
          // A pause or stop that arrived after the last check-in has nothing left to act on.
          control: null,
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
