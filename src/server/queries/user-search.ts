import "server-only";

import type { ObjectId } from "mongodb";

import { escapeRegExp } from "@/lib/regex";
import { COLLECTIONS, getCollection } from "@/server/db";

/**
 * Ceiling on how many users one search term may resolve to before the `$in` stops being worth
 * building. A term broad enough to match more accounts than this is not a search for a person.
 */
export const USER_MATCH_LIMIT = 500;

/**
 * Resolves a typed term to the accounts it names.
 *
 * Rows in `payments`, `sessions`, and `audit_logs` store a `user_id` and nothing an admin would
 * type - a username lives only on the user document - so searching those collections by person
 * means resolving the term through `users` first. Capped, because past a few hundred matches the
 * `$in` is slower than no filter at all and the result is not a search for anyone in particular.
 */
export async function findUserIdsMatching(q: string): Promise<ObjectId[]> {
  const pattern = new RegExp(escapeRegExp(q), "i");

  const owners = await getCollection(COLLECTIONS.users)
    .find({ $or: [{ username: pattern }, { email: pattern }] }, { projection: { _id: 1 } })
    .limit(USER_MATCH_LIMIT)
    .toArray();

  return owners.map((owner) => owner._id as ObjectId);
}
