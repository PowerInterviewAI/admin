import "server-only";

import { type ActionData, failed, succeeded } from "@/lib/action-result";
import {
  type EmailCampaign,
  type EmailCampaignProgress,
  campaignHeartbeatTimeoutMs,
  canPauseCampaign,
  canResumeCampaign,
  canRetryCampaign,
  canStopCampaign,
  isCampaignInterrupted,
  isCampaignLive,
} from "@/lib/schemas/email";
import { COLLECTIONS, type Document, currentTimestampMs, getCollection, toObjectId } from "@/server/db";
import {
  type CampaignScheduler,
  type CampaignTarget,
  newRunId,
  startCampaign,
} from "@/server/email/campaign-runner";
import { type EmailConfig, describeSmtpError, verifyTransport } from "@/server/email/transport";
import { AppError, describeWriteError } from "@/server/errors";
import { getEmailCampaign } from "@/server/queries/email-campaigns";

/**
 * Everything an admin can do to a campaign after it started: retry, pause, resume, stop.
 *
 * Kept out of the actions so it carries no session check and no `refresh()`: those are the
 * actions' half, and without them this can be driven against a real database and SMTP server from
 * a script (`pnpm check:email-campaigns`).
 *
 * Pause and stop are *requests* (`control`) that the running loop acts on at its next check-in,
 * not status writes made from here - see `emailCampaignControlSchema` for why.
 */

const CHANGED_UNDERNEATH =
  "This campaign changed while you were looking at it. Reopen it and try again.";

type Loaded =
  | { ok: true; campaign: EmailCampaign; interrupted: boolean }
  | { ok: false; error: string };

async function load(campaignId: string, config: { delayMs: number }): Promise<Loaded> {
  let campaign: EmailCampaign | null;
  try {
    campaign = await getEmailCampaign(campaignId);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof AppError ? error.message : "Could not read this campaign",
    };
  }
  if (!campaign) return { ok: false, error: "This campaign no longer exists" };
  const interrupted = isCampaignInterrupted(campaign, campaignHeartbeatTimeoutMs(config.delayMs));
  return { ok: true, campaign, interrupted };
}

function progressOf(campaign: EmailCampaign, interrupted: boolean): EmailCampaignProgress {
  return {
    id: campaign._id,
    status: campaign.status,
    interrupted,
    total: campaign.total,
    sent_count: campaign.sent_count,
    failed_count: campaign.failed_count,
    error: campaign.error,
    updated_at: campaign.updated_at,
    control: campaign.control,
  };
}

async function reread(
  campaignId: string,
  config: { delayMs: number },
): Promise<ActionData<EmailCampaignProgress>> {
  const loaded = await load(campaignId, config);
  if (!loaded.ok) return failed(loaded.error);
  return succeeded(progressOf(loaded.campaign, loaded.interrupted));
}

/**
 * Claims a campaign for a new run over `targets` and starts it.
 *
 * The claim is conditional on `updated_at` still holding the value read by the caller, so two
 * admins pressing Retry (or Resume) at once start one run, not two. It also writes a fresh
 * `run_id`: an "interrupted" run is only one whose heartbeat went stale, and a run stuck in a long
 * SMTP call can still wake up afterwards. The runner checks that id before every send attempt and
 * stops once it no longer owns the campaign, so at most the one message it was in the middle of
 * goes out twice.
 */
async function claimAndStart({
  campaign,
  targets,
  initialFailed,
  extra,
  config,
  schedule,
}: {
  campaign: EmailCampaign;
  targets: CampaignTarget[];
  initialFailed: number;
  extra: Document;
  config: EmailConfig;
  schedule: CampaignScheduler | undefined;
}): Promise<ActionData<EmailCampaignProgress>> {
  try {
    await verifyTransport(config);
  } catch (error) {
    return failed(describeSmtpError(error));
  }

  const now = currentTimestampMs();
  const runId = newRunId();
  const reset: Document = {
    run_id: runId,
    status: "sending",
    control: null,
    error: null,
    finished_at: null,
    failed_count: initialFailed,
    updated_at: now,
    ...extra,
  };
  for (const { index } of targets) {
    reset[`recipients.${index}.status`] = "pending";
    reset[`recipients.${index}.error`] = null;
  }

  try {
    const claim = await getCollection(COLLECTIONS.emailCampaigns).updateOne(
      { _id: toObjectId(campaign._id), updated_at: campaign.updated_at },
      { $set: reset },
    );
    if (claim.matchedCount === 0) return failed(CHANGED_UNDERNEATH);
  } catch (error) {
    return failed(describeWriteError(error, "campaign").message);
  }

  startCampaign({
    campaignId: campaign._id,
    message: { subject: campaign.subject, body: campaign.body, template: campaign.template },
    targets,
    config,
    initialSent: campaign.sent_count,
    initialFailed,
    runId,
    schedule,
  });

  return succeeded({
    id: campaign._id,
    status: "sending",
    interrupted: false,
    total: campaign.total,
    sent_count: campaign.sent_count,
    failed_count: initialFailed,
    error: null,
    updated_at: now,
    control: null,
  });
}

function targetsWhere(
  campaign: EmailCampaign,
  include: (status: EmailCampaign["recipients"][number]["status"]) => boolean,
): CampaignTarget[] {
  return campaign.recipients.flatMap((recipient, index) =>
    include(recipient.status) && recipient.email
      ? [{ index, email: recipient.email, name: recipient.name }]
      : [],
  );
}

/**
 * Re-runs every row of a finished, stopped, or interrupted campaign that was not delivered: failed
 * rows, and rows still `pending` because the run died or was stopped. Rows already sent are never
 * touched, so retrying twice cannot mail anybody twice.
 *
 * The targeted rows are reset to `pending` and `failed_count` drops by the failures being retried
 * before the run starts, so the progress bar and the counters read the retry as the same campaign
 * resuming rather than as a second total stacked on the first.
 */
export async function retryCampaign(
  campaignId: string,
  config: EmailConfig,
  schedule?: CampaignScheduler,
): Promise<ActionData<EmailCampaignProgress>> {
  const loaded = await load(campaignId, config);
  if (!loaded.ok) return failed(loaded.error);
  const { campaign, interrupted } = loaded;

  if (!canRetryCampaign({ ...campaign, interrupted })) {
    if (isCampaignLive({ status: campaign.status, interrupted })) {
      return failed("This campaign is still sending");
    }
    if (campaign.status === "paused") return failed("This campaign is paused. Resume it instead.");
    return failed("Every recipient of this campaign was already reached");
  }

  const targets = targetsWhere(campaign, (status) => status !== "sent");
  if (targets.length === 0) return failed("Every recipient of this campaign was already reached");

  const retriedFailures = targets.filter(
    (target) => campaign.recipients[target.index]?.status === "failed",
  ).length;

  return claimAndStart({
    campaign,
    targets,
    initialFailed: Math.max(0, campaign.failed_count - retriedFailures),
    extra: { retry_count: campaign.retry_count + 1 },
    config,
    schedule,
  });
}

/**
 * Continues a paused campaign from where it stopped: only the rows still `pending`. Failures stay
 * failed - re-sending those is what Retry is for, once the run has finished.
 */
export async function resumeCampaign(
  campaignId: string,
  config: EmailConfig,
  schedule?: CampaignScheduler,
): Promise<ActionData<EmailCampaignProgress>> {
  const loaded = await load(campaignId, config);
  if (!loaded.ok) return failed(loaded.error);
  const { campaign } = loaded;

  if (!canResumeCampaign(campaign)) return failed("Only a paused campaign can be resumed");

  const targets = targetsWhere(campaign, (status) => status === "pending");
  if (targets.length === 0) {
    // Paused on its last recipient: there is nothing left to send, so close it out instead of
    // starting a run with no work.
    const now = currentTimestampMs();
    await getCollection(COLLECTIONS.emailCampaigns).updateOne(
      { _id: toObjectId(campaign._id), status: "paused" },
      {
        $set: {
          status: campaign.sent_count === 0 ? "failed" : "completed",
          finished_at: now,
          updated_at: now,
        },
      },
    );
    return reread(campaignId, config);
  }

  return claimAndStart({
    campaign,
    targets,
    initialFailed: campaign.failed_count,
    extra: {},
    config,
    schedule,
  });
}

/** Asks the running loop to pause before its next send. The message in flight still completes. */
export async function pauseCampaign(
  campaignId: string,
  config: { delayMs: number },
): Promise<ActionData<EmailCampaignProgress>> {
  const loaded = await load(campaignId, config);
  if (!loaded.ok) return failed(loaded.error);
  const { campaign, interrupted } = loaded;

  if (!canPauseCampaign({ ...campaign, interrupted })) {
    if (interrupted) return failed("This run is no longer running. Stop it or retry it instead.");
    if (campaign.control === "pause") return failed("This campaign is already pausing");
    if (campaign.control === "stop") return failed("This campaign is already stopping");
    return failed("This campaign is not sending");
  }

  // `control: null` in the filter so a pause can never overwrite a stop asked for a moment earlier.
  // `updated_at` moves with it so a list holding an earlier poll result treats the refreshed row,
  // which says "Pausing...", as the newer of the two.
  const result = await getCollection(COLLECTIONS.emailCampaigns).updateOne(
    { _id: toObjectId(campaignId), status: "sending", control: null },
    { $set: { control: "pause", updated_at: currentTimestampMs() } },
  );
  if (result.matchedCount === 0) return failed(CHANGED_UNDERNEATH);
  return reread(campaignId, config);
}

/**
 * Ends a campaign for good. A live run is asked to stop at its next check-in, like a pause. A
 * paused campaign has no loop to ask, and an interrupted one has a loop that is gone, so both are
 * closed out directly. Unsent rows stay `pending`, which is what Retry would send to.
 */
export async function stopCampaign(
  campaignId: string,
  config: { delayMs: number },
): Promise<ActionData<EmailCampaignProgress>> {
  const loaded = await load(campaignId, config);
  if (!loaded.ok) return failed(loaded.error);
  const { campaign, interrupted } = loaded;

  if (!canStopCampaign({ ...campaign, interrupted })) {
    if (campaign.control === "stop") return failed("This campaign is already stopping");
    return failed("This campaign has already finished");
  }

  const collection = getCollection(COLLECTIONS.emailCampaigns);
  const now = currentTimestampMs();
  const closeOut = { status: "stopped", control: null, finished_at: now, updated_at: now };

  let filter: Document;
  let update: Document;
  if (campaign.status === "paused") {
    filter = { status: "paused" };
    update = closeOut;
  } else if (interrupted) {
    // Conditional on the stale heartbeat, so a run that wakes up in the meantime is not closed out
    // from under it. Clearing `run_id` makes that run stop at its next check-in if it does wake.
    filter = { status: "sending", updated_at: campaign.updated_at };
    update = { ...closeOut, run_id: null };
  } else {
    filter = { status: "sending" };
    update = { control: "stop", updated_at: now };
  }

  const result = await collection.updateOne(
    { _id: toObjectId(campaignId), ...filter },
    { $set: update },
  );
  if (result.matchedCount === 0) return failed(CHANGED_UNDERNEATH);
  return reread(campaignId, config);
}
