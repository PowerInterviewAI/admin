import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { cache } from "react";

import { type Account } from "@/lib/schemas/account";
import { SESSION_COOKIE } from "@/lib/auth-routes";
import {
  COLLECTIONS,
  type Document,
  currentTimestampMs,
  getCollection,
  toObjectId,
} from "@/server/db";
import { describeWriteError } from "@/server/errors";
import { ensureAuthReady, getAccountById } from "@/server/auth/accounts";

/**
 * How long a sign-in lasts. The cookie and the database row are given the same absolute deadline
 * and neither slides: extending a live session would mean writing a new `Set-Cookie`, and the only
 * place that reads the session on an ordinary page view is a server component, where Next does not
 * allow one. A fixed month on an internal tool is the better trade against re-authenticating a
 * user mid-render, which is the alternative that shape of renewal invites.
 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The cookie carries a random token; the database stores only its SHA-256. A token is a bearer
 * credential, so an attacker who reads the sessions collection (a backup, a screen-share of a
 * Mongo client) would otherwise be able to sign in as anybody, without needing a password. Hashing
 * costs nothing here because the token is high-entropy already - this is a lookup key, not a
 * password, so it needs no work factor.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Whether to mark the session cookie `Secure`, decided from the request rather than from
 * `NODE_ENV`.
 *
 * `NODE_ENV` is the obvious-looking test and it is wrong here: `pnpm start` is a production build
 * served over plain HTTP on :13000, which is how this tool actually runs. A browser silently
 * discards a `Secure` cookie that arrives over HTTP, so keying off the build mode makes signing in
 * appear to succeed and then bounce straight back to the form, with nothing in any log to say why.
 * Keying off the scheme gets the flag on exactly where it does something.
 *
 * `SECURE_COOKIES` forces the answer for a deployment whose proxy does not set the header.
 */
async function secureCookieFlag(): Promise<boolean> {
  if (process.env.SECURE_COOKIES === "true") return true;
  if (process.env.SECURE_COOKIES === "false") return false;

  // A proxy chain appends, so the client's own scheme is the first entry rather than the last.
  const forwarded = (await headers()).get("x-forwarded-proto");
  return forwarded?.split(",")[0]?.trim().toLowerCase() === "https";
}

function cookieOptions(expiresAt: number, secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    expires: new Date(expiresAt),
  };
}

/**
 * Issues a session and sets its cookie. Only callable from a server action or route handler, since
 * that is the only place Next lets a cookie be written.
 */
export async function createSession(accountId: string): Promise<void> {
  await ensureAuthReady();

  const token = randomBytes(32).toString("base64url");
  const expiresAt = currentTimestampMs() + SESSION_TTL_MS;

  try {
    await getCollection(COLLECTIONS.adminSessions).insertOne({
      account_id: toObjectId(accountId),
      token_hash: hashToken(token),
      expires_at: expiresAt,
      created_at: currentTimestampMs(),
      updated_at: null,
    });
  } catch (error) {
    throw describeWriteError(error, "session");
  }

  // Expired rows are swept on the way in rather than by a TTL index, because Mongo's TTL indexes
  // require a BSON date and every timestamp in this stack is a unix-ms integer. Signing in is the
  // natural moment: it is rare, it is already writing to this collection, and nothing reads an
  // expired row in the meantime - `getCurrentAccount` filters on the deadline.
  await purgeExpiredSessions(accountId);

  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions(expiresAt, await secureCookieFlag()));
}

async function purgeExpiredSessions(accountId: string): Promise<void> {
  try {
    await getCollection(COLLECTIONS.adminSessions).deleteMany({
      account_id: toObjectId(accountId),
      expires_at: { $lte: currentTimestampMs() },
    });
  } catch (error) {
    console.error("Could not clear expired sessions for this account", error);
  }
}

/** Ends the calling session: the row goes, so the token is dead even if the cookie survives. */
export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    try {
      await getCollection(COLLECTIONS.adminSessions).deleteOne({ token_hash: hashToken(token) });
    } catch (error) {
      console.error("Could not delete the session row while signing out", error);
    }
  }

  store.delete(SESSION_COOKIE);
}

/**
 * Signs one account out of every device. Used when its password changes, and from the access panel.
 *
 * `keepCurrent` spares the caller's own session, which is what makes changing your own password
 * not sign you out of the tab you changed it in - the same exception backend makes for a user
 * changing their own password. It is an exception only the request holding that cookie can claim:
 * the token is read from the cookie here, never passed in.
 */
export async function revokeAccountSessions(
  accountId: string,
  { keepCurrent = false }: { keepCurrent?: boolean } = {},
): Promise<number> {
  const filter: Document = { account_id: toObjectId(accountId) };

  if (keepCurrent) {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (token) {
      filter.token_hash = { $ne: hashToken(token) };
    }
  }

  try {
    const result = await getCollection(COLLECTIONS.adminSessions).deleteMany(filter);
    return result.deletedCount;
  } catch (error) {
    throw describeWriteError(error, "session");
  }
}

/**
 * Whoever is signed in, or null.
 *
 * Memoised with React's `cache` so a render pass that checks the session in the layout, in a page,
 * and in three components costs one pair of queries rather than five. The memo is per request, so
 * a role changed in another tab takes effect on the next navigation.
 *
 * The role and the status are read from the account document every time rather than being carried
 * in the cookie. That is the whole reason a demotion, a revocation, or a deletion takes effect
 * immediately instead of whenever the victim happens to sign out: there is no copy of the
 * permission anywhere the server trusts.
 *
 * An account that is not `approved` resolves to null, exactly like one that was deleted. Revoking
 * access also deletes that account's sessions, so this is the belt rather than the braces - but it
 * is the half that cannot be raced, since it re-reads the document on every request.
 */
export const getCurrentAccount = cache(async (): Promise<Account | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await getCollection(COLLECTIONS.adminSessions).findOne({
    token_hash: hashToken(token),
    expires_at: { $gt: currentTimestampMs() },
  });
  if (!session) return null;

  const account = await getAccountById(String(session.account_id));
  return account?.status === "approved" ? account : null;
});
