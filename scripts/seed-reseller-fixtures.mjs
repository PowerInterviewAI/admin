/**
 * Fixture data for testing the reseller pages by hand: `/resellers`, `/resellers/history`,
 * `/resellers/settlements`, a reseller's own `/reseller` portal, and the RBAC refusals.
 *
 * Writes what backend and this app would have written themselves:
 * - reseller and guest accounts in `ADMIN_MONGO_DB` (`admin_accounts`), with API key digests;
 * - their customers in `users` (`reseller_id`, role `user`), with `signup` / `credits_applied`
 *   audit rows marked `metadata.source = "reseller"`;
 * - `reseller_ledger` rows, committed, with the rate snapshotted per sale, plus one in-flight
 *   `pending` row that no page may show;
 * - `reseller_settlements`, one per reseller per complete UTC day, computed with backend's rule
 *   (`round_half_up(sum(credits x rate) / 600)`, null when any credit that day was unpriced).
 *
 * Run with: node scripts/seed-reseller-fixtures.mjs
 *
 * Re-runnable: it deletes only what a previous run created (accounts under `@fixtures.example`,
 * their customers, ledger, settlements and audit rows) and leaves everything else alone. Refuses
 * to run against anything but a local MONGO_URL. `MONGO_URL` / `MONGO_DB` / `ADMIN_MONGO_DB` in
 * the process environment take precedence over `.env.local`, so a dashboard whose `.env.local`
 * points at a remote cluster can still be seeded locally:
 *
 *   MONGO_URL=mongodb://127.0.0.1:27017 node scripts/seed-reseller-fixtures.mjs
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const FIXTURE_DOMAIN = "fixtures.example";
const FIXTURE_PASSWORD = "Fixture!2026";
const CUSTOMER_PASSWORD = "Customer!2026";
const API_KEY_PREFIX = "pia_rk_";

const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CREDITS_PER_HOUR = 600;
const SETTLEMENT_GRACE = HOUR;

/**
 * Each reseller exercises a different part of the pages:
 * - acme: steady sales, a key, older days already paid, recent days open;
 * - bright: had no rate for its first weeks, so its early days settle as "Unpriced";
 * - nova: brand new, no rate and no key, to try issuing a key and setting a rate from scratch;
 * - oldpartner: rejected, so its key no longer works, with a settled and fully paid history.
 */
const RESELLERS = [
  {
    slug: "acme",
    name: "Acme Interview Prep",
    status: "approved",
    rate: 1250,
    rateSinceDaysAgo: Infinity,
    withKey: true,
    customers: 18,
    fromDaysAgo: 45,
    toDaysAgo: 0,
    paidOlderThanDays: 14,
    currencies: ["USD"],
  },
  {
    slug: "bright",
    name: "Bright Careers",
    status: "approved",
    rate: 900,
    rateSinceDaysAgo: 20,
    withKey: true,
    customers: 10,
    fromDaysAgo: 40,
    toDaysAgo: 0,
    paidOlderThanDays: null,
    currencies: ["USD", "EUR"],
  },
  {
    slug: "nova",
    name: "Nova Talent",
    status: "approved",
    rate: null,
    rateSinceDaysAgo: Infinity,
    withKey: false,
    customers: 0,
    fromDaysAgo: 0,
    toDaysAgo: 0,
    paidOlderThanDays: null,
    currencies: ["USD"],
  },
  {
    slug: "oldpartner",
    name: "Old Partner LLC",
    status: "rejected",
    rate: 1500,
    rateSinceDaysAgo: Infinity,
    withKey: true,
    customers: 5,
    fromDaysAgo: 60,
    toDaysAgo: 25,
    paidOlderThanDays: 0,
    currencies: ["USD"],
  },
];

const PRICES = { 0: null, 600: 9.99, 1200: 17.99, 3000: 39.99 };
const NOTES = ["Black Friday bundle", "Referral discount", "Corporate seat", "Renewal", "Upgrade from 1h pack"];
const FIRST = ["ava", "ben", "chloe", "dev", "elena", "farid", "grace", "hiro", "isla", "jonas", "kemi", "liam", "mia", "nora", "omar", "priya", "quinn", "ravi", "sofia", "tom"];
const LAST = ["adams", "baker", "chen", "diaz", "evans", "fischer", "garcia", "haddad", "ito", "jones", "khan", "lopez", "moreau", "nakamura", "okafor", "patel"];

// Deterministic, so a re-run produces the same customers and sales (keys are always fresh).
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261007);
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;

function loadEnv() {
  const env = {};
  try {
    const text = readFileSync(join(ROOT, ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local: the process environment has to carry everything.
  }
  return env;
}

function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function issueKey() {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    key,
    fields: {
      api_key_hash: createHash("sha256").update(key).digest("hex"),
      api_key_prefix: key.slice(0, API_KEY_PREFIX.length + 5),
      api_key_created_at: NOW - int(1, 20) * DAY,
    },
  };
}

async function main() {
  const fileEnv = loadEnv();
  const env = (name, fallback) => process.env[name] || fileEnv[name] || fallback;
  const uri = env("MONGO_URL");
  if (!uri) throw new Error("MONGO_URL is not set");
  if (!/^mongodb:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(uri)) {
    throw new Error(
      `Refusing to seed a database that is not local: ${uri.replace(/\/\/[^@]*@/, "//***@")}\n` +
        "Run with MONGO_URL=mongodb://127.0.0.1:27017 to seed your local database.",
    );
  }

  const client = new MongoClient(uri, { appName: "power-interview-admin-reseller-fixtures" });
  await client.connect();
  const db = client.db(env("MONGO_DB", "power_interview_ai"));
  const adminDb = client.db(env("ADMIN_MONGO_DB", "pia_admin"));

  const accounts = adminDb.collection("admin_accounts");
  const users = db.collection("users");
  const ledger = db.collection("reseller_ledger");
  const settlements = db.collection("reseller_settlements");
  const auditLogs = db.collection("audit_logs");

  // ---- Remove a previous run's fixtures, and nothing else ----
  const fixtureEmail = { $regex: `@${FIXTURE_DOMAIN.replace(".", "\\.")}$` };
  const previous = await accounts.find({ email: fixtureEmail }, { projection: { _id: 1 } }).toArray();
  const previousIds = previous.map((doc) => doc._id);
  await Promise.all([
    accounts.deleteMany({ _id: { $in: previousIds } }),
    users.deleteMany({ $or: [{ reseller_id: { $in: previousIds } }, { email: fixtureEmail }] }),
    ledger.deleteMany({ reseller_id: { $in: previousIds } }),
    settlements.deleteMany({ reseller_id: { $in: previousIds } }),
    auditLogs.deleteMany({
      "metadata.source": "reseller",
      "metadata.reseller_id": { $in: previousIds.map(String) },
    }),
  ]);
  if (previousIds.length > 0) console.log(`removed ${previousIds.length} fixture account(s) from a previous run`);

  const bootstrap = await accounts.findOne({ is_bootstrap: true }, { projection: { email: 1 } });
  const paidBy = bootstrap?.email ?? `admin@${FIXTURE_DOMAIN}`;

  const accountHash = await bcrypt.hash(FIXTURE_PASSWORD, 12);
  const customerHash = await bcrypt.hash(CUSTOMER_PASSWORD, 12);

  // ---- A guest, to see what a read-only staff account gets ----
  await accounts.insertOne({
    email: `guest@${FIXTURE_DOMAIN}`,
    name: "Gina Guest",
    role: "guest",
    status: "approved",
    is_bootstrap: false,
    password_hash: accountHash,
    last_login_at: null,
    created_at: NOW - 30 * DAY,
    updated_at: null,
  });

  const printedKeys = [];
  const totals = { customers: 0, sales: 0, settlements: 0 };

  for (const spec of RESELLERS) {
    const key = spec.withKey ? issueKey() : null;
    const { insertedId: resellerId } = await accounts.insertOne({
      email: `${spec.slug}@${FIXTURE_DOMAIN}`,
      name: spec.name,
      role: "reseller",
      status: spec.status,
      is_bootstrap: false,
      password_hash: accountHash,
      last_login_at: null,
      credit_rate_cents_per_hour: spec.rate,
      ...(key ? key.fields : {}),
      created_at: NOW - (spec.fromDaysAgo + 5) * DAY,
      updated_at: null,
    });
    if (key) printedKeys.push([spec, key.key]);

    const rateAt = (at) =>
      spec.rate !== null && at >= NOW - spec.rateSinceDaysAgo * DAY ? spec.rate : null;
    const windowStart = NOW - spec.fromDaysAgo * DAY;
    const windowEnd = NOW - spec.toDaysAgo * DAY - 10 * MINUTE;

    const userDocs = [];
    const saleDocs = [];
    const auditDocs = [];
    let order = 1000;

    for (let i = 0; i < spec.customers; i += 1) {
      const first = pick(FIRST);
      const last = pick(LAST);
      const email = `${first}.${last}.${i + 1}@${spec.slug}-customers.${FIXTURE_DOMAIN}`;
      const createdAt = int(windowStart, windowEnd - 2 * DAY);
      const currency = pick(spec.currencies);

      const sales = [];
      const opening = pick([600, 600, 1200, 3000, 0]);
      sales.push({ kind: "user_created", at: createdAt, credits: opening });
      for (let t = 0, n = int(0, 3); t < n; t += 1) {
        sales.push({ kind: "credits_granted", at: int(createdAt + HOUR, windowEnd), credits: pick([600, 1200, 3000]) });
      }
      sales.sort((a, b) => a.at - b.at);

      const granted = sales.reduce((sum, sale) => sum + sale.credits, 0);
      const userId = new ObjectId();
      userDocs.push({
        _id: userId,
        username: `${first[0].toUpperCase()}${first.slice(1)} ${last[0].toUpperCase()}${last.slice(1)}`,
        email,
        password_hash: customerHash,
        role: "user",
        status: chance(0.9) ? "active" : "inactive",
        // Customers have used some of what they were sold; the ledger is what billing reads.
        credits: Math.max(0, granted - int(0, Math.floor(granted * 0.6))),
        interview_config: null,
        onboarding_completed: chance(0.7),
        reseller_id: resellerId,
        created_at: createdAt,
        updated_at: sales.at(-1).at,
      });

      for (const sale of sales) {
        const reference = `${spec.slug}-ord-${(order += int(1, 7))}`;
        const price = PRICES[sale.credits];
        const rate = rateAt(sale.at);
        saleDocs.push({
          reseller_id: resellerId,
          user_id: userId,
          customer_email: email,
          kind: sale.kind,
          credits: sale.credits,
          rate_cents_per_hour: rate,
          reference,
          ...(price !== null
            ? { price_amount: currency === "EUR" ? Math.round(price * 92) / 100 : price, price_currency: currency }
            : {}),
          ...(chance(0.2) ? { note: pick(NOTES) } : {}),
          state: "committed",
          created_at: sale.at - 300,
          committed_at: sale.at,
        });
        auditDocs.push({
          event_type: sale.kind === "user_created" ? "signup" : "credits_applied",
          user_id: userId,
          email,
          status: "success",
          ip_address: `203.0.113.${int(2, 250)}`,
          user_agent: `${spec.name} integration/1.0`,
          metadata: {
            ...(sale.kind === "user_created" ? { email } : { order_id: reference }),
            credits_amount: sale.credits,
            source: "reseller",
            reseller_id: String(resellerId),
          },
          created_at: sale.at,
          updated_at: null,
        });
      }
    }

    // One request still in flight: it must not appear on any page or in any total.
    if (spec.slug === "acme" && userDocs.length > 0) {
      saleDocs.push({
        reseller_id: resellerId,
        user_id: userDocs[0]._id,
        customer_email: userDocs[0].email,
        kind: "credits_granted",
        credits: 99_999,
        reference: "acme-ord-IN-FLIGHT",
        state: "pending",
        created_at: NOW - 2 * MINUTE,
      });
    }

    if (userDocs.length > 0) await users.insertMany(userDocs);
    if (saleDocs.length > 0) await ledger.insertMany(saleDocs);
    if (auditDocs.length > 0) await auditLogs.insertMany(auditDocs);

    // ---- Settlements, the way backend's worker computes them ----
    const lastComplete = Math.floor((NOW - SETTLEMENT_GRACE) / DAY) * DAY; // exclusive end
    const byDay = new Map();
    for (const sale of saleDocs) {
      if (sale.state !== "committed" || sale.committed_at >= lastComplete) continue;
      const day = utcDay(sale.committed_at);
      const row = byDay.get(day) ?? { credits: 0, users: 0, priced: 0, unpriced: 0 };
      row.credits += sale.credits;
      if (sale.kind === "user_created") row.users += 1;
      if (sale.rate_cents_per_hour === null) row.unpriced += sale.credits;
      else row.priced += sale.credits * sale.rate_cents_per_hour;
      byDay.set(day, row);
    }
    const settlementDocs = [...byDay.entries()].map(([day, row]) => {
      const dayEnd = Date.parse(`${day}T00:00:00Z`) + DAY;
      const paid =
        spec.paidOlderThanDays !== null && dayEnd <= NOW - spec.paidOlderThanDays * DAY;
      return {
        reseller_id: resellerId,
        day,
        credits: row.credits,
        users_created: row.users,
        amount_owed_cents:
          row.unpriced > 0 ? null : Math.floor((row.priced + CREDITS_PER_HOUR / 2) / CREDITS_PER_HOUR),
        unpriced_credits: row.unpriced,
        status: paid ? "paid" : "open",
        paid_at: paid ? Math.min(dayEnd + 2 * DAY, NOW) : null,
        paid_by: paid ? paidBy : null,
        created_at: dayEnd + SETTLEMENT_GRACE,
      };
    });
    if (settlementDocs.length > 0) await settlements.insertMany(settlementDocs);

    totals.customers += userDocs.length;
    totals.sales += saleDocs.filter((sale) => sale.state === "committed").length;
    totals.settlements += settlementDocs.length;
    console.log(
      `${spec.name.padEnd(22)} ${spec.status.padEnd(9)} customers ${String(userDocs.length).padStart(2)}  ` +
        `sales ${String(saleDocs.length).padStart(3)}  settled days ${settlementDocs.length}`,
    );
  }

  console.log(
    `\n${totals.customers} customers, ${totals.sales} committed sales, ${totals.settlements} settlement days` +
      ` in ${db.databaseName} / ${adminDb.databaseName}`,
  );
  console.log(`\nSign-ins (password for all: ${FIXTURE_PASSWORD})`);
  console.log(`  your admin account     everything, incl. /resellers`);
  console.log(`  guest@${FIXTURE_DOMAIN}  read-only staff: no Resellers, no Access`);
  for (const spec of RESELLERS) {
    console.log(`  ${`${spec.slug}@${FIXTURE_DOMAIN}`.padEnd(29)} reseller portal (${spec.status})`);
  }
  console.log(`\nCustomers sign in to the desktop app with password ${CUSTOMER_PASSWORD}.`);
  console.log("\nAPI keys (shown once; only their digests were stored):");
  for (const [spec, key] of printedKeys) {
    console.log(`  ${spec.name.padEnd(22)} ${key}${spec.status === "approved" ? "" : "   (account rejected: 401)"}`);
  }

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
