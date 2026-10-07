import "server-only";

import { type Collection, type Db, MongoClient, ObjectId } from "mongodb";

import { ensureResolvableDns } from "./dns";

/**
 * `email_campaigns` is the one collection here that backend does not own or read. It exists so a
 * bulk send leaves a record of who was reached - the Python bulk sender this feature replaces had
 * only a log file, which meant a run interrupted halfway was unreconstructable.
 */
export const COLLECTIONS = {
  users: "users",
  payments: "payments",
  sessions: "sessions",
  auditLogs: "audit_logs",
  emailCampaigns: "email_campaigns",
  globalState: "global_state",
  // Written by backend's `/api/reseller` and its settlement worker; read here. Settlements are the
  // one place this app writes back into them, and only `status` / `paid_*`.
  resellerLedger: "reseller_ledger",
  resellerSettlements: "reseller_settlements",
  adminAccounts: "admin_accounts",
  adminSessions: "admin_sessions",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

/**
 * Who may sign in to this dashboard, and which of those sign-ins are still live. Both live in a
 * separate database (`ADMIN_MONGO_DB`, default `pia_admin`) rather than beside backend's
 * collections, because they describe operators of the tool rather than customers of the product:
 * an `admin_accounts` row is not a `users` row with a flag, the two never join, and backend must
 * never find this app's credentials in a database it owns and is free to migrate.
 *
 * Keeping them in `COLLECTIONS` rather than in a parallel registry is what lets `findPage`,
 * `findOne`, `updateById` and the rest work here unchanged - `getCollection` is the only thing
 * that has to know which database a name belongs to.
 */
const ADMIN_DB_COLLECTIONS: ReadonlySet<string> = new Set([
  COLLECTIONS.adminAccounts,
  COLLECTIONS.adminSessions,
]);

/** A raw Mongo document. Every read is validated by a zod schema before it leaves this layer. */
export type Document = Record<string, unknown>;

declare global {
  var __adminMongoClient: MongoClient | undefined;
}

function createClient(): MongoClient {
  const uri = process.env.MONGO_URL;
  if (!uri) {
    throw new Error(
      "MONGO_URL is not set. Copy .env.example to .env.local and point it at the database backend uses.",
    );
  }
  if (uri.startsWith("mongodb+srv://")) {
    ensureResolvableDns();
  }
  return new MongoClient(uri, { appName: "power-interview-admin" });
}

/**
 * The driver pools connections internally, so one client per process is correct. The cache lives
 * on `globalThis` rather than in a module variable because Next re-evaluates modules on every edit
 * in development, and a module-scoped client would leak a fresh connection pool per reload.
 */
function getClient(): MongoClient {
  globalThis.__adminMongoClient ??= createClient();
  return globalThis.__adminMongoClient;
}

export function getDb(): Db {
  return getClient().db(process.env.MONGO_DB || "power_interview_ai");
}

/** This dashboard's own database - accounts and sign-in sessions, nothing backend reads. */
export function getAdminDb(): Db {
  return getClient().db(process.env.ADMIN_MONGO_DB || "pia_admin");
}

export function getCollection(name: CollectionName): Collection<Document> {
  const db = ADMIN_DB_COLLECTIONS.has(name) ? getAdminDb() : getDb();
  return db.collection<Document>(name);
}

export function toObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw new Error(`Invalid id: ${id}`);
  }
  return new ObjectId(id);
}

/** Current time as unix ms, matching backend's `created_at`/`updated_at` fields. */
export function currentTimestampMs(): number {
  return Date.now();
}
