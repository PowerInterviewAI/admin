import "server-only";

import type { Filter } from "mongodb";

import type { RecipientOption } from "@/lib/schemas/email";
import { COLLECTIONS, type Document, getCollection, toObjectId } from "@/server/db";

/** One resolved mailbox: who it belongs to, and how the greeting will address them. */
export interface EmailRecipient {
  user_id: string | null;
  email: string;
  username: string;
}

export const RECIPIENT_SEARCH_LIMIT = 25;

/**
 * Only active users are ever mailable, matching the query the Python bulk sender runs, and only
 * ones with a usable address: a blank or missing `email` is rejected by the SMTP server per
 * recipient, which would fill a campaign's delivery log with failures the admin cannot fix.
 */
const MAILABLE: Filter<Document> = {
  status: "active",
  email: { $type: "string", $ne: "" },
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toRecipient(doc: Document): EmailRecipient {
  return {
    user_id: String(doc._id),
    email: String(doc.email ?? ""),
    username: String(doc.username ?? ""),
  };
}

export async function countMailableUsers(): Promise<number> {
  return getCollection(COLLECTIONS.users).countDocuments(MAILABLE);
}

/**
 * Backs the recipient picker. Capped rather than paginated: the picker is for finding a handful of
 * named people, and anyone reaching for more than that wants the "all active users" audience.
 */
export async function searchMailableUsers(query: string): Promise<RecipientOption[]> {
  const filter: Filter<Document> = { ...MAILABLE };

  const trimmed = query.trim();
  if (trimmed) {
    const pattern = new RegExp(escapeRegExp(trimmed), "i");
    filter.$or = [{ username: pattern }, { email: pattern }];
  }

  const docs = await getCollection(COLLECTIONS.users)
    .find(filter, {
      projection: { username: 1, email: 1 },
      sort: { username: 1 },
      limit: RECIPIENT_SEARCH_LIMIT,
    })
    .toArray();

  return docs.map((doc) => ({
    id: String(doc._id),
    username: String(doc.username ?? ""),
    email: String(doc.email ?? ""),
  }));
}

/** Resolves ids the picker handed back, dropping any that have since been deleted or deactivated. */
export async function getMailableUsersByIds(userIds: string[]): Promise<EmailRecipient[]> {
  if (userIds.length === 0) return [];

  const docs = await getCollection(COLLECTIONS.users)
    .find(
      { ...MAILABLE, _id: { $in: userIds.map(toObjectId) } },
      { projection: { username: 1, email: 1 } },
    )
    .toArray();

  return docs.map(toRecipient);
}

/**
 * The whole active user base, resolved at send time rather than when the campaign was composed, so
 * an account created while the admin was writing still gets the announcement.
 */
export async function getAllMailableUsers(): Promise<EmailRecipient[]> {
  const docs = await getCollection(COLLECTIONS.users)
    .find(MAILABLE, { projection: { username: 1, email: 1 }, sort: { created_at: 1 } })
    .toArray();

  return docs.map(toRecipient);
}

/**
 * Collapses duplicate mailboxes. Two accounts can share an address in this database (there is no
 * unique index on `email` in backend's schema), and sending the same announcement twice to one
 * inbox is what gets a sending domain reported.
 */
export function dedupeByEmail(recipients: EmailRecipient[]): EmailRecipient[] {
  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    const key = recipient.email.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
