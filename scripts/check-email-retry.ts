/**
 * Drives the campaign runner and `retryCampaign` against a fake SMTP server and a real MongoDB, and
 * checks both retry layers: the runner's automatic retry of transient failures (and not of
 * permanent ones), and the manual retry of a finished or interrupted campaign - including that a
 * row already sent is never sent again and that two concurrent retries start one run.
 *
 * Needs a reachable MongoDB (`MONGO_URL`, default `mongodb://127.0.0.1:27017`). It always works in
 * its own database, whatever `MONGO_DB` says, and drops that database when it finishes. Takes about
 * 25 seconds, most of it the real retry backoff. Run with `pnpm check:email-retry`.
 */
import net from "node:net";

import { COLLECTIONS, currentTimestampMs, getCollection, getDb, toObjectId } from "../src/server/db";
import { retryCampaign } from "../src/server/email/campaign-retry";
import { newRunId, startCampaign } from "../src/server/email/campaign-runner";
import type { EmailConfig } from "../src/server/email/transport";

// ---- fake SMTP server -------------------------------------------------------------------------
// Each address maps to a list of RCPT replies consumed one per attempt; the last one repeats.
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
process.env.MONGO_DB = "pia_email_retry_check";
process.env.ADMIN_MONGO_DB = "pia_email_retry_check_admin";

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
