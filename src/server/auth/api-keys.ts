import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { ApiKeyStatus } from "@/lib/schemas/reseller";
import { COLLECTIONS, currentTimestampMs, getCollection, toObjectId } from "@/server/db";
import { AppError, describeWriteError } from "@/server/errors";

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
 * Mints a key for a reseller account and returns it in plaintext - the only time it exists outside
 * the reseller's own records. Issuing again rotates: the old digest is overwritten, so the old key
 * stops working the moment this returns.
 */
export async function issueApiKey(accountId: string): Promise<string> {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const now = currentTimestampMs();

  try {
    const result = await getCollection(COLLECTIONS.adminAccounts).updateOne(
      // Scoped to the role, so a key can never be attached to an account that is not a reseller,
      // even by a caller that skipped the permission check.
      { _id: toObjectId(accountId), role: "reseller" },
      {
        $set: {
          api_key_hash: hashApiKey(key),
          api_key_prefix: key.slice(0, DISPLAY_PREFIX_LENGTH),
          api_key_created_at: now,
          updated_at: now,
        },
      },
    );
    if (result.matchedCount === 0) {
      throw new AppError("not_found", "Only a reseller account can hold an API key");
    }
  } catch (error) {
    throw describeWriteError(error, "API key");
  }

  return key;
}

/**
 * `$unset`, never set to null. The unique index on `api_key_hash` is partial on a string type, and
 * that is what lets any number of accounts have no key; an explicit null is the shape a sparse
 * index would still collide on.
 */
export async function revokeApiKey(accountId: string): Promise<void> {
  try {
    await getCollection(COLLECTIONS.adminAccounts).updateOne(
      { _id: toObjectId(accountId) },
      {
        $unset: Object.fromEntries(KEY_FIELDS.map((field) => [field, ""])),
        $set: { updated_at: currentTimestampMs() },
      },
    );
  } catch (error) {
    throw describeWriteError(error, "API key");
  }
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
