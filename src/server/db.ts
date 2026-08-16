import "server-only";

import { type Collection, type Db, MongoClient, ObjectId } from "mongodb";

import { ensureResolvableDns } from "./dns";

export const COLLECTIONS = {
  users: "users",
  payments: "payments",
  sessions: "sessions",
  auditLogs: "audit_logs",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

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

export function getCollection(name: CollectionName): Collection<Document> {
  return getDb().collection<Document>(name);
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
