import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { headers } from "next/headers";

import type { ApiKeyStatus } from "@/lib/schemas/reseller";
import {
  COLLECTIONS,
  type Document,
  currentTimestampMs,
  getCollection,
  toObjectId,
} from "@/server/db";
import { AppError, describeWriteError } from "@/server/errors";
import { insertDocument } from "@/server/repository";

/**
 * A reseller's API key, which their own app sends to backend's `/api/reseller` as `X-API-Key`.
 *
 * The key lives on the reseller's `admin_accounts` row and backend reads that row directly (read
 * only) to authenticate, checking `role == "reseller"` and `status == "approved"` in the same query.
 * So rejecting, demoting or deleting the account here cuts the key off on its next call, with no
 * second copy to keep in sync.
 *
 * Only the SHA-256 is stored, for the same reason session tokens are stored hashed: anyone reading
 * this collection - a backup, a screen-shared Mongo client - would otherwise hold every reseller's
 * credential. No salt or work factor: the key is 32 random bytes, so the digest is a lookup key.
 *
 * Like `password_hash`, the key fields have no place in `accountSchema`, so a parsed account can
 * never carry them to a client. `readApiKeyStatus` is the one read, and it returns the prefix.
 */
export const API_KEY_PREFIX = "pia_rk_";

/** Long enough to tell two keys apart in a list, far too short to be worth anything. */
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 5;

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

const KEY_FIELDS = ["api_key_hash", "api_key_prefix", "api_key_created_at"] as const;

/**
 * Who changed a key, and by which route. Every issue and revoke records both, because a key is the
 * one credential here that moves money: "who rotated it, and from where" is the first question
 * after a reseller's app starts failing or their balance looks wrong.
 *
 * - `reseller_portal`: the reseller themselves, from their own page
 * - `admin_dashboard`: an admin revoking it from `/resellers`
 * - `role_change`: the account stopped being a reseller
 * - `account_deleted`: the account was removed
 */
export interface KeyActor {
  /** The signed-in account that did it, or null if the session could not be resolved. */
  email: string | null;
  via: "reseller_portal" | "admin_dashboard" | "role_change" | "account_deleted";
}

/**
 * Where the request came from. Read from the headers rather than passed in, so no caller can leave
 * it out; both are null outside a request (a script, a test), which is honest rather than wrong.
 * `x-forwarded-for` is only as trustworthy as the proxy in front, exactly as in backend's own audit
 * rows, which read it the same way.
 */
async function requestOrigin(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const incoming = await headers();
    return {
      ip: incoming.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: incoming.get("user-agent"),
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/**
 * Best effort, like the password-change entry: by the time this runs the key has already changed,
 * so failing the action would tell the caller the opposite of what happened. The failure is logged.
 *
 * Only the display prefix is recorded, never the key or its digest. The same `reseller_key_*` types
 * are declared in backend's `AuditLog.EventType`; they are written here because this app owns keys.
 */
async function recordKeyEvent(
  event: "reseller_key_issued" | "reseller_key_revoked",
  account: { id: string; email: string },
  actor: KeyActor,
  prefixes: { current: string | null; previous: string | null },
): Promise<void> {
  try {
    const origin = await requestOrigin();
    await insertDocument(
      COLLECTIONS.auditLogs,
      {
        event_type: event,
        // A reseller is a dashboard account, not a product user, so there is no `user_id` to give.
        user_id: null,
        email: account.email,
        status: "success",
        ip_address: origin.ip,
        user_agent: origin.userAgent,
        metadata: {
          source: "admin_dashboard",
          reseller_id: account.id,
          ...(prefixes.current ? { key_prefix: prefixes.current } : {}),
          ...(prefixes.previous ? { previous_key_prefix: prefixes.previous } : {}),
          actor_email: actor.email,
          via: actor.via,
        },
      },
      "audit log",
    );
  } catch (error) {
    console.error(`The API key change for ${account.email} was saved, but its audit entry was not`, error);
  }
}

/**
 * Mints a key for a reseller account and returns it in plaintext - the only time it exists outside
 * the reseller's own records. Issuing again rotates: the old digest is overwritten, so the old key
 * stops working the moment this returns. Records `reseller_key_issued`, naming the key it replaced
 * when there was one.
 */
export async function issueApiKey(accountId: string, actor: KeyActor): Promise<string> {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const prefix = key.slice(0, DISPLAY_PREFIX_LENGTH);
  const now = currentTimestampMs();

  let before: Document | null;
  try {
    // The document as it was, so what a rotation replaced is read in the same atomic step as the
    // write, not in a separate read another rotation could slip between.
    before = await getCollection(COLLECTIONS.adminAccounts).findOneAndUpdate(
      // Scoped to the role, so a key can never be attached to an account that is not a reseller,
      // even by a caller that skipped the permission check.
      { _id: toObjectId(accountId), role: "reseller" },
      {
        $set: {
          api_key_hash: hashApiKey(key),
          api_key_prefix: prefix,
          api_key_created_at: now,
          updated_at: now,
        },
      },
      { returnDocument: "before", projection: { email: 1, api_key_prefix: 1 } },
    );
  } catch (error) {
    throw describeWriteError(error, "API key");
  }
  if (!before) {
    throw new AppError("not_found", "Only a reseller account can hold an API key");
  }

  await recordKeyEvent(
    "reseller_key_issued",
    { id: accountId, email: String(before.email ?? "") },
    actor,
    {
      current: prefix,
      previous: typeof before.api_key_prefix === "string" ? before.api_key_prefix : null,
    },
  );

  return key;
}

/**
 * `$unset`, never set to null. The unique index on `api_key_hash` is partial on a string type, and
 * that is what lets any number of accounts have no key; an explicit null is the shape a sparse
 * index would still collide on.
 *
 * Records `reseller_key_revoked` only when there was a key to end: demoting an account that never
 * had one, or revoking twice, changes nothing and so leaves no entry. Returns whether it did.
 */
export async function revokeApiKey(accountId: string, actor: KeyActor): Promise<boolean> {
  let before: Document | null;
  try {
    before = await getCollection(COLLECTIONS.adminAccounts).findOneAndUpdate(
      { _id: toObjectId(accountId), api_key_hash: { $type: "string" } },
      {
        $unset: Object.fromEntries(KEY_FIELDS.map((field) => [field, ""])),
        $set: { updated_at: currentTimestampMs() },
      },
      { returnDocument: "before", projection: { email: 1, api_key_prefix: 1 } },
    );
  } catch (error) {
    throw describeWriteError(error, "API key");
  }
  if (!before) return false;

  await recordKeyEvent(
    "reseller_key_revoked",
    { id: accountId, email: String(before.email ?? "") },
    actor,
    {
      current: typeof before.api_key_prefix === "string" ? before.api_key_prefix : null,
      previous: null,
    },
  );
  return true;
}

export async function readApiKeyStatus(accountId: string): Promise<ApiKeyStatus> {
  const doc = await getCollection(COLLECTIONS.adminAccounts).findOne(
    { _id: toObjectId(accountId) },
    { projection: { api_key_prefix: 1, api_key_created_at: 1 } },
  );
  return {
    prefix: typeof doc?.api_key_prefix === "string" ? doc.api_key_prefix : null,
    created_at: typeof doc?.api_key_created_at === "number" ? doc.api_key_created_at : null,
  };
}

/** What a reseller owes per interview hour, in integer cents. `null` leaves future sales unpriced. */
export async function setCreditRate(accountId: string, centsPerHour: number | null): Promise<void> {
  try {
    const result = await getCollection(COLLECTIONS.adminAccounts).updateOne(
      { _id: toObjectId(accountId), role: "reseller" },
      { $set: { credit_rate_cents_per_hour: centsPerHour, updated_at: currentTimestampMs() } },
    );
    if (result.matchedCount === 0) {
      throw new AppError("not_found", "That account is not a reseller");
    }
  } catch (error) {
    throw describeWriteError(error, "rate");
  }
}

export interface ResellerAccountInfo {
  id: string;
  name: string;
  email: string;
  status: string;
  key: ApiKeyStatus;
  rate_cents_per_hour: number | null;
}

/**
 * Every reseller account, with its key status and rate. Read straight off the driver with an
 * explicit projection rather than through `accountSchema`, because the key fields and the rate are
 * exactly what that schema leaves out - and the projection is what keeps `password_hash` and
 * `api_key_hash` from being read at all.
 */
export async function listResellerAccounts(filter: { ids?: string[] } = {}): Promise<
  ResellerAccountInfo[]
> {
  const query: Record<string, unknown> = { role: "reseller" };
  if (filter.ids) query._id = { $in: filter.ids.map(toObjectId) };

  const docs = await getCollection(COLLECTIONS.adminAccounts)
    .find(query, {
      projection: {
        name: 1,
        email: 1,
        status: 1,
        api_key_prefix: 1,
        api_key_created_at: 1,
        credit_rate_cents_per_hour: 1,
      },
      sort: { name: 1, email: 1 },
    })
    .toArray();

  return docs.map((doc) => ({
    id: String(doc._id),
    name: typeof doc.name === "string" ? doc.name : "",
    email: typeof doc.email === "string" ? doc.email : "",
    status: typeof doc.status === "string" ? doc.status : "pending",
    key: {
      prefix: typeof doc.api_key_prefix === "string" ? doc.api_key_prefix : null,
      created_at: typeof doc.api_key_created_at === "number" ? doc.api_key_created_at : null,
    },
    rate_cents_per_hour:
      typeof doc.credit_rate_cents_per_hour === "number" ? doc.credit_rate_cents_per_hour : null,
  }));
}
