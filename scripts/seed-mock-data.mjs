/**
 * Fills the local MongoDB with realistic mock data for the admin dashboard.
 *
 * Everything here mirrors what backend actually writes: unix-ms `created_at`/`updated_at`
 * integers, ObjectId `user_id` references, the audit metadata keys from
 * `app/models/audit_log.py`, and the credit plans from `app/cfg/payment.py`. Credit balances are
 * walked forward per user through their own timeline (trial grant, ASR consumption, purchases),
 * so a user's `credits` agrees with their own audit trail rather than being an unrelated number:
 * every credit spent is on an `asr_stop` row's `credits_amount`.
 *
 * Run with: node scripts/seed-mock-data.mjs
 *
 * Destructive: replaces `users` (except admin accounts that already exist), `payments`,
 * `sessions`, `audit_logs` and `email_campaigns`. Never touches `global_state`, and refuses to
 * run against anything but a local MONGO_URL.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

const TARGET_USERS = 217;
const TARGET_REVENUE_USD = 13_400; // the ask is 13k+; overshoot so nothing can dip under it
const NOW = Date.now();

/** Nothing in the database predates this: the product's history starts in January 2026. */
const START = new Date(new Date().getFullYear(), 0, 1, 0, 0, 0, 0).getTime();

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Deterministic randomness - a re-run reproduces the same database
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260906);

const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;

/** Picks a key from `{ key: weight }`. */
function weighted(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rand() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

function sample(list, count) {
  const copy = [...list];
  const out = [];
  for (let i = 0; i < count && copy.length > 0; i += 1) {
    out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  }
  return out;
}

function hex(length) {
  let out = "";
  while (out.length < length) out += "0123456789abcdef"[int(0, 15)];
  return out;
}

function digits(length) {
  let out = String(int(1, 9));
  while (out.length < length) out += String(int(0, 9));
  return out;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BECH32 = "023456789acdefghjklmnpqrstuvwxyz";

function fromAlphabet(alphabet, length) {
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(rand() * alphabet.length)];
  return out;
}

/** UUIDv7, the shape `UuidUtil.make_uuid_str()` produces for order ids. */
function uuid7(ms) {
  const bytes = new Uint8Array(16);
  const time = BigInt(Math.floor(ms));
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Number((time >> BigInt(8 * (5 - i))) & 0xffn);
  }
  for (let i = 6; i < 16; i += 1) bytes[i] = int(0, 255);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const s = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/**
 * An ObjectId whose embedded timestamp matches the document's own `created_at`, the way a real
 * insert would. Sorting by `_id` and sorting by `created_at` then agree.
 */
function objectIdAt(ms) {
  return new ObjectId(Math.floor(ms / 1000).toString(16).padStart(8, "0") + hex(16));
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/**
 * A working-hours hump with a smaller evening one, so the dashboard's by-hour chart reads as a
 * usage curve rather than a flat band.
 */
const HOUR_WEIGHTS = [
  0.2, 0.12, 0.08, 0.06, 0.06, 0.1, 0.25, 0.5, 0.9, 1.3, 1.6, 1.55, 1.35, 1.5, 1.7, 1.65, 1.4,
  1.15, 1.0, 0.95, 0.9, 0.75, 0.55, 0.35,
];

/**
 * Moving a timestamp onto a plausible hour can push it up to a day forward, which for anything
 * generated near the present would land it in the future - a signup that has not happened yet, a
 * session last used tomorrow. Overshooting the cap therefore steps back a whole day rather than
 * clamping to it, so the hour-of-day distribution survives.
 */
function atRealisticHour(ms, cap = NOW) {
  const total = HOUR_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  let roll = rand() * total;
  let hour = 0;
  for (; hour < 24; hour += 1) {
    roll -= HOUR_WEIGHTS[hour];
    if (roll <= 0) break;
  }
  const date = new Date(ms);
  date.setHours(Math.min(hour, 23), int(0, 59), int(0, 59), int(0, 999));

  let at = date.getTime();
  if (at > cap) at -= DAY;
  return at > cap ? cap - int(1, 90) * MINUTE : at;
}

/** A time in `[from, to]`, biased towards the recent end when `recency` > 0. */
function between(from, to, recency = 0) {
  if (to <= from) return from;
  let t = rand();
  if (recency > 0) t = t ** (1 / (1 + recency));
  return from + t * (to - from);
}

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  "James", "Olivia", "Liam", "Emma", "Noah", "Ava", "Ethan", "Sophia", "Mason", "Isabella",
  "Lucas", "Mia", "Henry", "Charlotte", "Alexander", "Amelia", "Daniel", "Harper", "Matthew",
  "Evelyn", "Michael", "Abigail", "Benjamin", "Ella", "Samuel", "Scarlett", "David", "Grace",
  "Joseph", "Chloe", "Andrew", "Victoria", "Ryan", "Riley", "Nathan", "Aria", "Christopher",
  "Lily", "Jonathan", "Zoe", "Adrian", "Nora", "Marcus", "Hannah", "Diego", "Layla", "Priya",
  "Aisha", "Wei", "Yuki", "Omar", "Fatima", "Ravi", "Ananya", "Chen", "Sofia", "Mateo",
  "Camila", "Andre", "Ingrid", "Lukas", "Elena", "Tomas", "Nadia", "Hassan", "Leila", "Kwame",
  "Amara", "Sung", "Jin", "Hiroshi", "Sakura", "Dmitri", "Anastasia", "Pierre", "Giulia",
  "Marco", "Alessandro", "Freya", "Magnus", "Emilia", "Oskar", "Zara", "Rohan", "Meera",
  "Arjun", "Ishaan", "Kavya", "Tobias", "Johanna", "Felix", "Nina", "Sebastian", "Clara",
  "Julian", "Maya", "Theo", "Iris", "Caleb", "Ruby", "Owen", "Naomi", "Elias", "Talia",
  "Gabriel", "Sienna", "Nolan", "Willow", "Miles", "Delphine", "Adeola", "Chidi", "Ngozi",
  "Thabo", "Lerato", "Santiago", "Valentina", "Rafael", "Bianca", "Emre", "Deniz", "Selin",
  "Karim", "Yara", "Idris", "Anika", "Vikram", "Neha", "Sanjay", "Pooja",
];

const LAST_NAMES = [
  "Whitfield", "Carter", "Nguyen", "Patel", "Okafor", "Rodriguez", "Kim", "Andersen", "Novak",
  "Silva", "Muller", "Rossi", "Fernandez", "Kowalski", "Dubois", "Tanaka", "Yilmaz", "Haddad",
  "Petrov", "Larsen", "Brennan", "Sullivan", "Osborne", "Whitaker", "Callahan", "Fitzgerald",
  "Hendricks", "Vaughn", "Ashford", "Blackwood", "Marsh", "Ellington", "Sandoval", "Reyes",
  "Delgado", "Castillo", "Moreau", "Lemaire", "Bouchard", "Schneider", "Wagner", "Hoffmann",
  "Bergmann", "Lindqvist", "Sorensen", "Virtanen", "Kaminski", "Zielinski", "Horvath", "Varga",
  "Costa", "Almeida", "Barbosa", "Ferrari", "Conti", "Bianchi", "Sharma", "Iyer", "Chatterjee",
  "Banerjee", "Kapoor", "Malhotra", "Zhang", "Huang", "Zhao", "Lim", "Tan", "Wong", "Park",
  "Choi", "Yamamoto", "Nakamura", "Ibrahim", "Farouk", "Mensah", "Adeyemi", "Mwangi", "Dlamini",
  "Bright", "Holloway", "Pemberton", "Grayson", "Radcliffe", "Thornton", "Winslow", "Barrett",
  "Donovan", "Kavanagh", "Mercer", "Ramsey", "Sinclair", "Beaumont", "Alvarez", "Guerrero",
  "Cortes", "Navarro", "Vega", "Rios", "Quintero", "Salazar", "Bauer", "Keller", "Roth",
  "Fischer", "Weber", "Becker", "Novotny", "Dvorak", "Marek", "Ivanov", "Sokolov", "Volkov",
  "Kuznetsov", "Doyle", "Gallagher", "Mahoney", "Bishop", "Chandler", "Prescott", "Sterling",
  "Lockhart", "Kensington",
];

const FREE_DOMAINS = {
  "gmail.com": 42,
  "outlook.com": 12,
  "hotmail.com": 7,
  "yahoo.com": 8,
  "icloud.com": 7,
  "proton.me": 4,
  "protonmail.com": 2,
  "live.com": 2,
  "gmx.de": 1,
  "mail.ru": 1,
};

const WORK_DOMAINS = [
  "northwind-labs.com", "brightpath.io", "cascade-analytics.com", "helios-systems.com",
  "meridian-tech.co", "quantabyte.io", "lumenworks.dev", "orbitalstack.com", "veritas-hr.com",
  "silverline-consulting.com", "atlasgrid.io", "novasearch.co", "kestrel-software.com",
  "fintrail.io", "bluepeak.digital", "arcadiadata.com",
];

const NAME_NOISE = ["", "", "", "", "", "1", "7", "23", "88", "91", "92", "95", "01", "99", "x"];

function emailFor(first, last) {
  const f = first.toLowerCase();
  const l = last.toLowerCase();
  const style = weighted({
    dotted: 34,
    first_initial: 20,
    joined: 14,
    underscore: 10,
    work: 12,
    initial_last: 10,
  });
  const noise = pick(NAME_NOISE);

  if (style === "work") {
    const domain = pick(WORK_DOMAINS);
    return `${chance(0.6) ? `${f}.${l}` : `${f[0]}${l}`}@${domain}`;
  }

  const domain = weighted(FREE_DOMAINS);
  const local =
    style === "dotted"
      ? `${f}.${l}${noise}`
      : style === "first_initial"
        ? `${f}${l[0]}${noise}`
        : style === "joined"
          ? `${f}${l}${noise}`
          : style === "underscore"
            ? `${f}_${l}${noise}`
            : `${f[0]}${l}${noise}`;
  return `${local}@${domain}`;
}

// ---------------------------------------------------------------------------
// Interview configs
// ---------------------------------------------------------------------------

const JOB_TITLES = [
  "Senior Frontend Engineer", "Backend Engineer", "Full Stack Developer", "Data Engineer",
  "Machine Learning Engineer", "Product Manager", "DevOps Engineer", "Site Reliability Engineer",
  "Engineering Manager", "QA Automation Engineer", "Mobile Engineer (iOS)", "Android Engineer",
  "Solutions Architect", "Data Analyst", "Security Engineer", "Platform Engineer",
  "Technical Program Manager", "UX Engineer", "Staff Software Engineer", "Cloud Engineer",
];

const COMPANIES = [
  "Stripe", "Datadog", "Shopify", "Atlassian", "Cloudflare", "Snowflake", "Airbnb", "Figma",
  "Databricks", "Notion", "Ramp", "Vercel", "HashiCorp", "Twilio", "Segment", "Robinhood",
  "Instacart", "DoorDash", "Coinbase", "Asana",
];

const SKILLS = [
  "TypeScript", "React", "Node.js", "Python", "Go", "Kubernetes", "PostgreSQL", "AWS",
  "Terraform", "GraphQL", "Rust", "Java", "Spring Boot", "Kafka", "Redis", "MongoDB", "Next.js",
  "Django", "Swift", "Kotlin", "Airflow", "dbt", "Spark", "Docker",
];

const SCHOOLS = [
  "University of Toronto", "TU Munich", "Delft University of Technology", "UC San Diego",
  "IIT Bombay", "University of Manchester", "KTH Stockholm", "NUS Singapore",
];

const ROUNDS = [
  "system design", "coding + behavioural", "technical deep dive", "hiring manager screen",
  "architecture review",
];

function interviewConfig(fullName) {
  const title = pick(JOB_TITLES);
  const years = int(2, 14);

  return {
    full_name: fullName,
    profile_data:
      `${fullName}\n${title} - ${years} years of experience\n\n` +
      `Currently at ${pick(COMPANIES)}, leading work on ${sample(SKILLS, 2).join(" and ")} ` +
      `services handling ${int(2, 40)}M requests per day. Spent ${int(1, 5)} years before that ` +
      `building customer-facing products in a team of ${int(4, 30)}.\n\n` +
      `Core skills: ${sample(SKILLS, int(4, 7)).join(", ")}.\n` +
      `Education: ${pick(["BSc", "MSc", "BEng"])} Computer Science, ${pick(SCHOOLS)}.`,
    context: chance(0.72)
      ? `Interviewing for ${title} at ${pick(COMPANIES)}. Round ${int(1, 4)} of ${int(3, 5)}: ` +
        `${pick(ROUNDS)}. The role focuses on ${sample(SKILLS, 2).join(" and ")}.`
      : "",
  };
}

// ---------------------------------------------------------------------------
// Devices and networks
// ---------------------------------------------------------------------------

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) power-interview-ai/1.4.2 Chrome/136.0.7103.48 Electron/36.2.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) power-interview-ai/1.4.2 Chrome/136.0.7103.48 Electron/36.2.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
];

/** Public-looking ranges from consumer ISPs and clouds; never RFC1918. */
const IP_PREFIXES = [
  "24.114", "47.208", "68.183", "70.114", "72.229", "76.104", "84.203", "86.147", "88.202",
  "91.132", "92.184", "95.90", "99.246", "104.28", "109.156", "134.209", "138.199", "141.101",
  "148.252", "151.230", "157.131", "173.63", "176.12", "178.128", "185.220", "188.166",
  "192.145", "203.0", "212.129", "213.87",
];

const makeIp = () => `${pick(IP_PREFIXES)}.${int(0, 255)}.${int(1, 254)}`;

/**
 * One person, one to three addresses: home, a phone, maybe an office. Giving everyone a single
 * fixed IP would make the audit log's distinct-IP count a restatement of the user count.
 */
function makeDevices() {
  return {
    ips: Array.from({ length: chance(0.45) ? 1 : chance(0.7) ? 2 : 3 }, makeIp),
    agents: sample(USER_AGENTS, chance(0.7) ? 1 : 2),
  };
}

/** The first entry is where a person usually is; the others show up now and then. */
function pickDevice(person) {
  return {
    ip: chance(0.72) ? person.ips[0] : pick(person.ips),
    agent: chance(0.8) ? person.agents[0] : pick(person.agents),
  };
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

const PLANS = {
  starter: { credits: 600, price: 5 },
  pro: { credits: 3000, price: 20 },
  enterprise: { credits: 30000, price: 175 },
};

const CURRENCIES = {
  btc: { weight: 26, perUsd: 1 / 108_000, address: () => `bc1q${fromAlphabet(BECH32, 38)}` },
  eth: { weight: 18, perUsd: 1 / 3_850, address: () => `0x${hex(40)}` },
  usdttrc20: { weight: 22, perUsd: 1, address: () => `T${fromAlphabet(BASE58, 33)}` },
  usdterc20: { weight: 10, perUsd: 1, address: () => `0x${hex(40)}` },
  ltc: { weight: 6, perUsd: 1 / 96, address: () => `ltc1q${fromAlphabet(BECH32, 38)}` },
  sol: { weight: 7, perUsd: 1 / 205, address: () => fromAlphabet(BASE58, 44) },
  trx: { weight: 4, perUsd: 1 / 0.31, address: () => `T${fromAlphabet(BASE58, 33)}` },
  doge: { weight: 3, perUsd: 1 / 0.23, address: () => `D${fromAlphabet(BASE58, 33)}` },
  xmr: { weight: 2, perUsd: 1 / 285, address: () => `4${fromAlphabet(BASE58, 94)}` },
  bnbbsc: { weight: 2, perUsd: 1 / 920, address: () => `0x${hex(40)}` },
};

const CURRENCY_WEIGHTS = Object.fromEntries(
  Object.entries(CURRENCIES).map(([code, info]) => [code, info.weight]),
);

/** Crypto amounts carry a lot of decimals, and a little drift between quote and settle. */
function payAmountFor(currency, priceUsd) {
  const raw = priceUsd * CURRENCIES[currency].perUsd * (1 + (rand() - 0.5) * 0.04);
  const decimals = raw < 0.01 ? 8 : raw < 10 ? 6 : 4;
  return Number(raw.toFixed(decimals));
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function loadEnv() {
  const text = readFileSync(join(ROOT, ".env.local"), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

// ---------------------------------------------------------------------------
// Signup curve
// ---------------------------------------------------------------------------

/**
 * Signups per calendar month from `START` to today, oldest first: a product that grew rather than
 * one that appeared whole. The share is a weight, not a count - it is scaled to whatever
 * `TARGET_USERS` asks for, and the current month is prorated by how much of it has happened.
 */
const MONTHLY_GROWTH = [10, 13, 16, 19, 23, 27, 31, 36, 42, 48, 55, 63];

function monthWindows() {
  const windows = [];
  const cursor = new Date(START);

  while (cursor.getTime() < NOW) {
    const from = cursor.getTime();
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + 1);
    const to = Math.min(next.getTime(), NOW - HOUR);
    const full = (next.getTime() - from) / DAY;
    const elapsed = (to - from) / DAY;

    windows.push({ from, to, share: MONTHLY_GROWTH[windows.length] * (elapsed / full) });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return windows;
}

function signupTimes(count) {
  const windows = monthWindows();
  const scale = count / windows.reduce((sum, window) => sum + window.share, 0);
  const times = [];

  for (const window of windows) {
    for (let i = 0; i < Math.round(window.share * scale); i += 1) {
      times.push(atRealisticHour(between(window.from, window.to), window.to));
    }
  }

  // Rounding leaves the count a little short or long; top up inside the newest month.
  const newest = windows[windows.length - 1];
  while (times.length < count) {
    times.push(atRealisticHour(between(newest.from, newest.to, 0.6), newest.to));
  }
  times.length = count;
  return times.sort((a, b) => a - b);
}

const ENGAGEMENT = { churned: 30, casual: 34, regular: 26, power: 10 };
const LOGIN_RANGE = { churned: [1, 3], casual: [4, 10], regular: [10, 25], power: [25, 55] };

const LOGIN_FAILURE_REASONS = [
  "Invalid password",
  "Invalid password",
  "User not found",
  "Account is inactive",
];

const PAYMENT_FAILURE_REASONS = [
  "Payment expired before confirmation",
  "Underpaid and not topped up",
  "Provider reported failure",
];

const PAYMENT_ERRORS = [
  "Timeout waiting for NOWPayments status",
  "aiohttp.ClientResponseError: 504 Gateway Timeout",
  "Webhook signature mismatch",
];

/**
 * The two colleagues this script creates. They are named rather than promoted at random so a
 * second run can tell its own admins from the account the dashboard actually logs in with, and
 * replace them instead of accumulating one more admin every time.
 */
const SEEDED_ADMINS = [
  { username: "Priya Raghunathan", email: "priya@vectorleappulse.xyz" },
  { username: "Tom Beckett", email: "tom@vectorleappulse.xyz" },
];

const SMTP_ERRORS = [
  "550 5.1.1 Recipient address rejected: User unknown",
  "Connection timed out after 30000ms",
  "421 4.7.0 Too many messages, slow down",
];

// ---------------------------------------------------------------------------

async function main() {
  const env = loadEnv();
  const uri = env.MONGO_URL || process.env.MONGO_URL;
  const dbName = env.MONGO_DB || process.env.MONGO_DB || "power_interview_ai";
  if (!uri) throw new Error("MONGO_URL is not set in .env.local");
  if (!/localhost|127\.0\.0\.1/.test(uri)) {
    throw new Error(`Refusing to seed a database that is not local: ${uri}`);
  }

  const client = new MongoClient(uri, { appName: "power-interview-admin-seed" });
  await client.connect();
  const db = client.db(dbName);

  const users = db.collection("users");
  const payments = db.collection("payments");
  const sessions = db.collection("sessions");
  const auditLogs = db.collection("audit_logs");
  const campaigns = db.collection("email_campaigns");

  // Keep the admin accounts that already exist - one of them is how the dashboard logs in - but
  // not the ones a previous run of this script created.
  const seededAdminEmails = SEEDED_ADMINS.map((admin) => admin.email);
  const keptAdmins = await users
    .find({ role: "admin", email: { $nin: seededAdminEmails } })
    .toArray();
  await users.deleteMany({ _id: { $nin: keptAdmins.map((doc) => doc._id) } });
  await Promise.all([
    payments.deleteMany({}),
    sessions.deleteMany({}),
    auditLogs.deleteMany({}),
    campaigns.deleteMany({}),
  ]);
  console.log(`kept ${keptAdmins.length} existing admin account(s)`);

  const passwordHash = await bcrypt.hash("Interview!2026", 12);

  // -- people --------------------------------------------------------------

  const toCreate = TARGET_USERS - keptAdmins.length;
  const times = signupTimes(toCreate);
  const takenEmails = new Set(keptAdmins.map((doc) => doc.email));
  const people = [];

  for (let i = 0; i < toCreate; i += 1) {
    let first;
    let last;
    let email;
    do {
      first = pick(FIRST_NAMES);
      last = pick(LAST_NAMES);
      email = emailFor(first, last);
    } while (takenEmails.has(email));
    takenEmails.add(email);

    const createdAt = times[i];
    const ageDays = (NOW - createdAt) / DAY;
    const engagement = weighted(ENGAGEMENT);

    people.push({
      _id: objectIdAt(createdAt),
      username: `${first} ${last}`,
      email,
      createdAt,
      ageDays,
      engagement,
      ...makeDevices(),
      // An account that stopped coming back long ago is the one most likely to be deactivated.
      status: chance(engagement === "churned" ? (ageDays > 120 ? 0.42 : 0.7) : 0.94)
        ? "active"
        : "inactive",
      credits: 0,
      events: [],
      purchases: [],
      logins: [],
    });
  }

  // -- audit helpers -------------------------------------------------------

  const auditDocs = [];
  const paymentDocs = [];

  /**
   * Three shapes, matching how `AuditLogService.log_event` fills a document:
   *
   * - `device`   a request that also carried device info, so `metadata.device_info` repeats it
   * - `request`  a request with no device info attached (payment endpoints, webhooks)
   * - `server`   no request at all - ASR runs off a websocket, credits are applied in a task
   *
   * The device is chosen once per event so a row's `ip_address` and its `metadata.device_info`
   * can never disagree.
   */
  const pushAudit = (person, eventType, ms, status, metadata = null, mode = "device") => {
    const device = mode === "server" ? null : pickDevice(person);
    const meta =
      mode === "device"
        ? { ...(metadata ?? {}), device_info: { ip_address: device.ip, user_agent: device.agent } }
        : metadata;

    auditDocs.push({
      _id: objectIdAt(ms),
      created_at: Math.round(ms),
      updated_at: null,
      event_type: eventType,
      user_id: person._id,
      email: person.email,
      status,
      ip_address: device ? device.ip : null,
      user_agent: device ? device.agent : null,
      metadata: meta,
    });
  };

  // -- build each person's timeline ---------------------------------------

  for (const person of people) {
    const { events } = person;
    events.push({ at: person.createdAt, kind: "signup" });

    if (chance(0.88)) {
      const requested = person.createdAt + int(5, 90) * 1000;
      events.push({ at: requested, kind: "verify_requested" });
      if (chance(0.93)) {
        events.push({ at: requested + int(30, 900) * 1000, kind: "verify_confirmed" });
      }
    }

    const [minLogins, maxLogins] = LOGIN_RANGE[person.engagement];
    const loginCount = Math.max(
      1,
      Math.round(int(minLogins, maxLogins) * Math.min(1, person.ageDays / 30 + 0.35)),
    );

    // Churned accounts crowd their few logins right after signup; the rest lean recent for as
    // long as they are still around.
    const lastSeen =
      person.engagement === "churned"
        ? person.createdAt + Math.min(person.ageDays, int(1, 21)) * DAY
        : person.status === "inactive"
          ? person.createdAt + (NOW - person.createdAt) * (0.3 + rand() * 0.5)
          : NOW - int(0, person.engagement === "power" ? 2 : person.engagement === "regular" ? 5 : 14) * DAY;

    person.lastSeen = lastSeen;
    const span = (recency) =>
      atRealisticHour(
        between(person.createdAt + MINUTE, Math.max(person.createdAt + MINUTE, lastSeen), recency),
      );

    for (let i = 0; i < loginCount; i += 1) {
      const at = span(0.6);
      events.push({ at, kind: "login" });
      person.logins.push(at);
    }

    for (let i = 0, n = chance(0.45) ? int(1, person.engagement === "power" ? 4 : 2) : 0; i < n; i += 1) {
      events.push({ at: span(0.5), kind: "login_failure" });
    }

    if (chance(0.3)) events.push({ at: span(0.2), kind: "profile_update" });
    if (chance(0.16)) events.push({ at: span(0.2), kind: "password_change" });
    if (chance(0.28)) events.push({ at: span(0.4), kind: "session_expire" });

    if (chance(0.12)) {
      const requested = span(0.2);
      events.push({ at: requested, kind: "reset_requested" });
      if (chance(0.8)) {
        events.push({ at: requested + int(60, 600) * 1000, kind: "reset_verified" });
        events.push({ at: requested + int(700, 1500) * 1000, kind: "reset_completed" });
      }
    }
  }

  // -- who pays, and how much ---------------------------------------------

  // Conversion leans on accounts that stuck around long enough to burn their trial credits,
  // which is how a credits product actually sells.
  const buyerPool = people.filter(
    (person) =>
      person.ageDays > 3 &&
      person.engagement !== "churned" &&
      (person.status === "active" || chance(0.35)),
  );

  let revenue = 0;
  for (let pass = 0; revenue < TARGET_REVENUE_USD && pass < 8; pass += 1) {
    for (const person of buyerPool) {
      if (revenue >= TARGET_REVENUE_USD) break;
      // Every pass is another repeat purchase, so the heaviest users buy the most often.
      if (pass > 0 && !chance(person.engagement === "power" ? 0.7 : 0.35)) continue;

      const plan = weighted({ starter: 45, pro: 40, enterprise: 15 });
      const at = atRealisticHour(
        between(
          person.createdAt + int(1, 10) * DAY,
          Math.max(person.createdAt + 2 * DAY, person.lastSeen),
          0.15,
        ),
      );
      if (at > NOW) continue;

      person.purchases.push({ plan, at, outcome: "finished" });
      revenue += PLANS[plan].price;
    }
  }

  // Checkouts that never landed. Crypto checkout abandons a lot - a rate anywhere near 100% is
  // the tell-tale of seeded data - so most buyers carry at least one of these.
  for (const person of buyerPool) {
    const tries = int(0, 2) + (chance(0.5) ? 1 : 0);

    for (let attempt = 0; attempt < tries; attempt += 1) {
      // The four transitional states are deliberately rare: a payment only sits in one of them
      // for minutes to hours, so at any given moment a handful is all a real database holds.
      const outcome = weighted({
        expired: 46, failed: 16, partially_paid: 8, refunded: 4,
        waiting: 1.5, confirming: 0.8, pending: 0.9, sending: 0.3,
      });

      // Only a checkout opened in the last few days can still be waiting on the chain; an older
      // one that never confirmed has long since expired.
      const live = ["pending", "waiting", "confirming", "sending"].includes(outcome);
      const at = live
        ? atRealisticHour(between(NOW - 3 * DAY, NOW - 20 * MINUTE))
        : atRealisticHour(
            between(
              person.createdAt + DAY,
              Math.max(person.createdAt + 2 * DAY, person.lastSeen),
              0.3,
            ),
          );
      if (at > NOW) continue;

      person.purchases.push({
        plan: weighted({ starter: 50, pro: 36, enterprise: 14 }),
        at,
        outcome,
      });
    }
  }

  // -- walk the timelines, carrying the credit balance forward -------------

  const TRIAL_CREDITS = 600;
  const CREDITS_PER_MINUTE = 10;
  let unappliedBudget = 4; // finished payments whose credits were never granted: real support work

  for (const person of people) {
    for (const purchase of person.purchases) {
      person.events.push({ at: purchase.at, kind: "payment", purchase });
    }

    // Credits only leave an account through ASR, so this is what keeps the outstanding balance
    // from ballooning into a liability no real product would carry: a paid-up account works
    // through most of what it bought.
    const asrCount =
      person.engagement === "power"
        ? int(40, 130)
        : person.engagement === "regular"
          ? int(14, 55)
          : person.engagement === "casual"
            ? int(3, 20)
            : int(0, 3);

    // Interviews happen in a session that started with a login, not at random hours.
    for (let i = 0; i < asrCount; i += 1) {
      const near = person.logins.length > 0 ? pick(person.logins) : person.createdAt;
      person.events.push({ at: near + int(1, 40) * MINUTE, kind: "asr" });
    }

    person.events.sort((a, b) => a.at - b.at);

    let balance = 0;
    let everPaid = false;

    for (const event of person.events) {
      const at = Math.round(event.at);
      if (at > NOW) continue;

      switch (event.kind) {
        case "signup":
          pushAudit(person, "signup", at, "success", { email: person.email });
          balance += TRIAL_CREDITS;
          break;

        case "verify_requested":
          pushAudit(person, "email_verification_requested", at, "success", {
            email: person.email,
          });
          break;

        case "verify_confirmed":
          pushAudit(person, "email_verification_confirmed", at, "success", {
            email: person.email,
          });
          break;

        case "login":
          pushAudit(person, "login", at, "success");
          if (chance(0.55)) {
            const out = at + int(4, 190) * MINUTE;
            if (out <= NOW) pushAudit(person, "logout", out, "success");
          }
          break;

        case "login_failure": {
          // Backend records a failed login with no user id: nobody was authenticated.
          const attempt = pickDevice(person);
          auditDocs.push({
            _id: objectIdAt(at),
            created_at: at,
            updated_at: null,
            event_type: "login",
            user_id: null,
            email: null,
            status: "failure",
            ip_address: attempt.ip,
            user_agent: attempt.agent,
            metadata: {
              email: person.email,
              reason: pick(LOGIN_FAILURE_REASONS),
              device_info: { ip_address: attempt.ip, user_agent: attempt.agent },
            },
          });
          break;
        }

        case "profile_update":
          pushAudit(person, "profile_update", at, "success");
          break;

        case "password_change":
          pushAudit(person, "password_change", at, "success");
          break;

        case "session_expire":
          pushAudit(person, "session_expire", at, "success");
          break;

        case "reset_requested":
          pushAudit(person, "password_reset_requested", at, "success", {
            email: person.email,
          });
          break;

        case "reset_verified":
          pushAudit(person, "password_reset_code_verified", at, "success", {
            email: person.email,
          });
          break;

        case "reset_completed":
          pushAudit(person, "password_reset_completed", at, "success", {
            email: person.email,
          });
          break;

        case "asr": {
          if (balance <= 0) break;
          // Live and mock are both billed by the minute on the ASR socket. A live session holds
          // two sockets (loopback and microphone), each billing half; a mock holds one. Each socket
          // writes its own start/stop pair, grouped by the client's id for the whole interview, and
          // the stop carries what that socket charged - the same rows backend's ASRService writes.
          const mock = chance(0.35);
          const minutes = mock ? int(6, 32) : int(8, 62);
          const spend = Math.min(balance, minutes * CREDITS_PER_MINUTE);
          const stoppedAt = at + Math.round((spend / CREDITS_PER_MINUTE) * MINUTE) + int(2, 40) * 1000;
          if (stoppedAt > NOW) break;

          const clientSessionId = uuid7(at);
          const sockets = mock ? 1 : 2;
          for (let socket = 0; socket < sockets; socket++) {
            const charged = socket === 0 ? Math.ceil(spend / sockets) : Math.floor(spend / sockets);
            const ids = {
              asr_session_id: uuid7(at + socket + 1),
              client_session_id: clientSessionId,
              kind: mock ? "mock" : "live",
            };
            // ASR events come off a websocket, not a request, so they carry no user agent.
            pushAudit(person, "asr_start", at + socket, "success", ids, "server");
            pushAudit(
              person,
              "asr_stop",
              stoppedAt + socket,
              "success",
              charged > 0
                ? {
                    ...ids,
                    reason_code: mock ? "mock_minutes" : "live_minutes",
                    credits_amount: charged,
                  }
                : ids,
              "server",
            );
          }
          balance -= spend;
          break;
        }

        case "payment": {
          const { plan, outcome } = event.purchase;
          const info = PLANS[plan];
          const currency = weighted(CURRENCY_WEIGHTS);
          const orderId = uuid7(at);
          const providerId = digits(10);
          const payAmount = payAmountFor(currency, info.price);
          const settledAt = Math.min(NOW, at + int(3, 180) * MINUTE);

          const doc = {
            _id: objectIdAt(at),
            created_at: at,
            // `pending` is the row as first inserted, before NOWPayments answered. Everything
            // else has been written since - and the dashboard buckets revenue by `updated_at`.
            updated_at: outcome === "pending" ? null : settledAt,
            user_id: person._id,
            plan,
            payment_id: outcome === "pending" ? null : providerId,
            order_id: orderId,
            status: outcome,
            pay_address: outcome === "pending" ? null : CURRENCIES[currency].address(),
            pay_amount: outcome === "pending" ? null : payAmount,
            pay_currency: currency,
            price_amount: info.price,
            credits_amount: info.credits,
            credits_applied: false,
            purchase_id: null,
            root_payment_id: null,
          };

          pushAudit(person, "payment_created", at, "success", {
            payment_id: providerId,
            order_id: orderId,
            plan,
            price_amount: info.price,
            pay_currency: currency,
          }, "request");

          if (outcome === "finished") {
            const applied = !(unappliedBudget > 0 && chance(0.015));
            if (!applied) unappliedBudget -= 1;
            doc.credits_applied = applied;

            pushAudit(person, "payment_webhook_received", Math.max(at, settledAt - int(1, 6) * MINUTE), "success", {
              payment_id: providerId,
              order_id: orderId,
              payment_status: "confirming",
              signature_verified: true,
            }, "request");
            pushAudit(person, "payment_webhook_received", settledAt, "success", {
              payment_id: providerId,
              order_id: orderId,
              payment_status: "finished",
              signature_verified: true,
            }, "request");
            pushAudit(
              person,
              "payment_completed",
              Math.min(NOW, settledAt + 1_200),
              "success",
              {
                payment_id: providerId,
                order_id: orderId,
                plan,
                credits_amount: info.credits,
                actually_paid: Number((payAmount * (1 + (rand() - 0.4) * 0.002)).toFixed(8)),
              },
              "server",
            );

            if (applied) {
              balance += info.credits;
              everPaid = true;
              pushAudit(
                person,
                "credits_applied",
                Math.min(NOW, settledAt + 2_400),
                "success",
                {
                  payment_id: providerId,
                  order_id: orderId,
                  credits_amount: info.credits,
                  new_balance: balance,
                },
                "server",
              );
            }
          } else if (outcome === "partially_paid") {
            const paid = Number((payAmount * (0.35 + rand() * 0.5)).toFixed(8));
            doc.purchase_id = digits(9);

            pushAudit(person, "payment_webhook_received", settledAt, "success", {
              payment_id: providerId,
              order_id: orderId,
              payment_status: "partially_paid",
              signature_verified: true,
            }, "request");
            pushAudit(
              person,
              "payment_partially_paid",
              Math.min(NOW, settledAt + 900),
              "failure",
              {
                payment_id: providerId,
                order_id: orderId,
                pay_amount: payAmount,
                pay_currency: currency,
                actually_paid: paid,
              },
              "server",
            );

            // The follow-up leg backend opens for the remaining balance.
            const followUpAt = settledAt + int(5, 45) * MINUTE;
            if (followUpAt < NOW) {
              paymentDocs.push({
                _id: objectIdAt(followUpAt),
                created_at: followUpAt,
                updated_at: Math.min(NOW, followUpAt + int(10, 120) * MINUTE),
                user_id: person._id,
                plan,
                payment_id: digits(10),
                order_id: uuid7(followUpAt),
                // A follow-up leg only sits in `waiting` while it is fresh; an old one that
                // was never topped up expired like any other unpaid invoice.
                status: followUpAt > NOW - 3 * DAY && chance(0.5) ? "waiting" : "expired",
                pay_address: CURRENCIES[currency].address(),
                pay_amount: Number((payAmount - paid).toFixed(8)),
                pay_currency: currency,
                price_amount: Number((info.price * (1 - paid / payAmount)).toFixed(2)),
                credits_amount: info.credits,
                credits_applied: false,
                purchase_id: doc.purchase_id,
                root_payment_id: doc._id,
              });
            }
          } else if (outcome === "failed" || outcome === "refunded") {
            pushAudit(person, "payment_webhook_received", settledAt, "success", {
              payment_id: providerId,
              order_id: orderId,
              payment_status: outcome,
              signature_verified: true,
            }, "request");
            pushAudit(
              person,
              "payment_failed",
              Math.min(NOW, settledAt + 600),
              "failure",
              {
                payment_id: providerId,
                order_id: orderId,
                payment_status: outcome,
                reason:
                  outcome === "refunded"
                    ? "Refunded by provider"
                    : pick(PAYMENT_FAILURE_REASONS),
              },
              "server",
            );
          } else if (outcome === "expired" && chance(0.2)) {
            pushAudit(
              person,
              "payment_error",
              settledAt,
              "failure",
              {
                payment_id: providerId,
                order_id: orderId,
                payment_status: "expired",
                error: pick(PAYMENT_ERRORS),
              },
              "server",
            );
          }

          paymentDocs.push(doc);
          break;
        }
      }
    }

    // Credits tick down two at a time (`CREDIT_REDUCE_PER_INTERVAL`), so a balance is even.
    person.credits = Math.max(0, Math.round(balance / 2) * 2);
    person.everPaid = everPaid;
  }

  // -- user documents ------------------------------------------------------

  const userDocs = people.map((person) => {
    const configured = chance(person.everPaid ? 0.93 : 0.5);
    // Buying promotes a trial account to a full one (`promote_trial_to_user`), so a payer is
    // never a trial user.
    const role = person.everPaid
      ? "user"
      : chance(person.ageDays < 45 ? 0.62 : 0.4)
        ? "trial_user"
        : "user";

    // `updated_at` stays null until something actually changed the document, which for an
    // account that signed up and never came back is nothing.
    const touched = person.logins.length > 1 || person.everPaid || configured;

    return {
      _id: person._id,
      created_at: person.createdAt,
      updated_at: touched ? Math.round(Math.min(NOW, person.lastSeen + int(0, 6) * HOUR)) : null,
      username: person.username,
      email: person.email,
      password_hash: passwordHash,
      role,
      status: person.status,
      credits: person.credits,
      interview_config: configured ? interviewConfig(person.username) : null,
    };
  });

  // Two colleagues on the team besides the dashboard's own login. They are ordinary accounts
  // with a history like everyone else's, given the team's identity and role at the end.
  const staff = sample(
    userDocs.filter((doc) => doc.status === "active" && doc.interview_config !== null),
    SEEDED_ADMINS.length,
  );
  for (const [index, doc] of staff.entries()) {
    Object.assign(doc, SEEDED_ADMINS[index], {
      role: "admin",
      credits: Math.max(doc.credits, 3000),
      interview_config: null,
    });
  }

  // -- sessions ------------------------------------------------------------

  const sessionDocs = [];
  for (const person of people) {
    if (person.logins.length === 0) continue;
    const recent = [...person.logins].sort((a, b) => b - a).slice(0, int(1, 3));

    for (const [index, loginAt] of recent.entries()) {
      // Only the newest session of an account still in use keeps getting refreshed; the older
      // ones sit at the login that created them, which is what makes them read as idle or stale.
      const seen = pickDevice(person);
      const refreshed = index === 0 && person.status === "active" && chance(0.85);
      const lastUse = refreshed
        ? Math.min(
            NOW - int(5, 240) * MINUTE,
            Math.max(loginAt, person.lastSeen + int(0, 10) * HOUR),
          )
        : null;

      sessionDocs.push({
        _id: objectIdAt(loginAt),
        created_at: Math.round(loginAt),
        updated_at: lastUse && lastUse > loginAt ? Math.round(lastUse) : null,
        token: `${hex(32)}.${hex(64)}`,
        user_id: person._id,
        device_info: { ip_address: seen.ip, user_agent: seen.agent },
      });
    }
  }

  // -- email campaigns -----------------------------------------------------

  const FROM_EMAIL = "noreply@vectorleappulse.xyz";
  const FROM_NAME = "Power Interview AI Team";
  const greeting = (username) => username.charAt(0).toUpperCase() + username.slice(1).toLowerCase();

  const CAMPAIGN_SPECS = [
    {
      subject: "Welcome to Power Interview AI",
      template: "info",
      audience: "selected",
      daysAgo: 96,
      status: "completed",
      body: "<p>Thanks for signing up. Here is how to get your first interview session running in under five minutes.</p>",
    },
    {
      subject: "New: live follow-up questions in coding rounds",
      template: "success",
      audience: "all",
      daysAgo: 61,
      status: "completed",
      body: "<p>Your assistant now follows the interviewer through a coding round, so the suggestions track the conversation instead of the original prompt.</p>",
    },
    {
      subject: "Scheduled maintenance this Saturday",
      template: "warning",
      audience: "all",
      daysAgo: 34,
      status: "completed",
      body: "<p>We are moving the speech service to new hardware on Saturday between 02:00 and 04:00 UTC. Sessions started inside that window may drop once.</p>",
    },
    {
      subject: "Your credits are running low",
      template: "warning",
      audience: "selected",
      daysAgo: 12,
      status: "completed",
      body: "<p>You have fewer than 200 credits left, which is about twenty minutes of interview time.</p>",
    },
    {
      subject: "Payment provider outage - what happened",
      template: "error",
      audience: "selected",
      daysAgo: 5,
      status: "failed",
      body: "<p>Our payment provider dropped webhooks for roughly three hours on Tuesday. Every affected order has been credited by hand.</p>",
    },
    {
      subject: "September product update",
      template: "info",
      audience: "all",
      daysAgo: 0,
      status: "sending",
      body: "<p>Three things shipped this month, and one of them is a rewrite of the transcript panel.</p>",
    },
  ];

  const activeUsers = userDocs.filter((doc) => doc.status === "active");

  const campaignDocs = CAMPAIGN_SPECS.map((spec) => {
    const at = spec.daysAgo === 0 ? NOW - 41 * MINUTE : atRealisticHour(NOW - spec.daysAgo * DAY);
    const audience = spec.audience === "all" ? activeUsers : sample(activeUsers, int(9, 40));

    const recipients = audience.map((doc) => ({
      email: doc.email,
      name: greeting(doc.username),
      user_id: doc._id,
      status: "pending",
      error: null,
      sent_at: null,
    }));

    // The last campaign is a run whose process went away mid-send: still `sending`, heartbeat
    // long stale, most of its recipients never written. That is what interrupted looks like.
    const reached = spec.status === "sending"
      ? Math.floor(recipients.length * 0.42)
      : recipients.length;

    let sent = 0;
    let failed = 0;
    for (const [index, recipient] of recipients.entries()) {
      if (index >= reached) break;
      const bounced = spec.status === "failed" ? index >= 6 : chance(0.022);
      if (bounced) {
        recipient.status = "failed";
        recipient.error = pick(SMTP_ERRORS);
        failed += 1;
      } else {
        recipient.status = "sent";
        recipient.sent_at = Math.round(at + index * 1000 + int(0, 400));
        sent += 1;
      }
    }

    const lastTouch = Math.round(at + reached * 1000);
    return {
      _id: objectIdAt(at),
      created_at: Math.round(at),
      updated_at: lastTouch,
      subject: spec.subject,
      template: spec.template,
      body: spec.body,
      audience: spec.audience,
      status: spec.status,
      total: recipients.length,
      sent_count: sent,
      failed_count: failed,
      from_email: FROM_EMAIL,
      from_name: FROM_NAME,
      finished_at: spec.status === "sending" ? null : lastTouch,
      error:
        spec.status === "failed"
          ? "SMTP connection closed by the provider after 6 messages"
          : null,
      recipients,
    };
  });

  // -- write ---------------------------------------------------------------

  auditDocs.sort((a, b) => a.created_at - b.created_at);

  const insert = async (collection, docs, label) => {
    for (let i = 0; i < docs.length; i += 500) {
      await collection.insertMany(docs.slice(i, i + 500), { ordered: false });
    }
    console.log(`${label}: ${docs.length}`);
  };

  await insert(users, userDocs, "users seeded");
  await insert(payments, paymentDocs, "payments");
  await insert(sessions, sessionDocs, "sessions");
  await insert(auditLogs, auditDocs, "audit logs");
  await insert(campaigns, campaignDocs, "email campaigns");

  // The indexes backend creates on startup, so the local database matches the real one.
  await Promise.all([
    users.createIndex({ email: 1 }, { unique: true }),
    payments.createIndex({ user_id: 1 }),
    payments.createIndex({ order_id: 1 }, { unique: true }),
    payments.createIndex({ payment_id: 1 }),
    sessions.createIndex({ token: 1 }, { unique: true }),
    sessions.createIndex({ user_id: 1 }),
    auditLogs.createIndex({ user_id: 1, event_type: 1 }),
    auditLogs.createIndex({ email: 1, event_type: 1 }),
    auditLogs.createIndex({ created_at: 1 }),
  ]);

  const finished = paymentDocs.filter((doc) => doc.status === "finished");
  const revenueUsd = finished.reduce((sum, doc) => sum + doc.price_amount, 0);

  console.log("---");
  console.log(`total users:      ${await users.countDocuments({})}`);
  console.log(`finished revenue: $${revenueUsd.toLocaleString()}`);
  console.log(`paying users:     ${new Set(finished.map((doc) => String(doc.user_id))).size}`);
  console.log(`audit logs:       ${await auditLogs.countDocuments({})}`);
  console.log("password for every seeded account: Interview!2026");

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
