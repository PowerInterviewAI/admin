import "server-only";

import { ObjectId } from "mongodb";

import type { UserLabel } from "@/lib/schemas/common";
import { COLLECTIONS, getCollection, toObjectId } from "@/server/db";

/**
 * Resolves a page of user ids to display labels in one query.
 *
 * Payments and sessions only carry `user_id`; a raw ObjectId tells an admin nothing, so every list
 * view that references a user resolves the whole page at once rather than fetching per row.
 */
export async function getUserLabels(userIds: string[]): Promise<Map<string, UserLabel>> {
  const unique = [...new Set(userIds)].filter((id) => ObjectId.isValid(id));
  if (unique.length === 0) return new Map();

  const docs = await getCollection(COLLECTIONS.users)
    .find({ _id: { $in: unique.map(toObjectId) } }, { projection: { username: 1, email: 1 } })
    .toArray();

  return new Map(
    docs.map((doc) => {
      const id = String(doc._id);
      return [id, { id, username: String(doc.username ?? ""), email: String(doc.email ?? "") }];
    }),
  );
}
