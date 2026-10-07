import "server-only";

import {
  type Account,
  type AccountRole,
  type AccountRow,
  type AccountStatus,
  accountRoleSchema,
  accountRowSchema,
  accountSchema,
  normalizeEmail,
} from "@/lib/schemas/account";
import { bootstrapAdminAccount } from "@/server/auth/bootstrap";
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
  var __adminAuthReady: Promise<void> | undefined;
}

async function prepareAuth(): Promise<void> {
  await Promise.all([
    getCollection(COLLECTIONS.adminAccounts).createIndex({ email: 1 }, { unique: true }),
    // Backend authenticates a reseller's API key with one lookup on this field, and two accounts
    // must never share a digest. Partial on a string type, not sparse: a sparse unique index still
    // collides on explicit nulls, and every account without a key is one (see `revokeApiKey`).
    getCollection(COLLECTIONS.adminAccounts).createIndex(
      { api_key_hash: 1 },
      {
        unique: true,
        partialFilterExpression: { api_key_hash: { $type: "string" } },
        name: "api_key_hash_unique",
      },
    ),
    getCollection(COLLECTIONS.adminSessions).createIndex({ token_hash: 1 }, { unique: true }),
    getCollection(COLLECTIONS.adminSessions).createIndex({ account_id: 1 }),
  ]);

  // After the indexes, never beside them: the bootstrap account is an insert on `email`, and it
  // depends on the unique index to be the thing that settles a race rather than a read-then-write.
  await bootstrapAdminAccount();
}

/**
 * Indexes, the status backfill, and the built-in admin - everything that has to be true before
 * anybody signs in. Awaited at the top of every entry point that reads or writes an account, so
 * there is no ordering to get wrong and no setup script to forget.
 */
export function ensureAuthReady(): Promise<void> {
  globalThis.__adminAuthReady ??= prepareAuth().catch((error) => {
    // Let the next call try again rather than caching a failure for the life of the process: the
    // usual cause is a database that was not up yet, which fixes itself.
    globalThis.__adminAuthReady = undefined;
    throw describeWriteError(error, "account");
  });
  return globalThis.__adminAuthReady;
}

/**
 * The one read in the app that sees a `password_hash`, and the reason it goes through the driver
 * instead of `findOne` from the repository: `accountSchema` strips the field, which is exactly
 * what makes the schema safe everywhere else. Nothing here returns the hash to a caller outside
 * `src/server/auth`.
 */
export async function findAccountCredentials(email: string): Promise<{
  id: string;
  role: AccountRole;
  status: AccountStatus;
  passwordHash: string | null;
} | null> {
  const doc = await getCollection(COLLECTIONS.adminAccounts).findOne({
    email: normalizeEmail(email),
  });
  if (!doc) return null;

  return {
    id: String(doc._id),
    // Through the schema rather than a hand-written `=== "admin" ? ... : "guest"`, which quietly
    // turned every role added after the first two into a guest. Same least-privileged fallback.
    role: accountRoleSchema.catch("guest").parse(doc.role),
    // Anything that is not one of the three known words is treated as pending, which is the
    // reading that denies access rather than granting it.
    status: doc.status === "approved" || doc.status === "rejected" ? doc.status : "pending",
    passwordHash: typeof doc.password_hash === "string" ? doc.password_hash : null,
  };
}

/** Reads a single account's password hash, for a change that has to verify the current one. */
export async function readPasswordHash(accountId: string): Promise<string | null> {
  const doc = await getCollection(COLLECTIONS.adminAccounts).findOne(
    { _id: toObjectId(accountId) },
    { projection: { password_hash: 1 } },
  );
  return typeof doc?.password_hash === "string" ? doc.password_hash : null;
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
  return getCollection(COLLECTIONS.adminAccounts).countDocuments({
    role: "admin",
    status: "approved",
  });
}

/** How many sign-ups are waiting on a decision, for the nav badge and the summary strip. */
export async function countPendingAccounts(): Promise<number> {
  try {
    await ensureAuthReady();
    return await getCollection(COLLECTIONS.adminAccounts).countDocuments({ status: "pending" });
  } catch {
    // Rendered in the chrome on every page. A badge is not worth an error boundary over the
    // dashboard behind it.
    return 0;
  }
}

interface CreateAccountInput {
  email: string;
  name: string;
  password: string;
  role: AccountRole;
  /** Signing up yourself gets `pending`; an admin creating the account has already approved it. */
  status: AccountStatus;
}

/** Returns the new account's id. The unique index on `email` is what rejects a duplicate. */
export async function createAccount({
  email,
  name,
  password,
  role,
  status,
}: CreateAccountInput): Promise<string> {
  await ensureAuthReady();

  // Hashing costs a few hundred milliseconds of CPU, so it happens once, here, rather than being
  // repeated by every caller.
  const password_hash = await hashPassword(password);

  try {
    const result = await getCollection(COLLECTIONS.adminAccounts).insertOne({
      email: normalizeEmail(email),
      name: name.trim(),
      role,
      status,
      is_bootstrap: false,
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

/** Renames an account. Only ever called on the caller's own, from the account page. */
export async function setAccountName(accountId: string, name: string): Promise<void> {
  try {
    const result = await getCollection(COLLECTIONS.adminAccounts).updateOne(
      { _id: toObjectId(accountId) },
      { $set: { name: name.trim(), updated_at: currentTimestampMs() } },
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
      // Oldest first, then re-sorted below. Mongo cannot order by "pending before everything
      // else" without an `$expr` stage, and at this row count sorting in memory is cheaper than
      // the aggregation that would avoid it.
      sort: { created_at: 1 },
      limit: 500,
    }),
    countLiveSessionsByAccount(),
  ]);

  const rank: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };

  return accounts
    .map((account) =>
      accountRowSchema.parse({ ...account, session_count: sessionCounts[account._id] ?? 0 }),
    )
    // Accounts waiting on a decision come first: the panel exists to get them decided, and a
    // pending row buried under thirty approved ones is one nobody notices.
    .sort((a, b) => (rank[a.status] ?? 0) - (rank[b.status] ?? 0));
}

/** Live sessions on one account, for the account page's "sign out other devices" row. */
export async function countAccountSessions(accountId: string): Promise<number> {
  return getCollection(COLLECTIONS.adminSessions).countDocuments({
    account_id: toObjectId(accountId),
    expires_at: { $gt: currentTimestampMs() },
  });
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
