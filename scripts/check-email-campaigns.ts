/**
 * Drives the campaign runner and `campaign-control.ts` against a fake SMTP server and a real
 * MongoDB. Covers the runner's automatic retry of transient failures (and not of permanent ones),
 * the manual retry of a finished, stopped, or interrupted campaign, a run superseded by a retry,
 * and pause, resume and stop - throughout, that a row already sent is never sent again.
 *
 * Needs a reachable MongoDB (`MONGO_URL`, default `mongodb://127.0.0.1:27017`). It always works in
 * its own database, whatever `MONGO_DB` says, and drops that database when it finishes. Takes about
 * 50 seconds, most of it the real retry backoff and send pacing. Run with
 * `pnpm check:email-campaigns`.
 */
import net from "node:net";

import { COLLECTIONS, currentTimestampMs, getCollection, getDb, toObjectId } from "../src/server/db";
import {
  pauseCampaign,
  resumeCampaign,
  retryCampaign,
  stopCampaign,
} from "../src/server/email/campaign-control";
import { newRunId, startCampaign } from "../src/server/email/campaign-runner";
import { type EmailConfig, isTransientSmtpError } from "../src/server/email/transport";

// ---- fake SMTP server -------------------------------------------------------------------------
// Each address maps to a list of RCPT replies consumed one per attempt; the last one repeats.
// A reply of 0 never answers, which is how a stalled SMTP server looks to the client.
const script = new Map<string, number[]>();
const rcptAttempts = new Map<string, number>();
const delivered = new Map<string, number>();

function rcptReply(addr: string): number {
  const n = rcptAttempts.get(addr) ?? 0;
  rcptAttempts.set(addr, n + 1);
  const plan = script.get(addr) ?? [250];
  return plan[Math.min(n, plan.length - 1)]!;
}

const server = net.createServer((sock) => {
  let buf = "";
  let inData = false;
  let rcpts: string[] = [];
  const say = (line: string) => sock.write(line + "\r\n");
  say("220 fake ESMTP");
  sock.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    for (;;) {
      if (inData) {
        const end = buf.indexOf("\r\n.\r\n");
        if (end < 0) return;
        buf = buf.slice(end + 5);
        inData = false;
        for (const r of rcpts) delivered.set(r, (delivered.get(r) ?? 0) + 1);
        rcpts = [];
        say("250 queued");
        continue;
      }
      const nl = buf.indexOf("\r\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === "EHLO") say("250-fake\r\n250-AUTH PLAIN\r\n250 8BITMIME");
      else if (cmd === "HELO") say("250 fake");
      else if (cmd === "AUTH") say("235 ok");
      else if (cmd === "MAIL") {
        rcpts = [];
        say("250 ok");
      } else if (cmd === "RCPT") {
        const addr = /<([^>]+)>/.exec(line)?.[1] ?? "";
        const code = rcptReply(addr);
        if (code === 0) continue;
        if (code === 250) {
          rcpts.push(addr);
          say("250 ok");
        } else say(`${code} ${code >= 500 ? "5.1.1 no such user" : "4.7.1 try again later"}`);
      } else if (cmd === "DATA") {
        inData = true;
        say("354 go");
      } else if (cmd === "RSET") {
        rcpts = [];
        say("250 ok");
      } else if (cmd === "NOOP") say("250 ok");
      else if (cmd === "QUIT") {
        say("221 bye");
        sock.end();
      } else say("502 unknown");
    }
  });
  sock.on("error", () => undefined);
});

// ---- helpers ----------------------------------------------------------------------------------
let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`);
}

const collection = () => getCollection(COLLECTIONS.emailCampaigns);

async function insertCampaign(
  recipients: { email: string; status?: string; sent?: boolean }[],
  extra: Record<string, unknown> = {},
): Promise<string> {
  const now = currentTimestampMs();
  const rows = recipients.map((r) => ({
    email: r.email,
    name: r.email.split("@")[0],
    user_id: null,
    status: r.status ?? "pending",
    error: r.status === "failed" ? "earlier failure" : null,
    sent_at: r.status === "sent" ? now : null,
    attempts: r.status && r.status !== "pending" ? 1 : 0,
  }));
  const result = await collection().insertOne({
    audience: "selected",
    subject: "Selftest",
    body: "<p>hi</p>",
    template: "info",
    status: "sending",
    total: rows.length,
    sent_count: rows.filter((r) => r.status === "sent").length,
    failed_count: rows.filter((r) => r.status === "failed").length,
    from_email: "noreply@example.test",
    from_name: "Selftest",
    finished_at: null,
    error: null,
    retry_count: 0,
    recipients: rows,
    created_at: now,
    updated_at: now,
    ...extra,
  });
  return result.insertedId.toHexString();
}

async function waitDone(id: string) {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const doc = await collection().findOne({ _id: toObjectId(id) });
    if (doc && doc.status !== "sending") return doc;
    if (Date.now() > deadline) throw new Error(`campaign ${id} never finished`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const rowsOf = (doc: Record<string, unknown>) =>
  (doc.recipients as { email: string; status: string; attempts: number; error: string | null }[]).map(
    (r) => `${r.email.split("@")[0]}:${r.status}:${r.attempts}`,
  );

// Set before anything reads them: `getDb` resolves the name per call, and this script drops it.
process.env.MONGO_URL ??= "mongodb://127.0.0.1:27017";
process.env.MONGO_DB = "pia_email_campaigns_check";
process.env.ADMIN_MONGO_DB = "pia_email_campaigns_check_admin";

// ---- run --------------------------------------------------------------------------------------
async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  const config: EmailConfig = {
    host: "127.0.0.1",
    port,
    user: "selftest",
    password: "selftest",
    fromAddress: "noreply@example.test",
    fromName: "Selftest",
    appName: "Selftest",
    delayMs: 50,
    testAddress: "",
  };

  console.log("\n== 1. automatic retry inside a run ==");
  script.set("ok@t.test", [250]);
  script.set("flaky@t.test", [451, 451, 250]);
  script.set("bounce@t.test", [550]);
  script.set("down@t.test", [451]);
  const emails = ["ok@t.test", "flaky@t.test", "bounce@t.test", "down@t.test"];
  const runId = newRunId();
  const id = await insertCampaign(emails.map((email) => ({ email })), { run_id: runId });
  const started = Date.now();
  startCampaign({
    campaignId: id,
    message: { subject: "Selftest", body: "<p>hi</p>", template: "info" },
    targets: emails.map((email, index) => ({ index, email, name: email.split("@")[0]! })),
    config,
    initialSent: 0,
    initialFailed: 0,
    runId,
  });
  let doc = await waitDone(id);
  console.log(`   (run took ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  check("rows (name:status:attempts)", rowsOf(doc), [
    "ok:sent:1",
    "flaky:sent:3",
    "bounce:failed:1",
    "down:failed:3",
  ]);
  check("counters", [doc.status, doc.sent_count, doc.failed_count], ["completed", 2, 2]);
  check("RCPT attempts seen by server", emails.map((e) => rcptAttempts.get(e)), [1, 3, 1, 3]);

  console.log("\n== 2. manual retry of the failed rows ==");
  script.set("bounce@t.test", [250]);
  script.set("down@t.test", [250]);
  rcptAttempts.clear();
  const [a, b] = await Promise.all([retryCampaign(id, config), retryCampaign(id, config)]);
  check("exactly one of two concurrent retries claims the run", [a.ok, b.ok].filter(Boolean).length, 1);
  const loser = a.ok ? b : a;
  console.log(`   loser said: ${loser.ok ? "-" : loser.error}`);
  const winner = a.ok ? a : b;
  check(
    "retry starts from resumed counters",
    winner.ok ? [winner.data.sent_count, winner.data.failed_count] : null,
    [2, 0],
  );
  doc = await waitDone(id);
  check("rows after retry", rowsOf(doc), ["ok:sent:1", "flaky:sent:3", "bounce:sent:1", "down:sent:1"]);
  check("counters after retry", [doc.status, doc.sent_count, doc.failed_count, doc.retry_count], [
    "completed",
    4,
    0,
    1,
  ]);
  check("already-sent rows were not re-sent", [rcptAttempts.get("ok@t.test") ?? 0, rcptAttempts.get("flaky@t.test") ?? 0], [0, 0]);
  check("deliveries per address overall", emails.map((e) => delivered.get(e) ?? 0), [1, 1, 1, 1]);

  const again = await retryCampaign(id, config);
  check("retry on a fully sent campaign is refused", again.ok ? "ok" : again.error, "Every recipient of this campaign was already reached");

  console.log("\n== 3. interrupted run ==");
  rcptAttempts.clear();
  const stale = currentTimestampMs() - 10 * 60_000;
  const intId = await insertCampaign(
    [
      { email: "was-sent@t.test", status: "sent" },
      { email: "never-reached@t.test", status: "pending" },
      { email: "had-failed@t.test", status: "failed" },
    ],
    { updated_at: stale },
  );
  const intRetry = await retryCampaign(intId, config);
  check("retry of an interrupted run is accepted", intRetry.ok, true);
  doc = await waitDone(intId);
  check("rows", rowsOf(doc), ["was-sent:sent:1", "never-reached:sent:1", "had-failed:sent:1"]);
  check("counters", [doc.status, doc.sent_count, doc.failed_count], ["completed", 3, 0]);
  check("sent row untouched", rcptAttempts.get("was-sent@t.test") ?? 0, 0);

  console.log("\n== 4. live run is refused ==");
  const liveId = await insertCampaign([{ email: "x@t.test", status: "failed" }, { email: "y@t.test" }]);
  const liveRetry = await retryCampaign(liveId, config);
  check("retry while still sending is refused", liveRetry.ok ? "ok" : liveRetry.error, "This campaign is still sending");

  console.log("\n== 5. a run superseded by a retry stops ==");
  const oldRun = newRunId();
  const slow = ["s1@t.test", "s2@t.test", "s3@t.test"];
  const supId = await insertCampaign(slow.map((email) => ({ email })), { run_id: oldRun });
  startCampaign({
    campaignId: supId,
    message: { subject: "Selftest", body: "<p>hi</p>", template: "info" },
    targets: slow.map((email, index) => ({ index, email, name: email.split("@")[0]! })),
    config: { ...config, delayMs: 1500 },
    initialSent: 0,
    initialFailed: 0,
    runId: oldRun,
  });
  // Wait for the first send, then take the campaign over the way a retry claim does.
  for (let i = 0; i < 40 && !delivered.get("s1@t.test"); i += 1) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await collection().updateOne({ _id: toObjectId(supId) }, { $set: { run_id: newRunId() } });
  await new Promise((r) => setTimeout(r, 4000));
  doc = (await collection().findOne({ _id: toObjectId(supId) }))!;
  check(
    "old run sent nothing after losing the campaign",
    slow.map((e) => delivered.get(e) ?? 0),
    [1, 0, 0],
  );
  check("old run did not close the campaign out", doc.status, "sending");

  // Paced slowly enough that a pause or stop always lands with recipients still to go.
  const paced = { ...config, delayMs: 700 };
  const statuses = (doc: Record<string, unknown>) =>
    (doc.recipients as { status: string }[]).map((r) => r.status);
  const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (id: string, status: string) => {
    for (let i = 0; i < 200; i += 1) {
      const current = await collection().findOne({ _id: toObjectId(id) });
      if (current?.status === status) return current;
      await sleepMs(100);
    }
    throw new Error(`campaign ${id} never reached ${status}`);
  };
  const startFresh = async (emails: string[]) => {
    const run = newRunId();
    const campaignId = await insertCampaign(emails.map((email) => ({ email })), { run_id: run });
    startCampaign({
      campaignId,
      message: { subject: "Selftest", body: "<p>hi</p>", template: "info" },
      targets: emails.map((email, index) => ({ index, email, name: email.split("@")[0]! })),
      config: paced,
      initialSent: 0,
      initialFailed: 0,
      runId: run,
    });
    // Let the first recipient go out before anyone touches the controls.
    for (let i = 0; i < 60 && !delivered.get(emails[0]!); i += 1) await sleepMs(50);
    return campaignId;
  };

  console.log("\n== 6. pause, then resume ==");
  const pauseEmails = ["p1@t.test", "p2@t.test", "p3@t.test", "p4@t.test"];
  const pauseId = await startFresh(pauseEmails);
  const pauseReq = await pauseCampaign(pauseId, paced);
  check("pause is accepted as a request", pauseReq.ok ? [pauseReq.data.status, pauseReq.data.control] : pauseReq.error, ["sending", "pause"]);
  const pauseAgain = await pauseCampaign(pauseId, paced);
  check("a second pause is refused", pauseAgain.ok ? "ok" : pauseAgain.error, "This campaign is already pausing");
  doc = await waitFor(pauseId, "paused");
  const sentAtPause = pauseEmails.filter((e) => delivered.get(e)).length;
  check("loop acknowledged: paused, request cleared", [doc.status, doc.control ?? null], ["paused", null]);
  check("stopped short of the end", sentAtPause > 0 && sentAtPause < pauseEmails.length, true);
  check("rows match deliveries", statuses(doc).filter((x) => x === "sent").length, sentAtPause);
  await sleepMs(1500);
  check("nothing sent while paused", pauseEmails.filter((e) => delivered.get(e)).length, sentAtPause);
  const retryWhilePaused = await retryCampaign(pauseId, paced);
  check("retry is refused while paused", retryWhilePaused.ok ? "ok" : retryWhilePaused.error, "This campaign is paused. Resume it instead.");
  const resumed = await resumeCampaign(pauseId, paced);
  check("resume starts a run", resumed.ok ? resumed.data.status : resumed.error, "sending");
  doc = await waitDone(pauseId);
  check("resume finished the campaign", [doc.status, doc.sent_count, doc.failed_count], ["completed", 4, 0]);
  check("each recipient got exactly one email", pauseEmails.map((e) => delivered.get(e) ?? 0), [1, 1, 1, 1]);

  console.log("\n== 7. stop a live run, then retry the rest ==");
  const stopEmails = ["x1@t.test", "x2@t.test", "x3@t.test", "x4@t.test"];
  const stopId = await startFresh(stopEmails);
  const stopReq = await stopCampaign(stopId, paced);
  check("stop is accepted as a request", stopReq.ok ? stopReq.data.control : stopReq.error, "stop");
  const pauseAfterStop = await pauseCampaign(stopId, paced);
  check("a pause cannot overwrite a stop", pauseAfterStop.ok ? "ok" : pauseAfterStop.error, "This campaign is already stopping");
  doc = await waitFor(stopId, "stopped");
  const sentAtStop = stopEmails.filter((e) => delivered.get(e)).length;
  check("loop acknowledged: stopped with a finish time", [doc.status, doc.control ?? null, typeof doc.finished_at], ["stopped", null, "number"]);
  check("stopped short of the end", sentAtStop > 0 && sentAtStop < stopEmails.length, true);
  await sleepMs(1500);
  check("nothing sent after stopping", stopEmails.filter((e) => delivered.get(e)).length, sentAtStop);
  const resumeStopped = await resumeCampaign(stopId, paced);
  check("a stopped campaign cannot be resumed", resumeStopped.ok ? "ok" : resumeStopped.error, "Only a paused campaign can be resumed");
  const retryStopped = await retryCampaign(stopId, paced);
  check("retry of a stopped campaign is accepted", retryStopped.ok, true);
  doc = await waitDone(stopId);
  check("retry sent the rest", [doc.status, doc.sent_count], ["completed", 4]);
  check("each recipient got exactly one email", stopEmails.map((e) => delivered.get(e) ?? 0), [1, 1, 1, 1]);

  console.log("\n== 8. stop a paused campaign ==");
  const pausedStopEmails = ["ps1@t.test", "ps2@t.test", "ps3@t.test"];
  const pausedStopId = await startFresh(pausedStopEmails);
  await pauseCampaign(pausedStopId, paced);
  await waitFor(pausedStopId, "paused");
  const stopPaused = await stopCampaign(pausedStopId, paced);
  check("stopping a paused campaign closes it at once", stopPaused.ok ? stopPaused.data.status : stopPaused.error, "stopped");

  console.log("\n== 9. stop an interrupted campaign ==");
  const deadId = await insertCampaign([{ email: "d1@t.test", status: "sent" }, { email: "d2@t.test" }], {
    updated_at: currentTimestampMs() - 10 * 60_000,
    run_id: newRunId(),
  });
  const pauseDead = await pauseCampaign(deadId, paced);
  check("an interrupted run cannot be paused", pauseDead.ok ? "ok" : pauseDead.error, "This run is no longer running. Stop it or retry it instead.");
  const stopDead = await stopCampaign(deadId, paced);
  check("stopping an interrupted run closes it out", stopDead.ok ? [stopDead.data.status, stopDead.data.interrupted] : stopDead.error, ["stopped", false]);

  console.log("\n== 10. a stalled send times out and is retried ==");
  script.set("stall@t.test", [0, 250]);
  rcptAttempts.clear();
  const stallRun = newRunId();
  const stallEmails = ["stall@t.test", "after-stall@t.test"];
  const stallId = await insertCampaign(stallEmails.map((email) => ({ email })), { run_id: stallRun });
  startCampaign({
    campaignId: stallId,
    message: { subject: "Selftest", body: "<p>hi</p>", template: "info" },
    targets: stallEmails.map((email, index) => ({ index, email, name: email.split("@")[0]! })),
    config,
    initialSent: 0,
    initialFailed: 0,
    runId: stallRun,
    attemptTimeoutMs: 1000,
  });
  doc = await waitDone(stallId);
  check("rows", rowsOf(doc), ["stall:sent:2", "after-stall:sent:1"]);
  check("deliveries", stallEmails.map((e) => delivered.get(e) ?? 0), [1, 1]);
  check(
    "a message failed by a closed pool is retried, not recorded as refused",
    isTransientSmtpError(new Error("Connection pool was closed")),
    true,
  );

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(async () => {
    await getDb().dropDatabase().catch(() => undefined);
    process.exit(failures === 0 ? 0 : 1);
  });
