import "server-only";

import {
  type Account,
  type AccountRole,
  type AccountRow,
  accountRowSchema,
  accountSchema,
  normalizeEmail,
} from "@/lib/schemas/account";
import { COLLECTIONS, currentTimestampMs, getCollection, toObjectId } from "@/server/db";
import { AppError, describeWriteError } from "@/server/errors";
import { hashPassword } from "@/server/password";
import { findMany } from "@/server/repository";

/**
 * Two indexes carry a correctness guarantee rather than a speed one, which is why they are created
 * before the first write rather than left to a setup script nobody runs:
 *
 * - unique `email` is what makes "is this address taken?" safe. Checking with a read and then
 *   inserting is a race two simultaneous sign-ups win together; the index turns the loser into a
 *   duplicate-key error, which `describeWriteError` already reports as a conflict.
 * - unique `token_hash` is the same argument for session tokens, and the reason a token can be
 *   looked up in one indexed read on every request.
 *
 * The promise is cached on `globalThis` for the same reason the Mongo client is: Next re-evaluates
 * modules on every edit in development, and a module-level flag would re-run this on each reload.
 */
declare global {
  var __adminAuthIndexes: Promise<void> | undefined;
}

async function createAuthIndexes(): Promise<void> {
  await Promise.all([
    getCollection(COLLECTIONS.adminAccounts).createIndex({ email: 1 }, { unique: true }),
    getCollection(COLLECTIONS.adminSessions).createIndex({ token_hash: 1 }, { unique: true }),
    getCollection(COLLECTIONS.adminSessions).createIndex({ account_id: 1 }),
  ]);
}

export function ensureAuthIndexes(): Promise<void> {
  globalThis.__adminAuthIndexes ??= createAuthIndexes().catch((error) => {
    // Let the next call try again rather than caching a failure for the life of the process: the
    // usual cause is a database that was not up yet, which fixes itself.
    globalThis.__adminAuthIndexes = undefined;
    throw describeWriteError(error, "account");
  });
  return globalThis.__adminAuthIndexes;
}

/**
 * The one read in the app that sees a `password_hash`, and the reason it goes through the driver
 * instead of `findOne` from the repository: `accountSchema` strips the field, which is exactly
 * what makes the schema safe everywhere else. Nothing here returns the hash to a caller outside
 * `src/server/auth`.
 */
export async function findAccountCredentials(
  email: string,
): Promise<{ id: string; role: AccountRole; passwordHash: string | null } | null> {
  const doc = await getCollection(COLLECTIONS.adminAccounts).findOne({
    email: normalizeEmail(email),
  });
  if (!doc) return null;

  return {
    id: String(doc._id),
    role: doc.role === "admin" ? "admin" : "guest",
    passwordHash: typeof doc.password_hash === "string" ? doc.password_hash : null,
  };
}

export async function getAccountById(accountId: string): Promise<Account | null> {
  const doc = await getCollection(COLLECTIONS.adminAccounts).findOne({
    _id: toObjectId(accountId),
  });
  if (!doc) return null;

  const parsed = accountSchema.safeParse({
    ...doc,
    _id: String(doc._id),
  });
  return parsed.success ? parsed.data : null;
}

export async function countAccounts(): Promise<number> {
  return getCollection(COLLECTIONS.adminAccounts).countDocuments();
}

export async function countAdmins(): Promise<number> {
  return getCollection(COLLECTIONS.adminAccounts).countDocuments({ role: "admin" });
}

interface CreateAccountInput {
  email: string;
  name: string;
  password: string;
  role: AccountRole;
}

/** Returns the new account's id. The unique index on `email` is what rejects a duplicate. */
export async function createAccount({
  email,
  name,
  password,
  role,
}: CreateAccountInput): Promise<string> {
  await ensureAuthIndexes();

  // Hashing costs a few hundred milliseconds of CPU, so it happens once, here, rather than being
  // repeated by every caller.
  const password_hash = await hashPassword(password);

  try {
    const result = await getCollection(COLLECTIONS.adminAccounts).insertOne({
      email: normalizeEmail(email),
      name: name.trim(),
      role,
      password_hash,
      last_login_at: null,
      created_at: currentTimestampMs(),
      updated_at: null,
    });
    return result.insertedId.toHexString();
  } catch (error) {
    throw describeWriteError(error, "account");
  }
}

export async function setAccountPasswordHash(accountId: string, password: string): Promise<void> {
  const password_hash = await hashPassword(password);

  try {
    const result = await getCollection(COLLECTIONS.adminAccounts).updateOne(
      { _id: toObjectId(accountId) },
      { $set: { password_hash, updated_at: currentTimestampMs() } },
    );
    if (result.matchedCount === 0) {
      throw new AppError("not_found", "That account no longer exists");
    }
  } catch (error) {
    throw describeWriteError(error, "account");
  }
}

/**
 * Stamped on every successful sign-in so the access panel can show which accounts are still in
 * use. Never allowed to fail the sign-in: the session already exists by the time this runs, and
 * refusing to sign somebody in because a bookkeeping write failed would be the wrong trade.
 */
export async function touchLastLogin(accountId: string): Promise<void> {
  try {
    await getCollection(COLLECTIONS.adminAccounts).updateOne(
      { _id: toObjectId(accountId) },
      { $set: { last_login_at: currentTimestampMs() } },
    );
  } catch (error) {
    console.error("Signed in, but the last-login timestamp could not be written", error);
  }
}

/**
 * Every account with its live session count, for the access panel.
 *
 * There are as many rows here as there are people with a login, so this reads the collection whole
 * rather than paging it, and resolves the counts for all of them in one grouped aggregation - the
 * same shape the users list uses for payment and session counts, and for the same reason: a
 * per-row round trip for a number shown in a column is not worth a query each.
 */
export async function listAccounts(): Promise<AccountRow[]> {
  const [accounts, sessionCounts] = await Promise.all([
    findMany({
      collection: COLLECTIONS.adminAccounts,
      schema: accountSchema,
      sort: { created_at: 1 },
      limit: 500,
    }),
    countLiveSessionsByAccount(),
  ]);

  return accounts.map((account) =>
    accountRowSchema.parse({ ...account, session_count: sessionCounts[account._id] ?? 0 }),
  );
}

async function countLiveSessionsByAccount(): Promise<Record<string, number>> {
  const rows = await getCollection(COLLECTIONS.adminSessions)
    .aggregate<{ _id: unknown; count: number }>([
      // Expired rows are still present until something deletes them (see `session.ts` on why
      // there is no TTL index), so the count has to exclude them or it would report sign-ins that
      // no longer work.
      { $match: { expires_at: { $gt: currentTimestampMs() } } },
      { $group: { _id: "$account_id", count: { $sum: 1 } } },
    ])
    .toArray();

  return Object.fromEntries(rows.map((row) => [String(row._id), row.count]));
}
